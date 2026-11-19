// src/routes/optionRoutes.js
const express = require('express');
const router = express.Router();
const { getPublicOptions } = require('../controllers/optionController');

// GET /api/options            → { universities: [], majors: [] }
// GET /api/options?type=major → [tên ngành]
router.get('/', getPublicOptions);

module.exports = router;
