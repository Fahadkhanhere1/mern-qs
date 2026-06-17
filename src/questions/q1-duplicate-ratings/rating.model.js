import mongoose from 'mongoose';

/**
 * Q1 — FIXED rating model.
 *
 * A user may have AT MOST ONE rating per product. The ONLY thing that can
 * enforce that invariant across multiple processes / concurrent requests is a
 * DB-level **compound unique index** on `{ userId, productId }`. Application
 * code (`findOne` then `create`) cannot — see `rating.buggy.js`.
 *
 * `value` is constrained to an INTEGER in 1..5 at the schema level so bad data
 * (NaN, -5, 999, 3.5) can never be persisted even if a caller bypasses the
 * route-level validation.
 */
const ratingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    value: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'value must be an integer',
      },
    },
  },
  { timestamps: true }
);

// THE FIX: one rating per (userId, productId), enforced by the database.
// Field order chosen as { userId, productId } because lookups are "a user's
// rating for a product" and the index also serves "all ratings BY a user"
// (prefix { userId }). It still enforces uniqueness regardless of order.
ratingSchema.index({ userId: 1, productId: 1 }, { unique: true });

export default mongoose.models.Rating || mongoose.model('Rating', ratingSchema);
