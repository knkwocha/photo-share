require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const authRoutes     = require('./routes/auth');
const photoRoutes    = require('./routes/photos');
const commentRoutes  = require('./routes/comments');
const userRoutes     = require('./routes/users');

const app = express();

// ─── Security & middleware ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/photos',  photoRoutes);
app.use('/api/photos/:photoId/comments', commentRoutes);
app.use('/api/users',   userRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ service: 'PhotoShare API', version: '1.0.0', docs: '/health' });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File too large (max 20MB)' });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PhotoShare API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origin: ${process.env.CORS_ORIGIN || '*'}`);
});

module.exports = app;
