const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'urlshortener',
});

// Initialize database schema
async function initializeDatabase() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS urls (
        id SERIAL PRIMARY KEY,
        short_code VARCHAR(10) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_short_code ON urls(short_code);
      
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY,
        short_code VARCHAR(10) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (short_code) REFERENCES urls(short_code) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_analytics_short_code ON analytics(short_code);
      CREATE INDEX IF NOT EXISTS idx_analytics_accessed_at ON analytics(accessed_at);
    `);
        logger.info('Database schema initialized successfully');
    } catch (error) {
        logger.error({ err: error }, 'Error initializing database');
        throw error;
    }
}

// Get original URL by short code
async function getUrlByShortCode(shortCode) {
    const result = await pool.query(
        'SELECT original_url FROM urls WHERE short_code = $1',
        [shortCode]
    );
    return result.rows[0]?.original_url || null;
}

// Save URL and return short code
async function saveUrl(originalUrl, shortCode) {
    const result = await pool.query(
        'INSERT INTO urls (short_code, original_url) VALUES ($1, $2) RETURNING short_code',
        [shortCode, originalUrl]
    );
    return result.rows[0].short_code;
}

// Check if short code exists
async function shortCodeExists(shortCode) {
    const result = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM urls WHERE short_code = $1)',
        [shortCode]
    );
    return result.rows[0].exists;
}

// Save analytics data
async function saveAnalytics(shortCode, ipAddress, userAgent) {
    const result = await pool.query(
        'INSERT INTO analytics (short_code, ip_address, user_agent) VALUES ($1, $2, $3) RETURNING id',
        [shortCode, ipAddress, userAgent]
    );
    return result.rows[0].id;
}

module.exports = {
    pool,
    initializeDatabase,
    getUrlByShortCode,
    saveUrl,
    shortCodeExists,
    saveAnalytics,
};

