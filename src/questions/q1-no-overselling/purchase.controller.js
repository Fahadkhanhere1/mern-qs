import mongoose from 'mongoose';
import Product from './product.model.js';
import Order from './order.model.js';
import Wallet from './wallet.model.js';

/**
 * Parse and validate the requested quantity from the request body.
 * Returns a positive integer or throws a 400-style error object.
 */
function parseQty(body) {
  const qty = Number(body?.qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    const err = new Error('qty must be a positive integer');
    err.status = 400;
    throw err;
  }
  return qty;
}

/**
 * POST /api/q1/products/:id/purchase   body: { qty }
 *
 * ---- STRONG-SIGNAL ANSWER -------------------------------------------------
 * A single ATOMIC conditional update. The filter `{ stock: { $gte: qty } }`
 * and the `{ $inc: { stock: -qty } }` happen as one indivisible operation on
 * the server, so there is NO read-then-write gap. Under hundreds of concurrent
 * requests for the last unit, MongoDB serializes the document updates: exactly
 * one wins, the rest match zero documents and are rejected. Stock can never go
 * negative.
 *
 * The WEAK answer is findById -> check stock in JS -> save(). Two requests both
 * read stock=1, both pass the check, both save stock=0 (or -1) => oversold.
 * ---------------------------------------------------------------------------
 */
export async function purchase(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid product id' });
    }
    const qty = parseQty(req.body);

    const result = await Product.findOneAndUpdate(
      { _id: id, stock: { $gte: qty } }, // only match if enough stock
      { $inc: { stock: -qty } }, // atomic decrement
      { new: true }
    );

    if (!result) {
      // Either the product doesn't exist or there wasn't enough stock.
      // Distinguish so the caller gets an honest signal (reject, not silent fail).
      const exists = await Product.exists({ _id: id });
      if (!exists) return res.status(404).json({ error: 'Product not found' });
      return res.status(409).json({ error: 'Insufficient stock' });
    }

    return res.status(200).json({
      ok: true,
      productId: result._id,
      purchased: qty,
      remainingStock: result.stock,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

/**
 * POST /api/q1/products/:id/checkout   body: { qty, userId }
 *
 * ---- CURVEBALL: all-three-or-nothing --------------------------------------
 * "The purchase also has to create an order document AND charge a wallet
 * balance — all three or nothing."
 *
 * This needs a multi-document TRANSACTION (session.withTransaction), which in
 * MongoDB requires a REPLICA SET (or sharded cluster). A standalone mongod
 * cannot start a transaction. Inside the transaction we still use the same
 * conditional atomic updates so neither stock nor balance can go negative; if
 * any step fails (or the conditional update matches nothing), the whole
 * transaction aborts and rolls back — no order, no charge, no decrement.
 * ---------------------------------------------------------------------------
 */
export async function checkout(req, res, next) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid product id' });
  }
  let qty;
  try {
    qty = parseQty(req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const { userId } = req.body || {};
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const session = await mongoose.startSession();
  try {
    let order = null;

    await session.withTransaction(async () => {
      // 1) Atomically decrement stock (only if enough).
      const product = await Product.findOneAndUpdate(
        { _id: id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true, session }
      );
      if (!product) {
        const err = new Error('Insufficient stock');
        err.status = 409;
        throw err;
      }

      const amount = product.price * qty;

      // 2) Atomically debit the wallet (only if enough balance).
      const wallet = await Wallet.findOneAndUpdate(
        { _id: userId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { new: true, session }
      );
      if (!wallet) {
        const err = new Error('Insufficient wallet balance');
        err.status = 402;
        throw err; // aborts -> stock decrement rolls back too
      }

      // 3) Create the order document.
      const created = await Order.create(
        [{ productId: product._id, userId, qty, amount }],
        { session }
      );
      order = { ...created[0].toObject(), remainingStock: product.stock, remainingBalance: wallet.balance };
    });

    return res.status(201).json({ ok: true, order });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  } finally {
    await session.endSession();
  }
}
