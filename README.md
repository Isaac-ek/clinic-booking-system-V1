# Apex Clinic — Booking API & Patient Portal

🌐 **Live Application & API**: [https://clinic-booking-system-v1.onrender.com/](https://clinic-booking-system-v1.onrender.com/)  
🔑 **API Key (`X-API-Key`)**: `clinic-secret-key-2026`  
📋 **API Spec**: [koyaacademy.com/assessment-api](https://koyaacademy.com/assessment-api)

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



