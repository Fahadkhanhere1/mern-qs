import express from 'express';
import mongoose from 'mongoose';
import { auth } from '../../middleware/auth.js';
import Rating from './rating.model.js';

/**
 * Q1 — FIXED router.
 *
 * POST /products/:productId/rate   body: { value }   (auth required)
 *
 * Three things make this correct where the buggy version is not:
 *
 *   1. VALIDATION: `value` must be an integer 1..5, else 400 (and nothing is
 *      written). This stops NaN / -5 / 999 / 3.5 from ever reaching the DB.
 *
 *   2. ATOMIC UPSERT: a single `findOneAndUpdate(..., { upsert: true })`
 *      replaces the racey findOne-then-create. There is no read-then-write gap
 *      in application code: either the matching doc is updated, or one is
 *      inserted, in one round trip.
 *
 *   3. DB-ENFORCED UNIQUENESS + RACE HANDLING: the model's compound unique
 *      index guarantees at most one doc per (userId, productId). On a true
 *      concurrent-insert race, two upserts can both miss the existing doc and
 *      both try to insert; MongoDB lets exactly one win and the other throws
 *      E11000. We catch that and retry as a plain update, so the loser still
 *      succeeds with the correct value. The caller never sees the race.
 */
const router = express.Router();

function parseValue(body) {
  // Reject non-numbers, non-integers, and out-of-range up front.
  const value = body?.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    return null;
  }
  return value;
}

router.post('/products/:productId/rate', auth, async (req, res, next) => {
  const userId = req.user.id;
  const { productId } = req.params;

  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ error: 'Invalid product id' });
  }

  const value = parseValue(req.body);
  if (value === null) {
    return res.status(400).json({ error: 'value must be an integer between 1 and 5' });
  }

  try {
    const rating = await Rating.findOneAndUpdate(
      { userId, productId },
      { $set: { value } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json(rating);
  } catch (err) {
    // Senior nuance: even upsert + unique index can collide on a concurrent
    // insert race. Treat the duplicate key as "already exists" and update it.
    if (err && err.code === 11000) {
      const rating = await Rating.findOneAndUpdate(
        { userId, productId },
        { $set: { value } },
        { new: true, runValidators: true }
      );
      return res.status(200).json(rating);
    }
    return next(err);
  }
});

export default router;
