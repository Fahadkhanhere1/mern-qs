# Q1 — Debug: duplicate ratings under concurrency

**Type:** Debug / concurrency / data-integrity
**Stack:** Express + Mongoose (MongoDB)

## The scenario (what the candidate sees)

A user can rate a product 1–5. A user may have **at most one** rating per
product; rating again should update the existing value. Production occasionally
ends up with **two** rating documents for the same `user + product`. Here is the
code in production:

```js
const RatingSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User' },
  productId: { type: ObjectId, ref: 'Product' },
  value: Number,
});

router.post('/products/:productId/rate', auth, async (req, res) => {
  const existing = await Rating.findOne({ userId, productId });
  if (existing) { existing.value = value; await existing.save(); return res.json(existing); }
  const rating = await Rating.create({ userId, productId, value });
  res.json(rating);
});
```

> "Sometimes we get two rating rows for the same user and product. Find out why,
> and fix it so it can't happen."

The runnable broken version lives in [`rating.buggy.js`](./rating.buggy.js).

---

## Planted issues, ranked by importance

### 1. Race condition (the core bug)
`findOne` → `null` → `create` is **check-then-write (TOCTOU)**. Two concurrent
requests for the same user+product can both run `findOne`, both see `null`, and
both `create`. Result: two documents. The `if (existing)` guard only protects
against *sequential* re-rating, never against *concurrent* first-rating. This is
the root cause and the candidate must name it.

### 2. No DB-level uniqueness constraint (the real fix)
Application code cannot enforce a cross-request invariant — only the database
can. The fix is a **compound unique index**:

```js
RatingSchema.index({ userId: 1, productId: 1 }, { unique: true });
```

Now the database itself guarantees at most one doc per pair, regardless of how
many processes/requests race. **Caveat:** if the collection already contains
duplicates, the index build will **fail** — you must dedupe first.

### 3. Collapse check-then-write into one atomic operation
Replace the two-step logic with a single upsert:

```js
Rating.findOneAndUpdate(
  { userId, productId },
  { $set: { value } },
  { upsert: true, new: true, runValidators: true }
);
```

One round trip, no application-level read-then-write gap.

### 4. No validation of `value`
The buggy schema is `value: Number` with no bounds. `NaN`, `-5`, `999`, `3.5`
all persist. The fix validates an **integer 1–5** both at the request layer
(400 on bad input) and at the schema layer (`min`/`max` + integer check) as
defense in depth.

### 5. Senior nuance — upsert can still throw `E11000`
Even with the unique index, two simultaneous upserts can both miss the existing
doc and both attempt an insert. MongoDB lets one win; the other throws a
duplicate-key error (`code: 11000`). A robust handler **catches `E11000` and
retries as an update**, so the loser still completes successfully. Mentioning
(and handling) this is the difference between a good and a great answer.

---

## Strong vs weak answers

| | Weak | Strong |
|---|---|---|
| Root cause | "Add a check / `if (existing)`" — already there | Names TOCTOU race across concurrent requests |
| Fix location | Tweaks JS logic only | Pushes the invariant down to a **DB unique index** |
| Atomicity | Keeps `findOne` + `create`/`save` | Single atomic `findOneAndUpdate(upsert)` |
| Existing dupes | Ignores them | Knows the index won't build until deduped |
| Race on upsert | Unaware | Catches `E11000` and retries as update |
| Validation | None, or only request-level | Request **and** schema-level integer 1–5 |

A common **AI-generated answer** adds the value validation and maybe switches to
`findOneAndUpdate`, but **keeps the racey structure** (no unique index) or adds
the index without realizing existing duplicates block the build. Probe for the
DB-level guarantee and the dedupe step specifically.

---

## Live probes (ask these)

1. **"Why doesn't your `findOne` guard prevent the duplicate?"**
   Looking for: it's not atomic — two requests interleave between the read and
   the write; both see no existing doc.

2. **"Field order in the index — does `{ productId, userId }` work as well? Why
   pick one order?"**
   Looking for: *either* order enforces uniqueness equally. Order matters for
   *query coverage*: a compound index can serve queries on a left **prefix**, so
   `{ userId, productId }` also accelerates "all ratings by this user", while
   `{ productId, userId }` accelerates "all ratings of this product". Pick the
   order that matches your dominant access pattern.

3. **"You added the unique index to a collection that already has duplicates —
   what happens?"**
   Looking for: the build **fails** (duplicate key). You must remove the
   existing dupes first (keep one per pair), then build the index. See the
   `cleanup-before-index` test for a live demonstration.

---

## Reference fix

- Fixed model (compound unique index + integer 1–5): [`rating.model.js`](./rating.model.js)
- Fixed router (validation + atomic upsert + `E11000` retry): [`rating.routes.js`](./rating.routes.js)
- Broken version (for contrast / the failing test): [`rating.buggy.js`](./rating.buggy.js)

Tests proving each property live in
[`../../../tests/q1-duplicate-ratings/`](../../../tests/q1-duplicate-ratings/).
Run them with `npm run test:q1`.
