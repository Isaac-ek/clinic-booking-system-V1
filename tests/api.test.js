const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Ensure clean test database
const testDbPath = path.join(__dirname, 'test-clinic.db');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

process.env.SQLITE_DB_PATH = testDbPath;
process.env.API_KEY = 'test-secret-key-123';
process.env.PORT = '0'; // ephemeral port

const app = require('../src/app');

let server;
let baseUrl;
const API_KEY = 'test-secret-key-123';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body !== null) {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (e) {
            json = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            raw: data
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=========================================');
  console.log('STARTING CLINIC BOOKING SPEC VALIDATION');
  console.log('=========================================\n');

  // Start server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  try {
    // ----------------------------------------------------
    // LEVEL 2 AUTH CHECKS
    // ----------------------------------------------------
    console.log('--> Testing Level 2: Authentication');
    const noAuthRes = await request('GET', '/slots');
    assert.strictEqual(noAuthRes.status, 401, 'Request without X-API-Key must return 401');
    assert.ok(noAuthRes.body.error, 'Error message must be present');

    const badAuthRes = await request('GET', '/slots', null, { 'X-API-Key': 'wrong-key' });
    assert.strictEqual(badAuthRes.status, 401, 'Request with invalid X-API-Key must return 401');

    // ----------------------------------------------------
    // LEVEL 1: RESET & SLOTS LISTING
    // ----------------------------------------------------
    console.log('--> Testing Level 1: Reset & Slot Listing');
    const futureDate1 = new Date(Date.now() + 86400000).toISOString();
    const futureDate1End = new Date(Date.now() + 86400000 + 1800000).toISOString();
    const futureDate2 = new Date(Date.now() + 172800000).toISOString();
    const futureDate2End = new Date(Date.now() + 172800000 + 1800000).toISOString();
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const pastDateEnd = new Date(Date.now() - 1800000).toISOString();

    const sampleSlots = [
      { id: 's2', provider: 'Dr Bello', start: futureDate2, end: futureDate2End },
      { id: 's1', provider: 'Dr Ade', start: futureDate1, end: futureDate1End },
      { id: 's_past', provider: 'Dr Ade', start: pastDate, end: pastDateEnd }
    ];

    const resetRes = await request('POST', '/reset', { slots: sampleSlots }, { 'X-API-Key': API_KEY });
    assert.strictEqual(resetRes.status, 200, 'POST /reset must return 200');

    const slotsRes = await request('GET', '/slots', null, { 'X-API-Key': API_KEY });
    assert.strictEqual(slotsRes.status, 200, 'GET /slots must return 200');
    assert.strictEqual(slotsRes.body.slots.length, 3, 'Must list all 3 slots');
    // Earliest start first check: pastDate < futureDate1 < futureDate2
    assert.strictEqual(slotsRes.body.slots[0].id, 's_past', 'Earliest slot must be first');
    assert.strictEqual(slotsRes.body.slots[1].id, 's1', 'Second earliest slot must be second');
    assert.strictEqual(slotsRes.body.slots[2].id, 's2', 'Latest slot must be third');
    assert.strictEqual(slotsRes.body.slots[0].available, true, 'Slot should be initially available');

    // Provider filter check
    const filterRes = await request('GET', '/slots?provider=Dr%20Bello', null, { 'X-API-Key': API_KEY });
    assert.strictEqual(filterRes.status, 200);
    assert.strictEqual(filterRes.body.slots.length, 1);
    assert.strictEqual(filterRes.body.slots[0].provider, 'Dr Bello');

    // ----------------------------------------------------
    // LEVEL 2: VALIDATIONS
    // ----------------------------------------------------
    console.log('--> Testing Level 2: Input Validations & Normalization');

    // Missing field
    const missingFieldRes = await request('POST', '/bookings', { slot_id: 's1', name: 'Test' }, { 'X-API-Key': API_KEY });
    assert.strictEqual(missingFieldRes.status, 400, 'Missing email must return 400');

    // Invalid email
    const invalidEmailRes = await request('POST', '/bookings', { slot_id: 's1', name: 'Test', email: 'notanemail' }, { 'X-API-Key': API_KEY });
    assert.strictEqual(invalidEmailRes.status, 400, 'Invalid email must return 400');

    // Nonexistent slot
    const notFoundSlotRes = await request('POST', '/bookings', { slot_id: 'nonexistent', name: 'Test', email: 'test@example.com' }, { 'X-API-Key': API_KEY });
    assert.strictEqual(notFoundSlotRes.status, 404, 'Nonexistent slot must return 404');

    // Past slot
    const pastSlotRes = await request('POST', '/bookings', { slot_id: 's_past', name: 'Test', email: 'test@example.com' }, { 'X-API-Key': API_KEY });
    assert.strictEqual(pastSlotRes.status, 400, 'Booking already started slot must return 400');

    // ----------------------------------------------------
    // LEVEL 1: BOOKING & LOOKUP
    // ----------------------------------------------------
    console.log('--> Testing Level 1: Successful Booking & Lookup');
    const bookRes = await request('POST', '/bookings', {
      slot_id: 's1',
      name: '  Ada Obi  ',
      email: '  ADA@EXAMPLE.COM  '
    }, { 'X-API-Key': API_KEY });

    assert.strictEqual(bookRes.status, 201, 'Valid booking must return 201');
    assert.ok(bookRes.body.id, 'Must return generated booking id');
    assert.strictEqual(bookRes.body.slot_id, 's1');
    assert.strictEqual(bookRes.body.name, 'Ada Obi', 'Name must be trimmed');
    assert.strictEqual(bookRes.body.email, 'ada@example.com', 'Email must be trimmed and lowercased');
    assert.strictEqual(bookRes.body.status, 'confirmed');
    assert.ok(bookRes.body.created_at);

    const bookingId = bookRes.body.id;

    // Lookup booking by id
    const lookupRes = await request('GET', `/bookings/${bookingId}`, null, { 'X-API-Key': API_KEY });
    assert.strictEqual(lookupRes.status, 200);
    assert.strictEqual(lookupRes.body.id, bookingId);
    assert.strictEqual(lookupRes.body.email, 'ada@example.com');

    // Check slot is no longer available
    const slotsAfterBooking = await request('GET', '/slots', null, { 'X-API-Key': API_KEY });
    const bookedSlot = slotsAfterBooking.body.slots.find(s => s.id === 's1');
    assert.strictEqual(bookedSlot.available, false, 'Booked slot must have available: false');

    // ----------------------------------------------------
    // LEVEL 3: CONCURRENCY & CANCELLATION
    // ----------------------------------------------------
    console.log('--> Testing Level 3: Concurrency & Booking Cancellation');

    // Already booked slot returns 409
    const doubleBookRes = await request('POST', '/bookings', {
      slot_id: 's1',
      name: 'Bob',
      email: 'bob@example.com'
    }, { 'X-API-Key': API_KEY });
    assert.strictEqual(doubleBookRes.status, 409, 'Booking an already confirmed slot must return 409');

    // Concurrent race test: Fire 10 parallel requests to book slot 's2'
    const concurrentRequests = Array.from({ length: 10 }).map((_, i) =>
      request('POST', '/bookings', {
        slot_id: 's2',
        name: `User ${i}`,
        email: `concurrent${i}@example.com`
      }, { 'X-API-Key': API_KEY })
    );

    const concurrentResponses = await Promise.all(concurrentRequests);
    const successes = concurrentResponses.filter(r => r.status === 201);
    const conflicts = concurrentResponses.filter(r => r.status === 409);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent request must succeed');
    assert.strictEqual(conflicts.length, 9, 'All other concurrent requests must receive 409 conflict');
    console.log('   ✓ Concurrency race test passed: 1 succeeded (201), 9 rejected (409)');

    // Cancel booking
    const cancelRes = await request('DELETE', `/bookings/${bookingId}`, null, { 'X-API-Key': API_KEY });
    assert.strictEqual(cancelRes.status, 200, 'DELETE /bookings/:id must return 200');
    assert.strictEqual(cancelRes.body.status, 'cancelled');

    // Slot s1 is now freed
    const slotsAfterCancel = await request('GET', '/slots', null, { 'X-API-Key': API_KEY });
    const freedSlot = slotsAfterCancel.body.slots.find(s => s.id === 's1');
    assert.strictEqual(freedSlot.available, true, 'Slot must be freed after cancellation');

    // Double cancel returns 409
    const doubleCancelRes = await request('DELETE', `/bookings/${bookingId}`, null, { 'X-API-Key': API_KEY });
    assert.strictEqual(doubleCancelRes.status, 409, 'Cancelling already cancelled booking must return 409');

    // ----------------------------------------------------
    // LEVEL 4: IDEMPOTENCY & PAGINATION
    // ----------------------------------------------------
    console.log('--> Testing Level 4: Idempotency Key & Cursor Pagination');

    const idempKey = 'idemp-key-xyz-123';
    const reqBody1 = { slot_id: 's1', name: 'Idemp Patient', email: 'idemp@example.com' };

    const firstIdempRes = await request('POST', '/bookings', reqBody1, {
      'X-API-Key': API_KEY,
      'Idempotency-Key': idempKey
    });
    assert.strictEqual(firstIdempRes.status, 201);
    const firstBookingId = firstIdempRes.body.id;

    // Retry with SAME idempotency key and SAME body
    const retryIdempRes = await request('POST', '/bookings', reqBody1, {
      'X-API-Key': API_KEY,
      'Idempotency-Key': idempKey
    });
    assert.strictEqual(retryIdempRes.status, 201, 'Retried idempotent request must return same status');
    assert.strictEqual(retryIdempRes.body.id, firstBookingId, 'Retried idempotent request must return same booking ID');

    // Retry with SAME key but DIFFERENT body returns 422
    const diffBodyRes = await request('POST', '/bookings', {
      slot_id: 's1',
      name: 'Different Name',
      email: 'idemp@example.com'
    }, {
      'X-API-Key': API_KEY,
      'Idempotency-Key': idempKey
    });
    assert.strictEqual(diffBodyRes.status, 422, 'Reused key with different body must return 422');

    // Pagination test: Seed 5 slots and bookings for a user
    const paginationSlots = Array.from({ length: 5 }).map((_, i) => ({
      id: `p_slot_${i}`,
      provider: 'Dr Page',
      start: new Date(Date.now() + (i + 10) * 86400000).toISOString(),
      end: new Date(Date.now() + (i + 10) * 86400000 + 1800000).toISOString()
    }));
    await request('POST', '/reset', { slots: paginationSlots }, { 'X-API-Key': API_KEY });

    for (let i = 0; i < 5; i++) {
      await request('POST', '/bookings', {
        slot_id: `p_slot_${i}`,
        name: 'Patient Page',
        email: 'page@example.com'
      }, { 'X-API-Key': API_KEY });
    }

    // Invalid limit check
    const invalidLimitRes = await request('GET', '/bookings?email=page@example.com&limit=0', null, { 'X-API-Key': API_KEY });
    assert.strictEqual(invalidLimitRes.status, 400, 'limit < 1 must return 400');

    const invalidLimitHighRes = await request('GET', '/bookings?email=page@example.com&limit=51', null, { 'X-API-Key': API_KEY });
    assert.strictEqual(invalidLimitHighRes.status, 400, 'limit > 50 must return 400');

    // Page 1 with limit=2
    const page1Res = await request('GET', '/bookings?email=PAGE@EXAMPLE.COM&limit=2', null, { 'X-API-Key': API_KEY });
    assert.strictEqual(page1Res.status, 200);
    assert.strictEqual(page1Res.body.bookings.length, 2);
    assert.ok(page1Res.body.next_cursor, 'next_cursor must be provided when more pages exist');

    // Page 2 using cursor
    const page2Res = await request('GET', `/bookings?email=page@example.com&limit=2&cursor=${encodeURIComponent(page1Res.body.next_cursor)}`, null, { 'X-API-Key': API_KEY });
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.body.bookings.length, 2);
    assert.ok(page2Res.body.next_cursor);

    // Page 3 (final page)
    const page3Res = await request('GET', `/bookings?email=page@example.com&limit=2&cursor=${encodeURIComponent(page2Res.body.next_cursor)}`, null, { 'X-API-Key': API_KEY });
    assert.strictEqual(page3Res.status, 200);
    assert.strictEqual(page3Res.body.bookings.length, 1);
    assert.strictEqual(page3Res.body.next_cursor, null, 'next_cursor must be null on last page');

    // ----------------------------------------------------
    // LEVEL 5: RATE LIMITING (5 attempts / min / email)
    // ----------------------------------------------------
    console.log('--> Testing Level 5: Anti-Spam Rate Limiting');
    const spamEmail = 'spammer@example.com';

    // Reset with plenty of slots
    const spamSlots = Array.from({ length: 10 }).map((_, i) => ({
      id: `spam_slot_${i}`,
      provider: 'Dr Spam',
      start: new Date(Date.now() + (i + 20) * 86400000).toISOString(),
      end: new Date(Date.now() + (i + 20) * 86400000 + 1800000).toISOString()
    }));
    await request('POST', '/reset', { slots: spamSlots }, { 'X-API-Key': API_KEY });

    // Make 5 attempts (even failed attempts count)
    for (let i = 0; i < 5; i++) {
      const res = await request('POST', '/bookings', {
        slot_id: `spam_slot_${i}`,
        name: 'Spam User',
        email: spamEmail
      }, { 'X-API-Key': API_KEY });
      assert.strictEqual(res.status, 201, `Attempt ${i + 1} should be processed`);
    }

    // 6th attempt should return 429 with Retry-After header
    const sixthRes = await request('POST', '/bookings', {
      slot_id: 'spam_slot_6',
      name: 'Spam User',
      email: spamEmail
    }, { 'X-API-Key': API_KEY });

    assert.strictEqual(sixthRes.status, 429, '6th attempt for same email within 1 min must return 429');
    assert.ok(sixthRes.headers['retry-after'], 'Retry-After header must be present');
    const retryAfter = parseInt(sixthRes.headers['retry-after'], 10);
    assert.ok(!isNaN(retryAfter) && retryAfter >= 1 && retryAfter <= 60, 'Retry-After must be integer between 1 and 60');
    console.log(`   ✓ Rate limit enforced: 429 received with Retry-After: ${retryAfter}s`);

    // Other emails are unaffected
    const otherEmailRes = await request('POST', '/bookings', {
      slot_id: 'spam_slot_7',
      name: 'Legit User',
      email: 'legit@example.com'
    }, { 'X-API-Key': API_KEY });
    assert.strictEqual(otherEmailRes.status, 201, 'Other emails must not be affected by rate limit');
    console.log('   ✓ Other emails unaffected by rate limit');

    console.log('\n=========================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! (LEVELS 1-5)');
    console.log('=========================================\n');
  } catch (err) {
    console.error('\nTEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  }
}

runTests();
