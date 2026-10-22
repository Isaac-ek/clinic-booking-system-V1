const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', async (req, res) => {
  const { slots } = req.body || {};

  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: 'Body must contain a "slots" array' });
  }

  // Validate each slot has id, provider, start, end
  for (const slot of slots) {
    if (!slot.id || !slot.provider || !slot.start || !slot.end) {
      return res.status(400).json({
        error: 'Each slot must include id, provider, start, and end'
      });
    }
  }

  try {
    await db.resetAll(slots);
    return res.status(200).json({ message: 'Done' });
  } catch (err) {
    console.error('Error during reset:', err);
    return res.status(500).json({ error: 'Internal server error during reset' });
  }
});

module.exports = router;
