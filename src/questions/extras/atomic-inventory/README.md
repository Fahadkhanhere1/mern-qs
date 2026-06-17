# Extra — No Overselling: Atomic Inventory Decrement

> Bonus question (predates the 5-question bank). Same concurrency muscle as
> [Q1](../../q1-duplicate-ratings/README.md): the fix is a single atomic
> conditional update, not read-modify-write.

`POST /api/extras/inventory/products/:id/purchase` decrements stock and must
never let it go negative under hundreds of concurrent requests.

## Strong-signal answer
```js
const result = await Product.findOneAndUpdate(
  { _id: id, stock: { $gte: qty } },   // only matches if enough stock
  { $inc: { stock: -qty } },           // atomic decrement
  { new: true }
);
if (!result) return res.status(409).json({ error: "Insufficient stock" });
```
The filter + `$inc` are one indivisible server-side op — no read-then-write gap.
The weak answer (`findById` → check → `save()`) oversells: two requests both
read `stock = 1`, both pass, both save.

## Curveball — "all three or nothing"
`POST /api/extras/inventory/products/:id/checkout` does stock + order + wallet in
a `session.withTransaction` (requires a replica set; the app boots an in-memory
one automatically).

## Tests
```bash
npm run test:extras
```
