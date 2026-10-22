const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

let sqliteDb = null;
let pgPool = null;
const isPostgres = Boolean(process.env.DATABASE_URL);

function initDb() {
  if (isPostgres) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    
    // Execute migrations for PostgreSQL
    const initSql = `
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        "start" TEXT NOT NULL,
        "end" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_slot 
      ON bookings(slot_id) WHERE status = 'confirmed';

      CREATE INDEX IF NOT EXISTS idx_bookings_email_created 
      ON bookings(email, created_at, id);

      CREATE TABLE IF NOT EXISTS idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        request_body_hash TEXT NOT NULL,
        status_code INT NOT NULL,
        response_body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limit_attempts (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        timestamp BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_email_ts 
      ON rate_limit_attempts(email, timestamp);
    `;
    
    pgPool.query(initSql).catch(err => {
      console.error('Error initializing PostgreSQL tables:', err);
    });
    return { isPostgres: true, pool: pgPool };
  } else {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
    const defaultDbPath = isServerless ? path.join('/tmp', 'clinic.db') : path.join(__dirname, '..', 'clinic.db');
    const dbPath = process.env.SQLITE_DB_PATH || defaultDbPath;
    sqliteDb = new Database(dbPath);
    if (!isServerless) {
      sqliteDb.pragma('journal_mode = WAL');
    }
    sqliteDb.pragma('foreign_keys = ON');

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        "start" TEXT NOT NULL,
        "end" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_slot 
      ON bookings(slot_id) WHERE status = 'confirmed';

      CREATE INDEX IF NOT EXISTS idx_bookings_email_created 
      ON bookings(email, created_at, id);

      CREATE TABLE IF NOT EXISTS idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        request_body_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rate_limit_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_email_ts 
      ON rate_limit_attempts(email, timestamp);
    `);

    return { isPostgres: false, db: sqliteDb };
  }
}

// Helper methods to abstract database queries
async function query(sql, params = []) {
  if (isPostgres) {
    // Convert ? to $1, $2, etc. for PostgreSQL
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else {
    const stmt = sqliteDb.prepare(sql);
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return stmt.all(...params);
    } else {
      const info = stmt.run(...params);
      return info;
    }
  }
}

async function getOne(sql, params = []) {
  if (isPostgres) {
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows[0] || null;
  } else {
    const stmt = sqliteDb.prepare(sql);
    return stmt.get(...params) || null;
  }
}

// Atomic reset
async function resetAll(slots) {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM slots');
      await client.query('DELETE FROM idempotency_records');
      await client.query('DELETE FROM rate_limit_attempts');

      for (const slot of slots) {
        await client.query(
          'INSERT INTO slots (id, provider, "start", "end") VALUES ($1, $2, $3, $4)',
          [slot.id, slot.provider, slot.start, slot.end]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const runTransaction = sqliteDb.transaction((slotList) => {
      sqliteDb.prepare('DELETE FROM bookings').run();
      sqliteDb.prepare('DELETE FROM slots').run();
      sqliteDb.prepare('DELETE FROM idempotency_records').run();
      sqliteDb.prepare('DELETE FROM rate_limit_attempts').run();

      const insertStmt = sqliteDb.prepare(
        'INSERT INTO slots (id, provider, "start", "end") VALUES (?, ?, ?, ?)'
      );
      for (const slot of slotList) {
        insertStmt.run(slot.id, slot.provider, slot.start, slot.end);
      }
    });
    runTransaction(slots);
  }
}

// Atomic booking creation with strict concurrency locking
async function createBookingTx({ id, slot_id, name, email, created_at, idempotency_key, request_body_hash, response_body }) {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Check if slot exists and is available
      const slotRes = await client.query('SELECT id, "start" FROM slots WHERE id = $1 FOR UPDATE', [slot_id]);
      if (slotRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { error: 'Slot not found', status: 404 };
      }

      const slot = slotRes.rows[0];
      if (new Date(slot.start).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return { error: 'Slot has already started', status: 400 };
      }

      // Check if confirmed booking exists
      const existingRes = await client.query(
        "SELECT id FROM bookings WHERE slot_id = $1 AND status = 'confirmed'",
        [slot_id]
      );
      if (existingRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return { error: 'Slot already booked', status: 409 };
      }

      // Insert booking
      await client.query(
        'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, slot_id, name, email, 'confirmed', created_at]
      );

      // Save idempotency record if present
      if (idempotency_key) {
        await client.query(
          'INSERT INTO idempotency_records (idempotency_key, request_body_hash, status_code, response_body, created_at) VALUES ($1, $2, $3, $4, $5)',
          [idempotency_key, request_body_hash, 201, JSON.stringify(response_body), created_at]
        );
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') { // Unique violation in PG
        return { error: 'Slot already booked', status: 409 };
      }
      throw err;
    } finally {
      client.release();
    }
  } else {
    // In SQLite, wrap in IMMEDIATE transaction to lock for writing immediately
    const runTx = sqliteDb.transaction(() => {
      const slot = sqliteDb.prepare('SELECT id, "start" FROM slots WHERE id = ?').get(slot_id);
      if (!slot) {
        return { error: 'Slot not found', status: 404 };
      }
      if (new Date(slot.start).getTime() <= Date.now()) {
        return { error: 'Slot has already started', status: 400 };
      }

      const existing = sqliteDb.prepare(
        "SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'"
      ).get(slot_id);
      if (existing) {
        return { error: 'Slot already booked', status: 409 };
      }

      try {
        sqliteDb.prepare(
          'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, slot_id, name, email, 'confirmed', created_at);

        if (idempotency_key) {
          sqliteDb.prepare(
            'INSERT INTO idempotency_records (idempotency_key, request_body_hash, status_code, response_body, created_at) VALUES (?, ?, ?, ?, ?)'
          ).run(idempotency_key, request_body_hash, 201, JSON.stringify(response_body), created_at);
        }

        return { success: true };
      } catch (insertErr) {
        if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
          return { error: 'Slot already booked', status: 409 };
        }
        throw insertErr;
      }
    });

    return runTx.immediate();
  }
}

module.exports = {
  initDb,
  query,
  getOne,
  resetAll,
  createBookingTx,
  getDbInstance: () => sqliteDb
};
