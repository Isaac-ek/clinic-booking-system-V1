const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { provider } = req.query;
    let sql = `
      SELECT 
        s.id,
        s.provider,
        s."start",
        s."end",
        NOT EXISTS (
          SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed'
        ) AS available
      FROM slots s
    `;
    const params = [];

    if (provider !== undefined) {
      sql += ' WHERE s.provider = ?';
      params.push(provider);
    }

    sql += ' ORDER BY s."start" ASC, s.id ASC';

    const rows = await db.query(sql, params);
    const slots = rows.map(r => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: Boolean(r.available)
    }));

    return res.status(200).json({ slots });
  } catch (err) {
    console.error('Error fetching slots:', err);
    return res.status(500).json({ error: 'Internal server error fetching slots' });
  }
});

module.exports = router;
