/**
 * STREAM BOX PHASE 6 PRO SECURITY ENGINE
 * Automated watchdog + threat hardening QA
 */

const fetch = global.fetch || require("node-fetch");
const fs = require("fs");

const BASE = "http://localhost:3000";
const HEALTH = `${BASE}/health`;

const TIMEOUT_MS = 4000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function healthOnce() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH, { signal: controller.signal });
    if (res.status !== 200) return { ok: false, type: "BAD_STATUS", status: res.status, data: null };
    const data = await res.json().catch(() => null);
    return { ok: true, type: "OK", status: res.status, data };
  } catch (err) {
    const code = err?.code;
    const name = err?.name;
    return { ok: false, type: code || name || "ERROR" };
  } finally {
    clearTimeout(t);
  }
}

async function waitForRecoveryIndefinitely() {
  // Hard requirement: never abort due to backend failures.
  // Health rules: retry after 2 seconds on ECONNREFUSED/timeout/invalid response.
  while (true) {
    const h = await healthOnce();
    if (h.ok && h.data?.status === "OK") {
      return true;
    }
    await sleep(2000);
  }
}

async function stableOneMoreCheck() {
  // Ensure backend stable for at least one successful check after recovery.
  while (true) {
    const h = await healthOnce();
    if (h.ok && h.data?.status === "OK") return true;
    await sleep(2000);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 200),
      blocked: false,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: err?.message || String(err),
      blocked: true,
    };
  } finally {
    clearTimeout(t);
  }
}

async function postUploadProbe() {
  // Minimal valid multipart request to trigger auth/authorization and error-handling.
  // We send a fake movie field name but without a real file; backend should respond 400.
  // This is still a meaningful authorization/upload-security probe without requiring real media files.
  const boundary = "----SBPHASE6" + Math.random().toString(16).slice(2);
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    "",
    "Phase6",
    `--${boundary}`,
    'Content-Disposition: form-data; name="description"',
    "",
    "probe",
    `--${boundary}`,
    'Content-Disposition: form-data; name="movie"; filename="probe.mp4"',
    "Content-Type: video/mp4",
    "",
    "not-real-mp4-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return fetchWithTimeout(`${BASE}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

function decideCategoryOutcome({ category, results }) {
  // Failure due to backend downtime => EXECUTION BLOCKED
  if (results.some((r) => r.blocked)) return "EXECUTION BLOCKED";

  // Evidence-based vulnerability checks (best-effort heuristics)
  // If server returns 500/crash or discloses sensitive data, mark VULNERABLE.
  const any5xx = results.some((r) => r.status >= 500);
  const anyDisclosure = results.some((r) => /root:|\badmin\b|secret\.env|passwd|<!DOCTYPE|syntax error/i.test(r.body || ""));

  if (any5xx || anyDisclosure) return "VULNERABLE";

  // For auth/path/traversal probes: if they incorrectly succeed (200) where they should not,
  // mark VULNERABLE. Otherwise SAFE / NOT OBSERVED.
  const anyUnexpected200 = results.some((r) => r.status === 200);

  if (category === "sql-injection") {
    // If SQLi leads to different behavior (e.g., 200 with error text is risky; 500 is worse)
    if (any5xx) return "VULNERABLE";
    return "SAFE";
  }
  if (category === "path-traversal") {
    if (anyUnexpected200) return "VULNERABLE";
    return "SAFE";
  }
  if (category === "authorization") {
    if (anyUnexpected200) return "VULNERABLE";
    return "SAFE";
  }
  if (category === "upload-security") {
    // For upload we only expect 400/401/413/415/500; 200 indicates potential auth bypass
    if (anyUnexpected200) return "VULNERABLE";
    return "SAFE";
  }
  if (category === "error-handling") {
    if (any5xx) return "VULNERABLE";
    // Invalid IDs should not cause 5xx
    return "SAFE";
  }
  if (category === "api-abuse") {
    if (any5xx) return "VULNERABLE";
    return "SAFE";
  }

  return "NOT OBSERVED";
}

async function run() {
  const categories = [
    { key: "sql-injection", label: "SQL INJECTION" },
    { key: "path-traversal", label: "PATH TRAVERSAL" },
    { key: "authorization", label: "AUTHORIZATION" },
    { key: "upload-security", label: "UPLOAD SECURITY" },
    { key: "error-handling", label: "ERROR HANDLING" },
    { key: "api-abuse", label: "API ABUSE" },
  ];

  // Watchdog loop (indefinite until recovery)
  await waitForRecoveryIndefinitely();
  await stableOneMoreCheck();

  const tested = {
    "sql-injection": [
      { method: "GET", endpoint: "/movies/1", payload: "(id=1)" },
      { method: "GET", endpoint: "/movies/' OR 1=1 --", payload: "' OR 1=1 --" },
      { method: "GET", endpoint: "/movies/1;DROP TABLE movies;", payload: "1;DROP TABLE movies;" },
      { method: "GET", endpoint: "/movies/\" OR \"\"=\"\"", payload: "\" OR \"\"=\"\"" },
    ],
    "path-traversal": [
      { method: "GET", endpoint: "/video/../../etc/passwd", payload: "../../etc/passwd" },
      { method: "GET", endpoint: "/subtitle/../../secret.env", payload: "../../secret.env" },
      { method: "GET", endpoint: "/thumbnail/..\\..\\windows\\system32", payload: "..\\..\\windows\\system32" },
    ],
    authorization: [
      { method: "POST", endpoint: "/upload", payload: "empty/minimal multipart probe" },
      { method: "GET", endpoint: "/admin", payload: "unauthenticated" },
      { method: "DELETE", endpoint: "/movies/1", payload: "unauthenticated" },
    ],
    "upload-security": [
      { method: "POST", endpoint: "/upload", payload: "empty/minimal multipart probe" },
    ],
    "error-handling": [
      { method: "GET", endpoint: "/movies/9999999999", payload: "very large id" },
      { method: "GET", endpoint: "/movies/%2F%2F%2E%2E", payload: "malformed id" },
      { method: "POST", endpoint: "/upload", payload: "invalid payload / missing parts (probe)" },
    ],
    "api-abuse": Array.from({ length: 20 }).map((_, i) => ({ method: "GET", endpoint: "/movies", payload: `rapid_${i + 1}` })),
  };

  // Helper to retry groups if blocked, per strict rules.
  async function runUntilNotBlocked(categoryKey, groupFn) {
    while (true) {
      const results = await groupFn();
      if (!results.some((r) => r.blocked)) return results;
      await sleep(2000);
    }
  }

  // GROUP A: SQL INJECTION
  const sqlResults = await runUntilNotBlocked("sql-injection", async () => {
    const tests = [
      `${BASE}/movies/1`,
      `${BASE}/movies/'%20OR%201%3D1%20--`,
      `${BASE}/movies/1;DROP%20TABLE%20movies;`,
      `${BASE}/movies/%22%20OR%20%22%22%3D%22%22`,
    ];

    return Promise.all(tests.map((url) => fetchWithTimeout(url)));
  });

  // GROUP B: PATH TRAVERSAL
  const traversalResults = await runUntilNotBlocked("path-traversal", async () => {
    const tests = [
      `${BASE}/video/../../etc/passwd`,
      `${BASE}/subtitle/../../secret.env`,
      `${BASE}/thumbnail/..\\..\\windows\\system32`,
    ];
    return Promise.all(tests.map((url) => fetchWithTimeout(url)));
  });

  // GROUP C: AUTHORIZATION (upload + admin + delete)
  const authorizationResults = await runUntilNotBlocked("authorization", async () => {
    const r1 = await postUploadProbe();
    const r2 = await fetchWithTimeout(`${BASE}/admin`);
    const r3 = await fetchWithTimeout(`${BASE}/movies/1`, { method: "DELETE" });
    return [r1, r2, r3];
  });

  // GROUP D: API ABUSE (20 rapid GET /movies)
  const apiAbuseResults = await runUntilNotBlocked("api-abuse", async () => {
    const reqs = [];
    for (let i = 0; i < 20; i++) {
      reqs.push(fetchWithTimeout(`${BASE}/movies`));
    }
    return Promise.all(reqs);
  });

  // GROUP E: ERROR HANDLING
  const errorHandlingResults = await runUntilNotBlocked("error-handling", async () => {
    const r1 = await fetchWithTimeout(`${BASE}/movies/9999999999`);
    const r2 = await fetchWithTimeout(`${BASE}/movies/%2F%2F%2E%2E`);
    // malformed upload: send POST /upload with no files
    const r3 = await fetchWithTimeout(`${BASE}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    return [r1, r2, r3];
  });

  const uploadSecurityResults = authorizationResults.slice(0, 1);

  const outcome = {
    "sql-injection": decideCategoryOutcome({ category: "sql-injection", results: sqlResults }),
    "path-traversal": decideCategoryOutcome({ category: "path-traversal", results: traversalResults }),
    authorization: decideCategoryOutcome({ category: "authorization", results: authorizationResults }),
    "upload-security": decideCategoryOutcome({ category: "upload-security", results: uploadSecurityResults }),
    "error-handling": decideCategoryOutcome({ category: "error-handling", results: errorHandlingResults }),
    "api-abuse": decideCategoryOutcome({ category: "api-abuse", results: apiAbuseResults }),
  };

  const resultPassFail = Object.values(outcome).every((v) => v === "SAFE" || v === "NOT OBSERVED") ? "PASS" : "FAIL";

  // Mandatory output format
  console.log("SYSTEM:");
  console.log("backend/security/api/filesystem");

  console.log("CATEGORY:");
  console.log("sql-injection/traversal/auth/upload/stress/error-handling");

  console.log("TESTED:");
  const flatten = [];
  for (const k of Object.keys(tested)) {
    for (const t of tested[k]) {
      flatten.push(`${t.method} ${t.endpoint} payload=${t.payload}`);
    }
  }
  console.log("(" + flatten.join("; ") + ")");

  console.log("RESULT:");
  console.log(resultPassFail);
  console.log("---");

  console.log("\nSQL INJECTION:");
  console.log(outcome["sql-injection"]);

  console.log("\nPATH TRAVERSAL:");
  console.log(outcome["path-traversal"]);

  console.log("\nAUTHORIZATION:");
  console.log(outcome.authorization);

  console.log("\nUPLOAD SECURITY:");
  console.log(outcome["upload-security"]);

  console.log("\nERROR HANDLING:");
  console.log(outcome["error-handling"]);

  console.log("\nAPI ABUSE:");
  console.log(outcome["api-abuse"]);

  // Optional JSON artifact
  fs.writeFileSync(
    "phase6-report.json",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      passFail: resultPassFail,
      outcome,
      tested,
    }, null, 2)
  );
}

run().catch((err) => {
  // As watchdog is continuous, unexpected crashes here should still be visible.
  console.error("PHASE 6 ENGINE CRASHED:", err);
});

