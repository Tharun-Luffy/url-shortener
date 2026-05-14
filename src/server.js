const express = require('express');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const logger = require('./logger');
require('dotenv').config();
const { initializeDatabase, getUrlByShortCode, saveUrl, shortCodeExists, pool } = require('./db');
const { generateShortCode, isValidUrl, isValidAlias } = require('./utils');
const { connectRedis, getCachedUrl, cacheUrl, closeRedis, client } = require('./redis');
const { queueAnalytics, closeQueue, getQueueStats } = require('./queue');
const rateLimit = require('express-rate-limit');
let RedisStore = require('rate-limit-redis');
if (RedisStore.default) RedisStore = RedisStore.default;
else if (RedisStore.RedisStore) RedisStore = RedisStore.RedisStore;
const promClient = require('prom-client');

// Initialize Prometheus metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'url_shortener_' });

const httpRequestsTotal = new promClient.Counter({
  name: 'url_shortener_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const shortenTotal = new promClient.Counter({
  name: 'url_shortener_shorten_total',
  help: 'Total number of URLs shortened'
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(pinoHttp({ logger }));

// Metrics middleware
app.use((req, res, next) => {
    res.on('finish', () => {
        // Don't track /metrics or /health to avoid polluting real traffic stats
        if (req.path !== '/metrics' && req.path !== '/healthz' && req.path !== '/ready') {
            httpRequestsTotal.inc({
                method: req.method,
                route: req.route ? req.route.path : req.path,
                status_code: res.statusCode
            });
        }
    });
    next();
});

// Swagger setup
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /healthz:
 *   get:
 *     summary: Kubernetes liveness probe
 *     responses:
 *       200:
 *         description: OK
 */
app.get('/healthz', (req, res) => {
    res.status(200).send('ok');
});

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Kubernetes readiness probe
 *     responses:
 *       200:
 *         description: Ready to serve traffic
 *       503:
 *         description: Dependencies not ready
 */
app.get('/ready', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        if (!client.isReady) throw new Error('Redis not ready');
        res.status(200).send('ready');
    } catch (e) {
        logger.error({ err: e }, 'Readiness check failed');
        res.status(503).send('not ready');
    }
});

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Prometheus metrics endpoint
 *     responses:
 *       200:
 *         description: Metrics payload
 */
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.send(await promClient.register.metrics());
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the operational status of the API
 *     responses:
 *       200:
 *         description: Service is healthy
 */
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'api-service' });
});

/**
 * @swagger
 * /queue/stats:
 *   get:
 *     summary: Get BullMQ queue statistics
 *     description: Returns metrics about the analytics background processing queue
 *     responses:
 *       200:
 *         description: Queue stats retrieved successfully
 *       503:
 *         description: Queue stats unavailable
 *       500:
 *         description: Internal server error
 */
app.get('/queue/stats', async (req, res) => {
    try {
        const stats = await getQueueStats();
        if (stats) {
            res.json({ queue: 'analytics', ...stats });
        } else {
            res.status(503).json({ error: 'Queue stats unavailable' });
        }
    } catch (error) {
        logger.error({ err: error }, 'Error getting queue stats');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: Basic root endpoint
 *     responses:
 *       200:
 *         description: Welcome message
 */
app.get('/', (req, res) => {
    res.json({ message: 'URL Shortener API Service' });
});

// Rate Limiter configuration for URL creation
const shortenRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 URL creations per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        sendCommand: (...args) => client.sendCommand(args),
    }),
    handler: (req, res, next, options) => {
        logger.warn({ ip: req.ip }, 'Rate limit exceeded for URL creation');
        res.status(options.statusCode).json({ error: 'Too many requests, please try again later.' });
    }
});

/**
 * @swagger
 * /shorten:
 *   post:
 *     summary: Create a short URL
 *     description: Takes a long URL and generates a unique short code for it
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 example: https://github.com/
 *               alias:
 *                 type: string
 *                 description: Optional custom short code (alphanumeric and hyphens, max 30 chars)
 *                 example: my-resume
 *     responses:
 *       201:
 *         description: Short URL created successfully
 *       400:
 *         description: Invalid input URL or alias
 *       409:
 *         description: Custom alias already in use
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
app.post('/shorten', shortenRateLimiter, async (req, res) => {
    try {
        const { url, alias } = req.body;

        // Validate URL
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({ error: 'Invalid URL format. Must be http:// or https://' });
        }

        let shortCode;

        if (alias) {
            // Validate custom alias
            if (!isValidAlias(alias)) {
                return res.status(400).json({ error: 'Invalid alias format. Use only alphanumeric characters and hyphens (max 30 chars).' });
            }
            
            // Check if alias exists
            if (await shortCodeExists(alias)) {
                return res.status(409).json({ error: 'Custom alias is already in use' });
            }
            shortCode = alias;
        } else {
            // Generate unique random short code
            let attempts = 0;
            const maxAttempts = 10;
            do {
                shortCode = generateShortCode();
                attempts++;
                if (attempts > maxAttempts) {
                    return res.status(500).json({ error: 'Failed to generate unique short code' });
                }
            } while (await shortCodeExists(shortCode));
        }

        // Save to database
        await saveUrl(url, shortCode);

        // Cache the URL in Redis
        await cacheUrl(shortCode, url);

        shortenTotal.inc(); // Increment metric

        // Return short link
        const shortLink = `${req.protocol}://${req.get('host')}/${shortCode}`;
        res.status(201).json({
            short_code: shortCode,
            short_url: shortLink,
            original_url: url
        });
    } catch (error) {
        logger.error({ err: error }, 'Error creating short URL');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /{code}:
 *   get:
 *     summary: Redirect to original URL
 *     description: Looks up the original URL for a given short code and redirects
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: The short code
 *     responses:
 *       302:
 *         description: Redirects to the original URL
 *       404:
 *         description: Short URL not found
 *       500:
 *         description: Server error
 */
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
        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';
        await queueAnalytics(code, ipAddress, userAgent);

        // Redirect to original URL
        res.redirect(302, originalUrl);
    } catch (error) {
        logger.error({ err: error }, 'Error redirecting');
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
                logger.warn(`Database not ready, retrying in 2 seconds... (${retries} retries left)`);
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
                    logger.warn('Redis connection failed, continuing without cache');
                    break; // Continue without Redis - app should still work
                }
                logger.warn(`Redis not ready, retrying in 2 seconds... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Start server
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`API service running on port ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = async () => {
            logger.info('Shutdown signal received: closing HTTP server, database, Redis, and queue connections');
            server.close(async () => {
                logger.info('HTTP server closed');
                await closeQueue();
                await closeRedis();
                pool.end(() => {
                    logger.info('Database connections closed');
                    process.exit(0);
                });
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        
        return server;
    } catch (error) {
        logger.error({ err: error }, 'Failed to start server');
        process.exit(1);
    }
}

// Only run if called directly (not in tests)
if (require.main === module) {
    startServer();
}

module.exports = app;
