import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    // The contended field. min: 0 is a schema-level guard, but the *real*
    // protection against overselling is the conditional atomic update in the
    // controller — schema validators do NOT run on $inc updates.
    stock: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Product || mongoose.model('Product', productSchema);
