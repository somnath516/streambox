# Uptime Monitoring Hook

Create an HTTP monitor:

- URL: `https://streambox.example.com/health`
- Method: `GET`
- Expected status: `200`
- Expected keyword: `"status":"OK"`
- Interval: 30 seconds

Create a second smoke monitor if desired:

- URL: `https://streambox.example.com/health/metrics`
- Expected status: `200`
- Alert if response time exceeds your streaming host baseline.
