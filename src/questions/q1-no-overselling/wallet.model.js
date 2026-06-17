import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true },
    // Like stock, the balance is decremented with a conditional atomic update
    // so a wallet can never go negative.
    balance: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
