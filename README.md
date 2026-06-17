# test-qs-mern

A simple **MERN backend** (MongoDB + Express + Mongoose + Node) scaffold for
working through technical interview questions — **one self-contained folder per
question**, each with its own models, routes, answer writeup, and test scripts.

## Quick start
```bash
npm install
npm start          # boots an in-memory MongoDB replica set if no MONGODB_URI
# -> http://localhost:3000/api   (question index)
```
No MongoDB install needed: if `MONGODB_URI` is unset the server spins up an
**in-memory replica set** automatically (so even transactions work). To use a
real database, copy `.env.example` to `.env` and set `MONGODB_URI` (must be a
replica set if you want transactions).

## Run the tests
```bash
npm test           # all questions
npm run test:q1    # just Q1
```
Tests use Node's built-in test runner + an in-memory replica set — no external
services required.

## Folder structure
```
src/
  server.js                     # boot: connect DB, start HTTP server
  app.js                        # builds the Express app (no port binding)
  config/
    db.js                       # mongoose connect/disconnect
    memoryServer.js             # in-memory replica set (enables transactions)
  questions/
    index.js                    # registry — mounts each question at /api/qN
    q1-no-overselling/          # ── one folder per question ──
      README.md                 #    the answer writeup
      product.model.js
      order.model.js
      wallet.model.js
      purchase.controller.js    #    the actual answer code
      purchase.routes.js
tests/
  helpers/harness.js            # shared: start server + in-memory DB
  q1-no-overselling/
    purchase.test.js            # concurrency / rejection scenarios
    checkout.test.js            # transactional rollback scenarios
```

## Adding the next question
1. Create `src/questions/qN-slug/` with a `*.routes.js` exporting an Express router.
2. Register it in [src/questions/index.js](src/questions/index.js):
   `import qN from './qN-slug/...routes.js'` then `router.use('/qN', qN)`.
3. Add `tests/qN-slug/*.test.js` using `tests/helpers/harness.js`.
4. Write the answer in `src/questions/qN-slug/README.md`.

## Questions
| # | Title | Folder |
|---|---|---|
| Q1 | No Overselling — Atomic Inventory Decrement | [src/questions/q1-no-overselling](src/questions/q1-no-overselling/README.md) |
