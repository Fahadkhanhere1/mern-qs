import mongoose from 'mongoose';
import { startMemoryServer } from './memoryServer.js';

/**
 * Connects mongoose to MongoDB.
 *
 * - If MONGODB_URI is set, connect to it (expected to be a replica set if you
 *   want transactions to work).
 * - Otherwise spin up an in-memory replica set so the app runs with no install.
 *
 * Returns the resolved connection URI (handy for logging / tests).
 */
export async function connectDB(uriOverride) {
  let uri = uriOverride || process.env.MONGODB_URI;

  if (!uri) {
    uri = await startMemoryServer();
    // eslint-disable-next-line no-console
    console.log('[db] No MONGODB_URI set — started in-memory replica set');
  }

  await mongoose.connect(uri);
  return uri;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
