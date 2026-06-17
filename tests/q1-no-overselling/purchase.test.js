/**
 * Q1 — No Overselling: concurrency + rejection tests for the atomic purchase
 * endpoint. Run with:  npm run test:q1
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, stopTestServer, resetDb } from '../helpers/harness.js';
import Product from '../../src/questions/q1-no-overselling/product.model.js';

let server;
let baseUrl;

test.before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await stopTestServer(server);
});

test.beforeEach(resetDb);

function buy(id, qty) {
  return fetch(`${baseUrl}/api/q1/products/${id}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty }),
  });
}

test('happy path: decrements stock and returns remaining', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });

  const res = await buy(p.id, 3);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.remainingStock, 2);

  const fresh = await Product.findById(p.id);
  assert.equal(fresh.stock, 2);
});

test('rejects (409) when not enough stock — does not silently fail', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 2 });

  const res = await buy(p.id, 5);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /insufficient/i);

  const fresh = await Product.findById(p.id);
  assert.equal(fresh.stock, 2, 'stock must be untouched on rejection');
});

test('THE RACE: 200 concurrent buyers, only 5 units — never oversells', async () => {
  const STOCK = 5;
  const BUYERS = 200;
  const p = await Product.create({ name: 'Last Few', price: 10, stock: STOCK });

  // Fire all purchases for 1 unit at the same time.
  const responses = await Promise.all(
    Array.from({ length: BUYERS }, () => buy(p.id, 1))
  );
  const statuses = responses.map((r) => r.status);

  const ok = statuses.filter((s) => s === 200).length;
  const rejected = statuses.filter((s) => s === 409).length;

  assert.equal(ok, STOCK, `exactly ${STOCK} purchases should succeed`);
  assert.equal(rejected, BUYERS - STOCK, 'everyone else must be rejected');

  const fresh = await Product.findById(p.id);
  assert.equal(fresh.stock, 0, 'final stock must be exactly 0, never negative');
});

test('mixed quantities race: total sold never exceeds stock', async () => {
  const STOCK = 10;
  const p = await Product.create({ name: 'Mixed', price: 10, stock: STOCK });

  // Requests for 1, 2 and 3 units interleaved — total demand far exceeds stock.
  const qtys = Array.from({ length: 60 }, (_, i) => (i % 3) + 1);
  const responses = await Promise.all(qtys.map((q) => buy(p.id, q)));

  let sold = 0;
  for (let i = 0; i < responses.length; i++) {
    if (responses[i].status === 200) sold += qtys[i];
  }

  assert.ok(sold <= STOCK, `sold ${sold} must not exceed ${STOCK}`);
  const fresh = await Product.findById(p.id);
  assert.equal(fresh.stock, STOCK - sold);
  assert.ok(fresh.stock >= 0, 'stock must never be negative');
});

test('invalid qty is rejected (400)', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  for (const bad of [0, -1, 1.5, 'x']) {
    const res = await buy(p.id, bad);
    assert.equal(res.status, 400, `qty=${bad} should be 400`);
  }
});

test('unknown product returns 404', async () => {
  const res = await buy('64b7f1c2a1b2c3d4e5f60718', 1);
  assert.equal(res.status, 404);
});
