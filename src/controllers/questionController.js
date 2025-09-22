// src/controllers/questionController.js
const Question = require('../models/Question');

exports.getQuestions = async (req, res) => {
    try {
        const data = await Question.find().sort({ id: 1 }).lean();
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};
