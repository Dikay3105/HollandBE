// src/routes/studentRoutes.js
const express = require('express');
const router = express.Router();
const studentCtrl = require('../controllers/studentController');


router.get('/search', studentCtrl.searchStudents);
router.post('/', studentCtrl.createStudent);
router.get('/', studentCtrl.getStudents);
router.get('/:id', studentCtrl.getStudentById);
router.put('/:id', studentCtrl.updateStudent);
router.delete('/:id', studentCtrl.deleteStudent);

module.exports = router;
