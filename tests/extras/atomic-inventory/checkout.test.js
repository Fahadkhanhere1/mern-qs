/**
 * Extra — transactional checkout: stock + order + wallet, all-or-nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, stopTestServer, resetDb } from '../../helpers/harness.js';
import router from '../../../src/questions/extras/atomic-inventory/purchase.routes.js';
import Product from '../../../src/questions/extras/atomic-inventory/product.model.js';
import Wallet from '../../../src/questions/extras/atomic-inventory/wallet.model.js';
import Order from '../../../src/questions/extras/atomic-inventory/order.model.js';

let server;
let baseUrl;

test.before(async () => {
  ({ server, baseUrl } = await startTestServer(router, '/api/extras/inventory'));
});

test.after(async () => {
  await stopTestServer(server);
});

test.beforeEach(resetDb);

function checkout(id, qty, userId) {
  return fetch(`${baseUrl}/api/extras/inventory/products/${id}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty, userId }),
  });
}

test('happy path: stock, wallet, and order all updated atomically', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  const w = await Wallet.create({ owner: 'alice', balance: 100 });
  const res = await checkout(p.id, 3, w.id);
  assert.equal(res.status, 201);
  assert.equal((await Product.findById(p.id)).stock, 2);
  assert.equal((await Wallet.findById(w.id)).balance, 70);
  assert.equal(await Order.countDocuments(), 1);
});

test('rolls back everything when wallet balance is insufficient', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  const w = await Wallet.create({ owner: 'broke', balance: 5 });
  const res = await checkout(p.id, 3, w.id);
  assert.equal(res.status, 402);
  assert.equal((await Product.findById(p.id)).stock, 5, 'stock must roll back');
  assert.equal(await Order.countDocuments(), 0, 'no order created');
});

test('THE RACE under transactions: 50 concurrent checkouts, stock 5 — exactly 5 succeed', async () => {
  const p = await Product.create({ name: 'Last Few', price: 10, stock: 5 });
  const wallets = await Wallet.create(
    Array.from({ length: 50 }, (_, i) => ({ owner: `u${i}`, balance: 1000 }))
  );
  const responses = await Promise.all(wallets.map((w) => checkout(p.id, 1, w.id)));
  const ok = responses.filter((r) => r.status === 201).length;
  assert.equal(ok, 5);
  assert.equal((await Product.findById(p.id)).stock, 0);
  assert.equal(await Order.countDocuments(), 5);
});
