const request = require('supertest');
const app = require('../src/server');
const { pool } = require('../src/db');
const { client, closeRedis } = require('../src/redis');
const { closeQueue } = require('../src/queue');

// Mock external dependencies if needed, or use service containers in CI.
// Here we'll just test the /health endpoint without a DB connection for simplicity.
// For full integration tests, we'll need real PG and Redis running.

describe('API Endpoints', () => {
    
  // Cleanup after all tests
  afterAll(async () => {
    // Gracefully close any connections so Jest doesn't hang
    await pool.end();
    if (client.isOpen) {
      await closeRedis();
    }
    await closeQueue();
  });

  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });
  });

  describe('GET /', () => {
    it('should return welcome message', async () => {
      const res = await request(app).get('/');
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toContain('URL Shortener');
    });
  });
  
  describe('POST /shorten', () => {
    it('should require a url parameter', async () => {
      const res = await request(app)
        .post('/shorten')
        .send({});
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'URL is required');
    });

    it('should validate url format', async () => {
      const res = await request(app)
        .post('/shorten')
        .send({ url: 'not-a-valid-url' });
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toContain('Invalid URL format');
    });
    it('should create a short URL with a valid custom alias', async () => {
      // Need a random alias to avoid conflict if tests run multiple times
      const alias = 'test-alias-' + Math.floor(Math.random() * 10000);
      const res = await request(app)
        .post('/shorten')
        .send({ url: 'https://example.com', alias });
      
      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('short_code', alias);
    });

    it('should reject invalid alias formats', async () => {
      const res = await request(app)
        .post('/shorten')
        .send({ url: 'https://example.com', alias: 'invalid alias spaces!' });
      
      expect(res.statusCode).toEqual(400);
      expect(res.body.error).toContain('Invalid alias format');
    });

    it('should return 409 if alias already exists', async () => {
      const alias = 'conflict-alias-' + Math.floor(Math.random() * 10000);
      // Create it once
      await request(app)
        .post('/shorten')
        .send({ url: 'https://example.com', alias });
        
      // Try to create it again
      const res = await request(app)
        .post('/shorten')
        .send({ url: 'https://example.org', alias });
        
      expect(res.statusCode).toEqual(409);
      expect(res.body.error).toContain('already in use');
    });
  });
});
