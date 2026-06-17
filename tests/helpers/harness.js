/**
 * Shared test harness: starts an in-memory MongoDB replica set, connects
 * mongoose, boots the Express app on an ephemeral port, and returns a base URL.
 *
 * Used by every question's tests so each test file stays focused on scenarios.
 */
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDB, disconnectDB } = require('../../src/config/db');
const { stopMemoryServer } = require('../../src/config/memoryServer');

async function startTestServer() {
  await connectDB(); // no URI -> in-memory replica set
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return { server, baseUrl };
}

async function stopTestServer(server) {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDB();
  await stopMemoryServer();
}

async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

module.exports = { startTestServer, stopTestServer, resetDb };
