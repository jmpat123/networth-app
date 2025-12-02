// backend/routes/snapshots.js
const express = require('express');
const router = express.Router();
const snapshotsController = require('../controllers/snapshotsController');

// GET /api/snapshots
router.get('/', snapshotsController.getSnapshots);

// POST /api/snapshots/write
router.post('/write', snapshotsController.writeSnapshot);

module.exports = router;