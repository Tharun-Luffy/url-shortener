const { Queue } = require('bullmq');
const logger = require('./logger');

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;

// Create analytics queue
const analyticsQueue = new Queue('analytics', {
  connection: {
    host: redisHost,
    port: redisPort,
  },
  defaultJobOptions: {
    attempts: 3, // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2 seconds, then 4s, 8s...
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours
    },
  },
});

// Add analytics job to queue
async function queueAnalytics(shortCode, ipAddress, userAgent) {
  try {
    await analyticsQueue.add('log-analytics', {
      shortCode,
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString(),
    });
    logger.info(`Queued analytics job for short code: ${shortCode}`);
  } catch (error) {
    logger.error({ err: error }, 'Error queueing analytics job');
    // Don't throw - queue failure shouldn't break the redirect
  }
}

// Get queue stats (for monitoring)
async function getQueueStats() {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      analyticsQueue.getWaitingCount(),
      analyticsQueue.getActiveCount(),
      analyticsQueue.getCompletedCount(),
      analyticsQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error getting queue stats');
    return null;
  }
}

// Close queue connection
async function closeQueue() {
  try {
    await analyticsQueue.close();
    logger.info('Analytics queue closed');
  } catch (error) {
    logger.error({ err: error }, 'Error closing queue');
  }
}

module.exports = {
  queueAnalytics,
  getQueueStats,
  closeQueue,
  analyticsQueue,
};

