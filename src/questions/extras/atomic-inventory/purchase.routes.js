import express from 'express';
import { purchase, checkout } from './purchase.controller.js';

const router = express.Router();

// Strong-signal answer: single atomic conditional decrement.
router.post('/products/:id/purchase', purchase);

// Curveball: stock + order + wallet, all-or-nothing via a transaction.
router.post('/products/:id/checkout', checkout);

export default router;
