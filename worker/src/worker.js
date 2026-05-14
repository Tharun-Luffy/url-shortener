const { Worker } = require('bullmq');
const logger = require('./logger');
require('dotenv').config();
const { Pool } = require('pg');

// Database connection for worker
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'urlshortener',
});

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;

// Create worker to process analytics jobs
const worker = new Worker(
  'analytics',
  async (job) => {
    const { shortCode, ipAddress, userAgent, timestamp } = job.data;

    logger.info(`Processing analytics job for short code: ${shortCode}`);

    try {
      // Save analytics to database
      const result = await pool.query(
        'INSERT INTO analytics (short_code, ip_address, user_agent, accessed_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [shortCode, ipAddress, userAgent, timestamp || new Date()]
      );

      logger.info(`Analytics saved successfully for short code: ${shortCode} (ID: ${result.rows[0].id})`);
      return { success: true, id: result.rows[0].id };
    } catch (error) {
      logger.error({ err: error }, `Error processing analytics job for ${shortCode}`);
      throw error; // Throw to trigger retry
    }
  },
  {
    connection: {
      host: redisHost,
      port: redisPort,
    },
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 100, // Max 100 jobs
      duration: 1000, // Per second
    },
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  logger.error({ err, jobData: job?.data }, `Job ${job?.id} failed`);
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down worker...');
  await worker.close();
  await pool.end();
  logger.info('Worker shut down gracefully');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Worker service started and listening for analytics jobs...');

