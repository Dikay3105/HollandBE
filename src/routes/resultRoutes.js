// src/routes/resultRoutes.js
const express = require('express');
const router = express.Router();
const { submitResults } = require('../controllers/resultController');

// POST /api/results
// Nhận: { personalInfo, selectedBlocks, hollandScores }
router.post('/', submitResults);

module.exports = router;