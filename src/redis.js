const { createClient } = require('redis');
const logger = require('./logger');

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;
const defaultTTL = parseInt(process.env.REDIS_TTL || '3600', 10); // Default 1 hour

// Create Redis client
const client = createClient({
  socket: {
    host: redisHost,
    port: redisPort,
  },
});

// Handle connection errors
client.on('error', (err) => {
  logger.error({ err }, 'Redis Client Error');
});

// Connect to Redis
async function connectRedis() {
  try {
    await client.connect();
    logger.info('Connected to Redis successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to Redis');
    throw error;
  }
}

// Get URL from cache by short code
async function getCachedUrl(shortCode) {
  try {
    const key = `url:${shortCode}`;
    const cachedUrl = await client.get(key);
    return cachedUrl;
  } catch (error) {
    logger.error({ err: error }, 'Redis get error');
    return null; // Return null on error to fall back to database
  }
}

// Cache URL with TTL
async function cacheUrl(shortCode, originalUrl, ttl = defaultTTL) {
  try {
    const key = `url:${shortCode}`;
    await client.setEx(key, ttl, originalUrl);
    logger.info(`Cached URL for short code: ${shortCode} (TTL: ${ttl}s)`);
  } catch (error) {
    logger.error({ err: error }, 'Redis set error');
    // Don't throw - caching failure shouldn't break the app
  }
}

// Delete cached URL (for cache invalidation)
async function deleteCachedUrl(shortCode) {
  try {
    const key = `url:${shortCode}`;
    await client.del(key);
    logger.info(`Deleted cached URL for short code: ${shortCode}`);
  } catch (error) {
    logger.error({ err: error }, 'Redis delete error');
  }
}

// Close Redis connection
async function closeRedis() {
  try {
    await client.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error({ err: error }, 'Error closing Redis connection');
  }
}

module.exports = {
  connectRedis,
  getCachedUrl,
  cacheUrl,
  deleteCachedUrl,
  closeRedis,
  client,
};

