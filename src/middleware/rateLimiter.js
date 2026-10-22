const db = require('../db');

async function bookingRateLimiter(req, res, next) {
  const emailRaw = req.body && req.body.email;
  if (!emailRaw || typeof emailRaw !== 'string') {
    // If no email is provided, let validation middleware handle the 400 error
    return next();
  }

  const email = emailRaw.trim().toLowerCase();
  const now = Date.now();
  const windowStart = now - 60000; // 1 minute window

  try {
    // Get attempts in the last 60 seconds
    const attempts = await db.query(
      'SELECT timestamp FROM rate_limit_attempts WHERE email = ? AND timestamp >= ? ORDER BY timestamp ASC',
      [email, windowStart]
    );

    if (attempts.length >= 5) {
      // Record this attempt as well (failed attempts included)
      await db.query(
        'INSERT INTO rate_limit_attempts (email, timestamp) VALUES (?, ?)',
        [email, now]
      );

      // Find when the oldest attempt in the window expires
      const oldestAttempt = attempts[0].timestamp;
      const msRemaining = (oldestAttempt + 60000) - now;
      const retryAfter = Math.max(1, Math.ceil(msRemaining / 1000));

      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many booking attempts for this email. Please try again in ${retryAfter} second(s).`
      });
    }

    // Record this attempt
    await db.query(
      'INSERT INTO rate_limit_attempts (email, timestamp) VALUES (?, ?)',
      [email, now]
    );

    next();
  } catch (err) {
    console.error('Rate limiter error:', err);
    next(err);
  }
}

module.exports = bookingRateLimiter;
