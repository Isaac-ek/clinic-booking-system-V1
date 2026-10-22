const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { initDb } = require('./db');
initDb();

const authMiddleware = require('./middleware/auth');
const resetRouter = require('./routes/reset');
const slotsRouter = require('./routes/slots');
const bookingsRouter = require('./routes/bookings');

const app = express();

// Enable CORS for all origins and headers (including X-API-Key and Idempotency-Key)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key']
}));

app.use(express.json());

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected API routes (Level 2 requires X-API-Key on all requests)
app.use('/reset', authMiddleware, resetRouter);
app.use('/slots', authMiddleware, slotsRouter);
app.use('/bookings', authMiddleware, bookingsRouter);

// 404 for unknown endpoints
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
