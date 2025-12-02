// backend/routes/wallets.js
const express = require('express');
const router = express.Router();
const walletsController = require('../controllers/walletsController');

router.post('/add', walletsController.addWallet);
router.get('/', walletsController.listWallets);
router.get('/refresh', walletsController.refreshWallets);

module.exports = router;