/**
 * Boots an in-memory MongoDB *replica set*.
 *
 * Why a replica set and not a standalone? MongoDB multi-document transactions
 * (used by Q1's checkout curveball) require a replica set — a standalone mongod
 * cannot start a session transaction. mongodb-memory-server can give us a
 * single-node replica set with zero install, which is perfect for local dev
 * and tests.
 */
let replSet = null;

export async function startMemoryServer() {
  // Dynamic import so production installs that set MONGODB_URI don't need the dev dep.
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  return replSet.getUri();
}

export async function stopMemoryServer() {
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}
