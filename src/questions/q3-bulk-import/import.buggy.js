import express from 'express';
import { auth } from '../../middleware/auth.js';
import User from '../../models/User.js';
import { sendWelcomeEmail } from './email.js';

/**
 * Q3 — THE BROKEN VERSION (do not ship this).
 *
 * This is the code the candidate is handed. "Works in dev with 3 users, melts in
 * prod with 10,000." It reproduces the production behaviour so a test can prove the
 * headline bug.
 *
 * The defect: `Array.prototype.forEach` does NOT await its async callback. `forEach`
 * fires the callback for every element and returns synchronously; it ignores the
 * promise each `async` callback returns. So:
 *
 *   - The loop "completes" instantly without waiting for a single `User.create`.
 *   - `res.json({ imported: results.length })` runs while `results` is still empty,
 *     so the client gets `{ imported: 0 }` even though work is (eventually) happening
 *     in the background, detached from the request.
 *   - Any rejection inside the callback (duplicate email, validation error, email
 *     provider failure) becomes an UNHANDLED PROMISE REJECTION — nobody is awaiting
 *     it. Users are silently not created, and under Node's default the process can be
 *     killed on an unhandled rejection ("occasionally the process crashes").
 *
 * Uses a raw `User.create(u)`, which ALSO has a mass-assignment hole (`role`,
 * `isVerified` ride along from the request body) — see the fixed router.
 */
const router = express.Router();

// BROKEN: forEach ignores the async callback's promise.
router.post('/import', auth, async (req, res) => {
  const { users } = req.body; // array of user objects
  const results = [];
  users.forEach(async (u) => {
    const created = await User.create(u);
    await sendWelcomeEmail(created.email);
    results.push(created._id);
  });
  // Runs immediately — results is still empty here. Client sees { imported: 0 }.
  res.json({ imported: results.length });
});

export default router;
