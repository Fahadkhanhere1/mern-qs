/**
 * Shared test harness.
 *
 * Each question's tests pass in their OWN router so the question is testable in
 * isolation (no dependency on sibling questions existing or compiling). Pass no
 * router to get the full app with every question mounted.
 *
 * Boots an in-memory MongoDB replica set (so transactions work) + an Express
 * app on an ephemeral port, and returns a base URL.
 */
import express from 'express';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../../src/config/db.js';
import { stopMemoryServer } from '../../src/config/memoryServer.js';

/**
 * @param {import('express').Router} [router]  question router to mount
 * @param {string} [mountPath='/api']
 */
export async function startTestServer(router, mountPath = '/api') {
  await connectDB(); // no URI -> in-memory replica set

  const app = express();
  app.use(express.json());

  // Lazily load the full registry only when no specific router is requested,
  // so a single-question test never forces its siblings to compile.
  const mounted = router ?? (await import('../../src/questions/index.js')).default;
  app.use(mountPath, mounted);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: err.message || 'Server error' })
  );

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(server) {
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDB();
  await stopMemoryServer();
}

export async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
