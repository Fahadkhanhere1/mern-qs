/**
 * Extra — No Overselling: concurrency + rejection tests for the atomic purchase
 * endpoint. Run with:  npm run test:extras
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, stopTestServer, resetDb } from '../../helpers/harness.js';
import router from '../../../src/questions/extras/atomic-inventory/purchase.routes.js';
import Product from '../../../src/questions/extras/atomic-inventory/product.model.js';

let server;
let baseUrl;

test.before(async () => {
  ({ server, baseUrl } = await startTestServer(router, '/api/extras/inventory'));
});

test.after(async () => {
  await stopTestServer(server);
});

test.beforeEach(resetDb);

function buy(id, qty) {
  return fetch(`${baseUrl}/api/extras/inventory/products/${id}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty }),
  });
}

test('happy path: decrements stock and returns remaining', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  const res = await buy(p.id, 3);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).remainingStock, 2);
});

test('rejects (409) when not enough stock — does not silently fail', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 2 });
  const res = await buy(p.id, 5);
  assert.equal(res.status, 409);
  assert.equal((await Product.findById(p.id)).stock, 2);
});

test('THE RACE: 200 concurrent buyers, only 5 units — never oversells', async () => {
  const STOCK = 5;
  const BUYERS = 200;
  const p = await Product.create({ name: 'Last Few', price: 10, stock: STOCK });

  const responses = await Promise.all(
    Array.from({ length: BUYERS }, () => buy(p.id, 1))
  );
  const ok = responses.filter((r) => r.status === 200).length;

  assert.equal(ok, STOCK, `exactly ${STOCK} purchases should succeed`);
  assert.equal((await Product.findById(p.id)).stock, 0, 'final stock must be 0, never negative');
});

test('invalid qty is rejected (400)', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  for (const bad of [0, -1, 1.5, 'x']) {
    assert.equal((await buy(p.id, bad)).status, 400, `qty=${bad} should be 400`);
  }
});

test('unknown product returns 404', async () => {
  assert.equal((await buy('64b7f1c2a1b2c3d4e5f60718', 1)).status, 404);
});
