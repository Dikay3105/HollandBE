const express = require('express');
const router = express.Router();
const ExamBlock = require('../models/ExamBlock');
const Major = require('../models/Major');
const Question = require('../models/Question');

/* ======== Exam Block CRUD ======== */
// Lấy tất cả khối thi
router.get('/exam-blocks', async (_, res) => {
    res.json(await ExamBlock.find().lean());
});

// Thêm khối thi mới
router.post('/exam-blocks', async (req, res) => {
    const block = await ExamBlock.create(req.body);
    res.json(block);
});

// Cập nhật khối thi
router.put('/exam-blocks/:id', async (req, res) => {
    const block = await ExamBlock.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(block);
});

// Xoá khối thi
router.delete('/exam-blocks/:id', async (req, res) => {
    await ExamBlock.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

/* ======== Question (Holland) CRUD ======== */
router.get('/questions', async (_, res) => {
    res.json(await Question.find().lean());
});

router.post('/questions', async (req, res) => {
    const q = await Question.create(req.body);
    res.json(q);
});

router.put('/questions/:id', async (req, res) => {
    const q = await Question.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    res.json(q);
});

router.delete('/questions/:id', async (req, res) => {
    await Question.findOneAndDelete({ id: req.params.id });
    res.json({ success: true });
});

/* ======== Major CRUD ======== */
router.get('/majors', async (_, res) => {
    res.json(await Major.find().lean());
});

router.post('/majors', async (req, res) => {
    const m = await Major.create(req.body);
    res.json(m);
});

router.put('/majors/:id', async (req, res) => {
    const m = await Major.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(m);
});

router.delete('/majors/:id', async (req, res) => {
    await Major.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

module.exports = router;
