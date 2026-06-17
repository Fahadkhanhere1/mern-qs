import mongoose from 'mongoose';
import express from 'express';
import { auth } from '../../middleware/auth.js';

/**
 * Q1 — THE BROKEN VERSION (do not ship this).
 *
 * This file reproduces the production bug so a test can DEMONSTRATE why the
 * application-level guard is insufficient. It is intentionally wrong.
 *
 * Two flaws are baked in here:
 *   1. The model has NO compound unique index — nothing at the DB level stops
 *      two docs for the same (userId, productId).
 *   2. The route does check-then-write: findOne -> (null) -> create. Two
 *      concurrent requests can both read `null` and both `create`, yielding
 *      TWO rating documents. The `if (existing)` branch is a TOCTOU race.
 *
 * Uses a SEPARATE collection (`ratings_buggy`) so its missing index never
 * clashes with the fixed model's `ratings` collection / unique index.
 */
const buggySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    value: { type: Number },
  },
  { timestamps: true, collection: 'ratings_buggy' }
);
// NOTE: no unique index on purpose. No validation on `value` on purpose.

export const RatingBuggy =
  mongoose.models.RatingBuggy || mongoose.model('RatingBuggy', buggySchema);

const router = express.Router();

// BROKEN: check-then-write is not atomic across requests.
router.post('/products/:productId/rate', auth, async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.params;
  const { value } = req.body || {};

  const existing = await RatingBuggy.findOne({ userId, productId });
  if (existing) {
    existing.value = value;
    await existing.save();
    return res.json(existing);
  }
  const rating = await RatingBuggy.create({ userId, productId, value });
  res.json(rating);
});

export default router;
