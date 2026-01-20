const { createClient } = require('redis');

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
  console.error('Redis Client Error:', err);
});

// Connect to Redis
async function connectRedis() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
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
    console.error('Redis get error:', error);
    return null; // Return null on error to fall back to database
  }
}

// Cache URL with TTL
async function cacheUrl(shortCode, originalUrl, ttl = defaultTTL) {
  try {
    const key = `url:${shortCode}`;
    await client.setEx(key, ttl, originalUrl);
    console.log(`Cached URL for short code: ${shortCode} (TTL: ${ttl}s)`);
  } catch (error) {
    console.error('Redis set error:', error);
    // Don't throw - caching failure shouldn't break the app
  }
}

// Delete cached URL (for cache invalidation)
async function deleteCachedUrl(shortCode) {
  try {
    const key = `url:${shortCode}`;
    await client.del(key);
    console.log(`Deleted cached URL for short code: ${shortCode}`);
  } catch (error) {
    console.error('Redis delete error:', error);
  }
}

// Close Redis connection
async function closeRedis() {
  try {
    await client.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
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

