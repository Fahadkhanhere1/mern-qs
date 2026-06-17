/**
 * Question registry.
 *
 * Each interview question is a self-contained folder exposing an Express router.
 * Add a new question by creating `src/questions/qN-slug/` with a `*.routes.js`
 * that exports a router, then register it here. It will be mounted at
 * `/api/qN-slug`.
 */
const express = require('express');

const q1 = require('./q1-no-overselling/purchase.routes');

const router = express.Router();

router.use('/q1', q1);

// Simple index so you can see what's wired up.
router.get('/', (req, res) => {
  res.json({
    questions: [
      {
        id: 'q1',
        title: 'No Overselling — Atomic Inventory Decrement',
        base: '/api/q1',
      },
    ],
  });
});

module.exports = router;
