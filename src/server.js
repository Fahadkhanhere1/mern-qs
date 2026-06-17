import 'dotenv/config';

import { createApp } from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 3000;

async function main() {
  const uri = await connectDB();
  // eslint-disable-next-line no-console
  console.log(`[db] connected: ${uri.replace(/\/\/.*@/, '//')}`);

  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[server] question index: http://localhost:${PORT}/api`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
