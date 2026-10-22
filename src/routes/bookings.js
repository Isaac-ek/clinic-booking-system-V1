const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const bookingRateLimiter = require('../middleware/rateLimiter');

// Email regex pattern for validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /bookings (Levels 1-5)
router.post('/', bookingRateLimiter, async (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key');
  const requestBodyHash = JSON.stringify(req.body);

  // Level 4: Idempotency Key Handling
  if (idempotencyKey) {
    try {
      const existingRecord = await db.getOne(
        'SELECT idempotency_key, request_body_hash, status_code, response_body FROM idempotency_records WHERE idempotency_key = ?',
        [idempotencyKey]
      );

      if (existingRecord) {
        if (existingRecord.request_body_hash === requestBodyHash) {
          return res.status(existingRecord.status_code).json(JSON.parse(existingRecord.response_body));
        } else {
          return res.status(422).json({
            error: 'Idempotency-Key reused with a different request body'
          });
        }
      }
    } catch (err) {
      console.error('Idempotency lookup error:', err);
      return res.status(500).json({ error: 'Internal server error checking idempotency' });
    }
  }

  // Level 2: Field presence and type checks
  const { slot_id, name, email } = req.body || {};

  if (!slot_id || typeof slot_id !== 'string' || !slot_id.trim()) {
    return res.status(400).json({ error: 'slot_id is required and cannot be empty' });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required and cannot be empty' });
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required and cannot be empty' });
  }

  // Trim and lowercase normalization
  const cleanSlotId = slot_id.trim();
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  // Email format validation
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Generate unique booking id
  const bookingId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const newBooking = {
    id: bookingId,
    slot_id: cleanSlotId,
    name: cleanName,
    email: cleanEmail,
    status: 'confirmed',
    created_at: createdAt
  };

  try {
    const result = await db.createBookingTx({
      id: bookingId,
      slot_id: cleanSlotId,
      name: cleanName,
      email: cleanEmail,
      created_at: createdAt,
      idempotency_key: idempotencyKey,
      request_body_hash: requestBodyHash,
      response_body: newBooking
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(201).json(newBooking);
  } catch (err) {
    console.error('Booking creation error:', err);
    return res.status(500).json({ error: 'Internal server error creating booking' });
  }
});

// GET /bookings (Level 4: List a person's bookings with cursor pagination)
router.get('/', async (req, res) => {
  const { email, limit: rawLimit, cursor } = req.query;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email query parameter is required' });
  }

  let limit = 10;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return res.status(400).json({ error: 'limit must be an integer between 1 and 50' });
    }
    limit = parsed;
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    let sql = `
      SELECT id, slot_id, name, email, status, created_at
      FROM bookings
      WHERE LOWER(email) = LOWER(?)
    `;
    const params = [cleanEmail];

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        if (decoded.created_at && decoded.id) {
          sql += ` AND (created_at > ? OR (created_at = ? AND id > ?))`;
          params.push(decoded.created_at, decoded.created_at, decoded.id);
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid cursor parameter' });
      }
    }

    // Oldest first
    sql += ` ORDER BY created_at ASC, id ASC LIMIT ?`;
    params.push(limit + 1);

    const rows = await db.query(sql, params);

    let nextCursor = null;
    let results = rows;

    if (rows.length > limit) {
      results = rows.slice(0, limit);
      const last = results[results.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ created_at: last.created_at, id: last.id })
      ).toString('base64');
    }

    return res.status(200).json({
      bookings: results.map(b => ({
        id: b.id,
        slot_id: b.slot_id,
        name: b.name,
        email: b.email,
        status: b.status,
        created_at: b.created_at
      })),
      next_cursor: nextCursor
    });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    return res.status(500).json({ error: 'Internal server error fetching bookings' });
  }
});

// GET /bookings/:id (Level 1: Get a booking)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const booking = await db.getOne(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?',
      [id]
    );

    if (!booking) {
      return res.status(404).json({ error: 'No booking with that id' });
    }

    return res.status(200).json({
      id: booking.id,
      slot_id: booking.slot_id,
      name: booking.name,
      email: booking.email,
      status: booking.status,
      created_at: booking.created_at
    });
  } catch (err) {
    console.error('Error fetching booking by id:', err);
    return res.status(500).json({ error: 'Internal server error fetching booking' });
  }
});

// DELETE /bookings/:id (Level 3: Cancel a booking)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const booking = await db.getOne(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?',
      [id]
    );

    if (!booking) {
      return res.status(404).json({ error: 'No booking with that id' });
    }

    if (booking.status === 'cancelled') {
      return res.status(409).json({ error: 'Booking already cancelled' });
    }

    await db.query('UPDATE bookings SET status = ? WHERE id = ?', ['cancelled', id]);

    return res.status(200).json({
      id: booking.id,
      slot_id: booking.slot_id,
      name: booking.name,
      email: booking.email,
      status: 'cancelled',
      created_at: booking.created_at
    });
  } catch (err) {
    console.error('Error cancelling booking:', err);
    return res.status(500).json({ error: 'Internal server error cancelling booking' });
  }
});

module.exports = router;
