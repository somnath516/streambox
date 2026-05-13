const request = require('supertest');
const app = require('../server');
const path = require('path');
const fs = require('fs');

describe('StreamBox API Tests', () => {
  test('GET /movies returns array', async () => {
    const res = await request(app).get('/movies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /upload rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/upload')
      .field('title', 'Test');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('POST /upload rejects exe thumbnail after auth', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Authorization', 'Bearer STREAMBOX_ADMIN')
      .field('title', 'Test')
      .attach('thumbnail', path.join(__dirname, 'test.exe')); // Fake exe

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request failed' });
  });

  test('GET /health OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });
});

