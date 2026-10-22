# Apex Clinic — Booking API & Patient Portal

A resilient clinic booking API and responsive web portal built for Task 1 of the Koya Cohort 4 assessment. Fully compliant with the official OpenAPI 3.0.3 specification at [koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api).

---

## 🚀 Features & Level Progression

### Level 1: Core Slot & Booking Management
- `POST /reset`: Atomically clears existing bookings and replaces all slots with the provided array.
- `GET /slots`: Lists all appointment slots sorted by earliest `start` first. Supports filtering by doctor/specialist (`?provider=Dr%20Ade`). Real-time availability (`available: true/false`).
- `POST /bookings`: Books an appointment slot, returning HTTP 201 with status `confirmed`.
- `GET /bookings/{id}`: Looks up a booking by unique ID.

### Level 2: Strict Authentication & Input Validation
- `X-API-Key` Authentication: Enforced on all API endpoints. Missing or incorrect keys return **401 Unauthorized**.
- Validation & Sanitization:
  - Missing or empty `slot_id`, `name`, or `email` returns **400 Bad Request**.
  - Invalid email formatting returns **400 Bad Request**.
  - Names and emails are automatically trimmed; emails are stored in lowercase.
  - Non-existent `slot_id` returns **404 Not Found**.
  - Attempting to book a slot that has already started returns **400 Bad Request**.

### Level 3: Concurrency Control & Cancellations
- **Race Condition Prevention**: Prevents double-booking even under high-concurrency bursts using database-level unique partial index constraints and immediate serialized transactions. Simultaneous requests for the same slot yield exactly one **201 Created** and all others receive **409 Conflict**.
- `DELETE /bookings/{id}`: Cancels a booking, updates status to `cancelled`, and frees the slot so it can be re-booked immediately.
- Cancelling an already cancelled booking returns **409 Conflict**.

### Level 4: Idempotent Retries & Cursor Pagination
- `Idempotency-Key` Header:
  - Re-sending a request with the same idempotency key and same payload returns the exact same response (same status code and booking ID) without creating duplicate bookings.
  - Reusing an idempotency key with a different payload returns **422 Unprocessable Entity**.
- Cursor Pagination on `GET /bookings`:
  - Query parameters: `email` (case-insensitive match, required), `limit` (integer between 1 and 50, defaults to 10; invalid values return **400**), and `cursor`.
  - Bookings are returned oldest first (`created_at ASC`), with `next_cursor: null` on the final page.

### Level 5: Anti-Spam Rate Limiting
- Enforces a maximum of 5 booking attempts per email per minute (including failed attempts).
- The 6th attempt within 60 seconds returns **429 Too Many Requests** with a `Retry-After` header in whole seconds.
- Other emails are unaffected.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js
- **Framework**: Express
- **Database**: SQLite with WAL mode & ACID transactions (default), with built-in PostgreSQL support via `DATABASE_URL` (for Supabase / Neon / Render Postgres).
- **Frontend**: Accessible HTML5, CSS3 with modern design system (glassmorphism, Google Fonts, micro-animations, responsive layout), and vanilla JavaScript.
- **Specification**: OpenAPI 3.0.3

---

## 📦 Project Structure

```
clinic-booking-system/
├── src/
│   ├── app.js               # Express app configuration & middleware
│   ├── server.js            # Server entry point
│   ├── db.js                # Database abstraction (SQLite & PostgreSQL)
│   ├── middleware/
│   │   ├── auth.js          # X-API-Key validation
│   │   └── rateLimiter.js   # Sliding window per-email rate limiter
│   └── routes/
│       ├── reset.js         # POST /reset
│       ├── slots.js         # GET /slots
│       └── bookings.js      # POST, GET, DELETE /bookings
├── public/
│   ├── index.html           # Patient appointment scheduling web UI
│   ├── style.css            # Modern styling, dark theme & animations
│   └── app.js               # Client-side API integration
├── tests/
│   └── api.test.js          # Full test suite covering Levels 1-5
├── render.yaml              # Render deployment configuration
├── vercel.json              # Vercel deployment configuration
├── package.json
└── README.md
```

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Default configuration:
- `PORT=3000`
- `API_KEY=clinic-secret-key-2026`

### 3. Run Automated Tests
Runs the complete test suite verifying Levels 1 through 5:
```bash
npm test
```

### 4. Start the Application Locally
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Free Deployment Guide

### Option A: Render (Recommended for Persistent SQLite or Free Postgres)
1. Push your repository to GitHub.
2. Sign in to [Render](https://render.com) (free account).
3. Click **New +** -> **Web Service** and connect your GitHub repository.
4. Set:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, set:
   - `API_KEY`: e.g. `clinic-secret-key-2026`
6. Click **Deploy**. Render provides a free `https://<your-service>.onrender.com` URL.

### Option B: Vercel + Neon / Supabase (Serverless)
1. Create a free PostgreSQL database on [Neon.tech](https://neon.tech) or [Supabase](https://supabase.com).
2. Connect your GitHub repository to [Vercel](https://vercel.com).
3. Add environment variables in Vercel project settings:
   - `API_KEY`: `clinic-secret-key-2026`
   - `DATABASE_URL`: `postgresql://<user>:<password>@<host>/<dbname>?sslmode=require`
4. Deploy! Vercel provides a free `https://<your-project>.vercel.app` URL.

---

## 🎥 Loom Video Walkthrough Script (Under 5 Minutes)

When recording your short Loom video, you can follow this 5-minute structure:

1. **Introduction (30s)**:
   - State your name and project goal: "This is Task 1 of the Koya assessment: a resilient Clinic Booking API and patient web portal covering Levels 1 through 5."
2. **Web Page Demo (1m 30s)**:
   - Show the live web portal at your HTTPS URL.
   - Click "Demo Slots" or view available doctor slots.
   - Filter by provider (e.g. Dr Ade).
   - Book a slot: enter name and email.
   - Show the instant confirmation modal with reference ID.
   - Click "View My Bookings" and enter the email to show the confirmed booking with cursor pagination.
   - Cancel the booking: show that the slot status immediately updates back to "Available".
3. **API & Concurrency Architecture (1m 30s)**:
   - Open `src/db.js` and `src/routes/bookings.js`.
   - Highlight the unique partial index: `CREATE UNIQUE INDEX idx_confirmed_slot ON bookings(slot_id) WHERE status = 'confirmed';` preventing race conditions.
   - Show Level 4 Idempotency handling and cursor pagination (`created_at ASC`).
   - Show Level 5 anti-spam sliding-window rate limiting with `Retry-After` header.
4. **Test Suite Execution (1m)**:
   - Run `npm test` in the terminal to show all automated test assertions passing for Levels 1 through 5.
   - Conclude and thank the reviewer.
