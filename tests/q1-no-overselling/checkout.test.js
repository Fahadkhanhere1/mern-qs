/**
 * Q1 curveball — transactional checkout: stock + order + wallet, all-or-nothing.
 * Verifies the transaction rolls back fully when any leg fails.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, resetDb } = require('../helpers/harness');
const Product = require('../../src/questions/q1-no-overselling/product.model');
const Wallet = require('../../src/questions/q1-no-overselling/wallet.model');
const Order = require('../../src/questions/q1-no-overselling/order.model');

let server;
let baseUrl;

test.before(async () => {
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await stopTestServer(server);
});

test.beforeEach(resetDb);

function checkout(id, qty, userId) {
  return fetch(`${baseUrl}/api/q1/products/${id}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty, userId }),
  });
}

test('happy path: decrements stock, debits wallet, creates order — atomically', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  const w = await Wallet.create({ owner: 'alice', balance: 100 });

  const res = await checkout(p.id, 3, w.id);
  assert.equal(res.status, 201);

  assert.equal((await Product.findById(p.id)).stock, 2);
  assert.equal((await Wallet.findById(w.id)).balance, 70); // 100 - 3*10
  assert.equal(await Order.countDocuments(), 1);
});

test('rolls back everything when wallet balance is insufficient', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 5 });
  const w = await Wallet.create({ owner: 'broke', balance: 5 }); // needs 30

  const res = await checkout(p.id, 3, w.id);
  assert.equal(res.status, 402);

  // Nothing should have changed.
  assert.equal((await Product.findById(p.id)).stock, 5, 'stock must roll back');
  assert.equal((await Wallet.findById(w.id)).balance, 5, 'balance untouched');
  assert.equal(await Order.countDocuments(), 0, 'no order created');
});

test('rolls back when stock is insufficient (no charge, no order)', async () => {
  const p = await Product.create({ name: 'Widget', price: 10, stock: 1 });
  const w = await Wallet.create({ owner: 'alice', balance: 100 });

  const res = await checkout(p.id, 3, w.id);
  assert.equal(res.status, 409);

  assert.equal((await Product.findById(p.id)).stock, 1);
  assert.equal((await Wallet.findById(w.id)).balance, 100);
  assert.equal(await Order.countDocuments(), 0);
});

test('THE RACE under transactions: 50 concurrent checkouts, stock 5 — exactly 5 succeed', async () => {
  const p = await Product.create({ name: 'Last Few', price: 10, stock: 5 });
  // Give each buyer their own well-funded wallet so the only contention is stock.
  const wallets = await Wallet.create(
    Array.from({ length: 50 }, (_, i) => ({ owner: `u${i}`, balance: 1000 }))
  );

  const responses = await Promise.all(wallets.map((w) => checkout(p.id, 1, w.id)));
  const ok = responses.filter((r) => r.status === 201).length;

  assert.equal(ok, 5, 'exactly 5 checkouts succeed');
  assert.equal((await Product.findById(p.id)).stock, 0);
  assert.equal(await Order.countDocuments(), 5);
});
