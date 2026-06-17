const express = require('express');
const { purchase, checkout } = require('./purchase.controller');

const router = express.Router();

// Strong-signal answer: single atomic conditional decrement.
router.post('/products/:id/purchase', purchase);

// Curveball: stock + order + wallet, all-or-nothing via a transaction.
router.post('/products/:id/checkout', checkout);

module.exports = router;
