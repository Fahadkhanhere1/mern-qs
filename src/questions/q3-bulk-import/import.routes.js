import express from 'express';
import { auth } from '../../middleware/auth.js';
import User from '../../models/User.js';
import { sendWelcomeEmail } from './email.js';
import { pLimit } from './concurrency.js';

/**
 * Q3 — FIXED router: bulk import that survives a 10,000-row production load.
 *
 * POST /import   body: { users: [{ name, email }, ...] }   (auth required)
 *
 * What the buggy version got wrong and how this fixes it
 * ------------------------------------------------------
 *
 * 1. AWAIT THE WORK (don't use forEach).
 *    `forEach` ignores the promise its async callback returns, so the original
 *    handler responded `{ imported: 0 }` before anything finished. Here every task
 *    is awaited via `Promise.all`, so the response reflects real results.
 *
 * 2. BOUNDED CONCURRENCY (not sequential, not unbounded).
 *    - `for...of` + await would be correct but SEQUENTIAL: 10k serial round-trips =
 *      minutes, and the request times out.
 *    - `Promise.all(users.map(create))` is UNBOUNDED: 10k simultaneous DB connections
 *      and 10k simultaneous emails — pool exhaustion and provider rate limits.
 *    - We use `pLimit(CONCURRENCY)` so at most N rows are in flight at once: fast,
 *      but it never stampedes the DB pool or the email provider.
 *
 * 3. PER-ITEM ERROR ISOLATION (one bad row can't sink the batch).
 *    Each row runs in its own try/catch. A failure (duplicate email, missing name,
 *    email-provider rejection) is recorded in `failed: [{ index, email, error }]`
 *    and the other rows still import. No unhandled rejections, so the process never
 *    crashes.
 *
 * 4. MASS-ASSIGNMENT DEFENSE (whitelist).
 *    The buggy `User.create(u)` wrote the raw request object, letting a caller set
 *    privileged fields (`role: 'admin'`, `isVerified: true`) or inject a
 *    `passwordHash`. We `pick` only `name` and `email`; everything else is dropped
 *    and the schema defaults (`role: 'user'`, `isVerified: false`) apply.
 *
 * On the shape of this endpoint
 * -----------------------------
 * Doing 10k creates + 10k emails INSIDE one HTTP handler is the wrong shape for real
 * production: the request is held open for the whole job and a client disconnect
 * orphans it. The senior answer is to enqueue the import as a background job and
 * return `202 Accepted` with a job id the client can poll. See README.md. This file
 * keeps the synchronous bounded version as the primary, testable deliverable, and
 * exposes the async-job behaviour behind `?mode=async` to make the tradeoff concrete.
 */
const router = express.Router();

// At most this many rows in flight at once. In real life, tune to your Mongo pool
// size and email provider's rate limit (and ideally make it configurable).
const CONCURRENCY = 10;

// Only these fields may come from the request body. Everything else (role,
// isVerified, passwordHash, _id, __v, ...) is stripped to prevent mass assignment.
const ALLOWED_FIELDS = ['name', 'email'];

function pick(obj, fields) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const f of fields) {
      if (obj[f] !== undefined) out[f] = obj[f];
    }
  }
  return out;
}

/**
 * Import one row. Resolves to { ok: true, id } or { ok: false, index, email, error }.
 * Never rejects — the caller relies on that so a single failure can't reject the
 * surrounding Promise.all.
 */
async function importOne(rawRow, index) {
  const row = pick(rawRow, ALLOWED_FIELDS); // whitelist: strips role/isVerified/etc.
  try {
    const created = await User.create(row);
    // Side effect AFTER the user exists. If the email fails we still created the
    // user; we surface it as a failed row so the caller can decide to retry just
    // the email rather than re-create the user.
    await sendWelcomeEmail(created.email);
    return { ok: true, id: created._id };
  } catch (err) {
    return {
      ok: false,
      index,
      email: rawRow?.email,
      error: err?.message || 'unknown error',
    };
  }
}

router.post('/import', auth, async (req, res, next) => {
  try {
    const { users } = req.body || {};
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: 'users must be an array' });
    }

    // --- Background-job shape (202 Accepted) -------------------------------
    // Opt-in via ?mode=async to demonstrate the "right shape" for huge imports:
    // acknowledge immediately, do the work detached, let the client poll a job id.
    // (A real implementation would persist the job + push to a queue/worker.)
    if (req.query.mode === 'async') {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Fire-and-forget, but with a .catch so a failure can never become an
      // unhandled rejection (the very bug that crashed the buggy version).
      const limit = pLimit(CONCURRENCY);
      Promise.all(users.map((u, i) => limit(() => importOne(u, i)))).catch(() => {});
      return res.status(202).json({ jobId, status: 'accepted', total: users.length });
    }

    // --- Synchronous bounded version (primary deliverable) -----------------
    const limit = pLimit(CONCURRENCY);
    const settled = await Promise.all(
      users.map((u, i) => limit(() => importOne(u, i)))
    );

    const failed = settled.filter((r) => !r.ok).map(({ index, email, error }) => ({
      index,
      email,
      error,
    }));
    const imported = settled.length - failed.length;

    return res.status(200).json({ imported, failed });
  } catch (err) {
    return next(err);
  }
});

export default router;
