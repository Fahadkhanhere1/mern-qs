/**
 * Q1 — Duplicate ratings under concurrency.
 * Run with:  npm run test:q1
 *
 * Each test maps to a planted issue in the interviewer key:
 *   - buggy model allows 2 docs           -> app-level guard is insufficient
 *   - fixed model rejects dup insert      -> DB unique index enforced
 *   - fixed route survives 50 concurrent  -> atomic upsert + index + race retry
 *   - validation rejects bad values       -> integer 1..5 only
 *   - index build fails on dupes          -> must dedupe before indexing
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { startTestServer, stopTestServer, resetDb } from '../helpers/harness.js';
import router from '../../src/questions/q1-duplicate-ratings/rating.routes.js';
import Rating from '../../src/questions/q1-duplicate-ratings/rating.model.js';
import { RatingBuggy } from '../../src/questions/q1-duplicate-ratings/rating.buggy.js';

let server;
let baseUrl;

const MOUNT = '/api/q1';

test.before(async () => {
  ({ server, baseUrl } = await startTestServer(router, MOUNT));
  // Ensure the compound unique index actually exists on the fixed collection
  // before the concurrency / dup-insert tests rely on it.
  await Rating.init();
});

test.after(async () => {
  await stopTestServer(server);
});

test.beforeEach(async () => {
  await resetDb();
  // resetDb only clears documents, not indexes — re-assert the unique index so
  // every test starts from the same enforced state.
  await Rating.init();
});

const USER = '64b7f1c2a1b2c3d4e5f60001';
const PRODUCT = '64b7f1c2a1b2c3d4e5f60777';

function rate(productId, value, userId = USER) {
  return fetch(`${baseUrl}${MOUNT}/products/${productId}/rate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ value }),
  });
}

test('BUGGY: app-level findOne guard allows two docs for the same pair', async () => {
  // Simulate the race outcome directly: no DB unique index means two inserts
  // for the same (userId, productId) both succeed.
  await RatingBuggy.create({ userId: USER, productId: PRODUCT, value: 4 });
  await RatingBuggy.create({ userId: USER, productId: PRODUCT, value: 2 });

  const count = await RatingBuggy.countDocuments({ userId: USER, productId: PRODUCT });
  assert.equal(count, 2, 'buggy model permits duplicate ratings — proves the gap');
});

test('FIXED: compound unique index rejects a duplicate insert (E11000)', async () => {
  await Rating.create({ userId: USER, productId: PRODUCT, value: 5 });

  await assert.rejects(
    () => Rating.create({ userId: USER, productId: PRODUCT, value: 3 }),
    (err) => {
      assert.equal(err.code, 11000, 'duplicate key error expected');
      return true;
    }
  );

  assert.equal(await Rating.countDocuments({ userId: USER, productId: PRODUCT }), 1);
});

test('FIXED ROUTE: 50 concurrent rates -> exactly one doc, all 200', async () => {
  const N = 50;
  const responses = await Promise.all(
    Array.from({ length: N }, (_, i) => rate(PRODUCT, (i % 5) + 1))
  );

  for (const r of responses) {
    assert.equal(r.status, 200, 'every concurrent rate should return 200');
  }

  const docs = await Rating.find({ userId: USER, productId: PRODUCT });
  assert.equal(docs.length, 1, 'exactly one rating doc must exist after the race');

  const submitted = new Set([1, 2, 3, 4, 5]);
  assert.ok(submitted.has(docs[0].value), 'stored value must be one submitted');
});

test('VALIDATION: 0, 6, 3.5, "x" each return 400 and create no document', async () => {
  for (const bad of [0, 6, 3.5, 'x']) {
    const res = await rate(PRODUCT, bad);
    assert.equal(res.status, 400, `value=${JSON.stringify(bad)} should be 400`);
  }
  assert.equal(
    await Rating.countDocuments({ userId: USER, productId: PRODUCT }),
    0,
    'no rating doc should be created for invalid values'
  );
});

test('VALIDATION: a valid integer 1..5 succeeds (sanity)', async () => {
  const res = await rate(PRODUCT, 4);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.value, 4);
});

test('CLEANUP-BEFORE-INDEX: building the unique index on a collection with dupes REJECTS', async () => {
  // Use the buggy (non-unique) collection so we never poison the fixed one.
  await RatingBuggy.create({ userId: USER, productId: PRODUCT, value: 4 });
  await RatingBuggy.create({ userId: USER, productId: PRODUCT, value: 2 });

  await assert.rejects(
    () =>
      RatingBuggy.collection.createIndex(
        { userId: 1, productId: 1 },
        { unique: true }
      ),
    (err) => {
      assert.equal(err.code, 11000, 'unique index build must fail on existing dupes');
      return true;
    }
  );

  // Drop the would-be index attempt's residue isn't needed (it never built),
  // but clear the dupes so we don't leak a non-unique index def to other tests.
  await RatingBuggy.collection.dropIndexes().catch(() => {});
});
