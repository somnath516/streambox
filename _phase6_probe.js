const fetch = global.fetch || require('node-fetch');

async function main() {
  const base = 'http://localhost:3000';

  // 1) GET /admin (no auth)
  {
    const r = await fetch(`${base}/admin`);
    const t = await r.text();
    console.log('GET /admin no auth ->', r.status, t);
  }

  // 2) DELETE /movies/1 (no auth)
  {
    const r = await fetch(`${base}/movies/1`, { method: 'DELETE' });
    const t = await r.text();
    console.log('DELETE /movies/1 no auth ->', r.status, t);
  }

  // 3) POST /upload (multipart probe, no auth)
  {
    const boundary = '----SBPHASE6' + Math.random().toString(16).slice(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      '',
      'Phase6',

      `--${boundary}`,
      'Content-Disposition: form-data; name="description"',
      '',
      'probe',

      `--${boundary}`,
      'Content-Disposition: form-data; name="movie"; filename="probe.mp4"',
      'Content-Type: video/mp4',
      '',
      'not-real-mp4-bytes',

      `--${boundary}--`,
      ''
    ].join('\r\n');

    const r = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const t = await r.text();
    console.log('POST /upload probe no auth ->', r.status, t);
  }
}

main().catch((e) => {
  console.error('Probe failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});

