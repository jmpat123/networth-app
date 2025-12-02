// backend/routes/prices.js
const express = require('express');
const router = express.Router();
const priceController = require('../controllers/priceController');

// POST /api/prices/refresh
router.post('/refresh', priceController.refreshAllPrices);

module.exports = router;