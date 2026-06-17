# Q1 — No Overselling: Atomic Inventory Decrement

**Difficulty:** Medium-Hard · ~25 min · Concurrency, MongoDB

## Task
`POST /api/q1/products/:id/purchase` decrements stock by a requested quantity.
It must **never** let stock go negative, even under hundreds of concurrent
requests for the last few units.

Must handle:
- Correct behavior when two requests race for the last item
- **Reject** (don't silently fail) when not enough stock
- No read-then-write gap

## Strong-signal answer
A single **atomic conditional update** — not read-modify-write:

```js
const result = await Product.findOneAndUpdate(
  { _id: id, stock: { $gte: qty } },   // only matches if enough stock
  { $inc: { stock: -qty } },           // atomic decrement
  { new: true }
);
if (!result) return res.status(409).json({ error: "Insufficient stock" });
```

Why it works: the filter and the `$inc` execute as **one indivisible operation
on the server**. There is no gap between checking and writing. MongoDB takes a
write lock per document, so concurrent updates serialize — for the last unit,
exactly one request matches and decrements; every other request matches zero
documents and is rejected with `409`. Stock can never go below 0.

See [purchase.controller.js](purchase.controller.js) → `purchase`.

### Why the obvious approach is wrong
```js
// ❌ WEAK — oversells under load
const p = await Product.findById(id);
if (p.stock < qty) return res.status(409)...;
p.stock -= qty;
await p.save();
```
Two requests both read `stock = 1`, both pass the check, both save `stock = 0`
(or `-1`). The read-then-write gap is the bug. No amount of validation in JS
closes it because the check and the write aren't atomic.

> Note: the schema's `min: 0` does **not** save you — Mongoose validators do not
> run on `$inc`/update operators, and even on `save()` they'd just throw after
> the race already corrupted the in-memory value. The atomic filter is the real
> guard.

## Curveball — "all three or nothing"
> Now the purchase also has to create an order document **and** charge a wallet
> balance — all three or nothing.

This requires a **multi-document transaction** (`session.withTransaction`),
which in MongoDB needs a **replica set** (a standalone `mongod` can't start a
transaction). Inside the transaction we keep using the same conditional atomic
updates so neither stock nor balance can go negative; if any leg fails, the
whole thing aborts and rolls back.

`POST /api/q1/products/:id/checkout` — body `{ qty, userId }`.
See [purchase.controller.js](purchase.controller.js) → `checkout`.

```js
const session = await mongoose.startSession();
await session.withTransaction(async () => {
  const product = await Product.findOneAndUpdate(
    { _id: id, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { new: true, session });
  if (!product) throw httpError(409, 'Insufficient stock');

  const wallet = await Wallet.findOneAndUpdate(
    { _id: userId, balance: { $gte: product.price * qty } },
    { $inc: { balance: -(product.price * qty) } }, { new: true, session });
  if (!wallet) throw httpError(402, 'Insufficient wallet balance'); // rolls back stock too

  await Order.create([{ productId: id, userId, qty, amount: product.price * qty }], { session });
});
```

> This project boots an **in-memory replica set** automatically (see
> `src/config/memoryServer.js`), so transactions work locally with no install.

## Endpoints
| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| POST | `/api/q1/products/:id/purchase` | `{ qty }` | `200` remaining stock | `409` insufficient / `404` / `400` |
| POST | `/api/q1/products/:id/checkout` | `{ qty, userId }` | `201` order | `409` stock / `402` balance / `400` |

## Tests
```bash
npm run test:q1
```
- [tests/q1-no-overselling/purchase.test.js](../../../tests/q1-no-overselling/purchase.test.js)
  — happy path, 409 rejection, **200 concurrent buyers for 5 units → exactly 5
  succeed**, mixed-quantity race, validation.
- [tests/q1-no-overselling/checkout.test.js](../../../tests/q1-no-overselling/checkout.test.js)
  — transactional rollback when stock/balance insufficient, concurrent checkout race.
