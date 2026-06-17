import mongoose from 'mongoose';

/**
 * Shared User model used by Q3 (bulk import) and Q5 (review).
 *
 * It intentionally contains BOTH safe profile fields and sensitive / privileged
 * fields so the questions can exercise:
 *   - mass assignment (a caller setting `role`/`isVerified` via raw req.body)
 *   - sensitive-field exposure (`passwordHash` leaking through res.json(user))
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Sensitive — must never be returned to clients.
    passwordHash: { type: String, select: true }, // select:true so the bug is reproducible

    // Privileged — must never be settable from a raw request body.
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model('User', userSchema);
