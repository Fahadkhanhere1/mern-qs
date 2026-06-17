/**
 * Q3 — Bulk import: "works in dev, melts in prod".
 *
 * Proves the headline bug in the buggy router and verifies the fixed router:
 * correctness at scale, bounded concurrency, partial-failure isolation, and
 * mass-assignment defense. Run with:  npm run test:q3
 *
 * Both routers are mounted on a SINGLE test server: the shared harness calls
 * connectDB() per server, and mongoose refuses a second connect() to a different
 * in-memory URI. So we wrap fixed + buggy in one parent router and boot once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { startTestServer, stopTestServer, resetDb } from '../helpers/harness.js';
import fixedRouter from '../../src/questions/q3-bulk-import/import.routes.js';
import buggyRouter from '../../src/questions/q3-bulk-import/import.buggy.js';
import User from '../../src/models/User.js';
import {
  resetEmailHooks,
  failFor,
  setEmailDelay,
  getMaxConcurrent,
} from '../../src/questions/q3-bulk-import/email.js';

const CONCURRENCY = 10; // must match import.routes.js
const USER_ID = '64b7f1c2a1b2c3d4e5f60718'; // x-user-id for auth
const FIXED = '/api/q3';
const BUGGY = '/api/q3-buggy';

// One parent router carrying both the fixed and buggy routers, so we only boot
// (and connect) a single server for the whole file.
const parent = express.Router();
parent.use('/q3', fixedRouter);
parent.use('/q3-buggy', buggyRouter);

let server;
let baseUrl;

test.before(async () => {
  ({ server, baseUrl } = await startTestServer(parent, '/api'));
});
test.after(async () => {
  await stopTestServer(server);
});
test.beforeEach(async () => {
  await resetDb();
  resetEmailHooks();
});

function makeUsers(n, prefix = 'u') {
  return Array.from({ length: n }, (_, i) => ({
    name: `User ${i}`,
    email: `${prefix}${i}@example.com`,
  }));
}

function postImport(mount, users, { auth = true, query = '' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['x-user-id'] = USER_ID;
  return fetch(`${baseUrl}${mount}/import${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ users }),
  });
}

// ---------------------------------------------------------------------------
// BUGGY router — proves the headline bug.
// ---------------------------------------------------------------------------
test('BUGGY: forEach makes the handler respond { imported: 0 } prematurely', async () => {
  const res = await postImport(BUGGY, makeUsers(5, 'buggy'));
  const body = await res.json();

  // The headline: forEach never awaited the creates, so results.length === 0
  // when res.json ran — even though work is detached and ongoing in the background.
  assert.equal(res.status, 200);
  assert.equal(body.imported, 0, 'buggy handler reports 0 despite being given 5 users');

  // Prove the response was PREMATURE: the detached creates eventually land in the
  // DB, so the count climbs above the 0 the client was told. We wait for ALL 5
  // detached writes to settle (not just the first) so their background promises
  // can't leak into the next test's DB after its resetDb runs.
  const deadline = Date.now() + 3000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await User.countDocuments();
    if (count >= 5) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(count > 0, 'users appear AFTER the response — the { imported: 0 } was premature');
  assert.equal(count, 5, 'all 5 detached creates eventually completed (work was real, just unawaited)');
});

// ---------------------------------------------------------------------------
// FIXED router.
// ---------------------------------------------------------------------------
test('FIXED: imports 1000 valid users — imported===1000, no failures, DB has 1000', async () => {
  const res = await postImport(FIXED, makeUsers(1000, 'scale'));
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.imported, 1000, 'every valid row imported');
  assert.deepEqual(body.failed, [], 'no failures');
  assert.equal(await User.countDocuments(), 1000, 'DB actually has 1000 users');
});

test('FIXED: bounded concurrency — never exceeds the configured limit', async () => {
  // Add a delay so sends genuinely overlap and the high-water mark is meaningful.
  setEmailDelay(5);
  const res = await postImport(FIXED, makeUsers(200, 'conc'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).imported, 200, 'still imports everything');

  const peak = getMaxConcurrent();
  assert.ok(peak > 1, `should run concurrently, not serially (peak=${peak})`);
  assert.ok(
    peak <= CONCURRENCY,
    `in-flight emails (${peak}) must never exceed the limit (${CONCURRENCY})`
  );
});

test('FIXED: partial failure — one bad row is isolated, the rest still import', async () => {
  const users = makeUsers(10, 'partial');
  // Make row 4's welcome email reject. The user create succeeds but the side
  // effect fails, so it should be reported as failed without sinking the batch.
  failFor('partial4@example.com');

  const res = await postImport(FIXED, users);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.imported, 9, 'the other 9 rows still import');
  assert.equal(body.failed.length, 1, 'exactly one failed row');
  assert.equal(body.failed[0].index, 4, 'failed row carries its index');
  assert.equal(body.failed[0].email, 'partial4@example.com', 'failed row carries its email');
  assert.ok(body.failed[0].error, 'failed row carries an error message');
});

test('FIXED: duplicate email row fails but does not abort the batch', async () => {
  // Two rows share an email -> the second create throws E11000 (unique index).
  const users = makeUsers(8, 'dup');
  users[5].email = users[1].email; // collide row 5 with row 1

  const res = await postImport(FIXED, users);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.imported, 7, 'seven distinct users imported');
  assert.equal(body.failed.length, 1, 'the duplicate row is the only failure');
  assert.equal(await User.countDocuments(), 7, 'DB has the 7 successful users');
});

test('FIXED: mass assignment blocked — role/isVerified/passwordHash are stripped', async () => {
  const res = await postImport(FIXED, [
    {
      name: 'Sneaky',
      email: 'sneaky@example.com',
      role: 'admin', // attempted privilege escalation
      isVerified: true, // attempted verification bypass
      passwordHash: 'injected', // attempted credential injection
    },
  ]);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).imported, 1);

  const u = await User.findOne({ email: 'sneaky@example.com' });
  assert.equal(u.role, 'user', 'role defaulted to user — admin was stripped');
  assert.equal(u.isVerified, false, 'isVerified defaulted to false — true was stripped');
  assert.equal(u.passwordHash, undefined, 'passwordHash was not written');
});

test('FIXED: requires auth (401 without x-user-id)', async () => {
  const res = await postImport(FIXED, makeUsers(1, 'noauth'), { auth: false });
  assert.equal(res.status, 401);
});

test('FIXED: ?mode=async returns 202 Accepted with a job id', async () => {
  const res = await postImport(FIXED, makeUsers(3, 'async'), { query: '?mode=async' });
  assert.equal(res.status, 202, 'background-job shape acknowledges immediately');
  const body = await res.json();
  assert.ok(body.jobId, 'returns a job id to poll');
  assert.equal(body.status, 'accepted');
  assert.equal(body.total, 3);
});
