const express = require('express');
require('dotenv').config();
const { initializeDatabase, getUrlByShortCode, saveUrl, shortCodeExists, pool } = require('./db');
const { generateShortCode, isValidUrl } = require('./utils');
const { connectRedis, getCachedUrl, cacheUrl, closeRedis } = require('./redis');
const { queueAnalytics, closeQueue, getQueueStats } = require('./queue');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'api-service' });
});

// Queue stats endpoint (for monitoring)
app.get('/queue/stats', async (req, res) => {
    try {
        const stats = await getQueueStats();
        if (stats) {
            res.json({ queue: 'analytics', ...stats });
        } else {
            res.status(503).json({ error: 'Queue stats unavailable' });
        }
    } catch (error) {
        console.error('Error getting queue stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Basic root endpoint
app.get('/', (req, res) => {
    res.json({ message: 'URL Shortener API Service' });
});

// POST /shorten - Create a short URL
app.post('/shorten', async (req, res) => {
    try {
        const { url } = req.body;

        // Validate URL
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL format. Must be http:// or https://' });
        }

        // Generate unique short code
        let shortCode;
        let attempts = 0;
        const maxAttempts = 10;

        do {
            shortCode = generateShortCode();
            attempts++;
            if (attempts > maxAttempts) {
                return res.status(500).json({ error: 'Failed to generate unique short code' });
            }
        } while (await shortCodeExists(shortCode));

        // Save to database
        await saveUrl(url, shortCode);

        // Cache the URL in Redis
        await cacheUrl(shortCode, url);

        // Return short link
        const shortLink = `${req.protocol}://${req.get('host')}/${shortCode}`;
        res.status(201).json({
            short_code: shortCode,
            short_url: shortLink,
            original_url: url
        });
    } catch (error) {
        console.error('Error creating short URL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /:code - Redirect to original URL (with Redis caching)
app.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        let originalUrl = null;

        // Step 1: Check Redis cache first (fast path)
        originalUrl = await getCachedUrl(code);

        // Step 2: If cache miss, fetch from database
        if (!originalUrl) {
            originalUrl = await getUrlByShortCode(code);

            // Step 3: If found in DB, cache it for future requests
            if (originalUrl) {
                await cacheUrl(code, originalUrl);
            }
        }

        if (!originalUrl) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        // Queue analytics job (async, non-blocking)
        const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';
        await queueAnalytics(code, ipAddress, userAgent);

        // Redirect to original URL
        res.redirect(302, originalUrl);
    } catch (error) {
        console.error('Error redirecting:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Initialize database and start server
async function startServer() {
    try {
        // Wait for database to be ready (with retries)
        let retries = 5;
        while (retries > 0) {
            try {
                await initializeDatabase();
                break;
            } catch (error) {
                retries--;
                if (retries === 0) {
                    throw error;
                }
                console.log(`Database not ready, retrying in 2 seconds... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Connect to Redis (with retries)
        retries = 5;
        while (retries > 0) {
            try {
                await connectRedis();
                break;
            } catch (error) {
                retries--;
                if (retries === 0) {
                    console.warn('Redis connection failed, continuing without cache');
                    break; // Continue without Redis - app should still work
                }
                console.log(`Redis not ready, retrying in 2 seconds... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Start server
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`API service running on port ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = async () => {
            console.log('Shutdown signal received: closing HTTP server, database, Redis, and queue connections');
            server.close(async () => {
                console.log('HTTP server closed');
                await closeQueue();
                await closeRedis();
                pool.end(() => {
                    console.log('Database connections closed');
                    process.exit(0);
                });
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

