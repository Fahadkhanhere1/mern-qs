import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
    qty: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['paid'], default: 'paid' },
  },
  { timestamps: true }
);

export default mongoose.models.Order || mongoose.model('Order', orderSchema);
