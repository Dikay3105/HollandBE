const express = require('express');
const router = express.Router();
const { getAllMajors, getMajorById, getMajorsByExamBlock } = require('../controllers/majorController');

router.get('/block/:block', getMajorsByExamBlock);
router.get('/', getAllMajors);
router.get('/:id', getMajorById);

module.exports = router;
