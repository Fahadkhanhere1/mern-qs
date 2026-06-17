const express = require('express');
const questions = require('./questions');

/**
 * Builds the Express app. Kept separate from server start-up so tests can
 * import the app without binding a port.
 */
function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', questions);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Centralized error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  });

  return app;
}

module.exports = { createApp };
