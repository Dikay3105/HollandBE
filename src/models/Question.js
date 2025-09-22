// src/models/Question.js
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },   // FE dùng id số
    text: { type: String, required: true },
    type: { type: String, enum: ['R', 'I', 'A', 'S', 'E', 'C'], required: true }
});

module.exports = mongoose.model('Question', questionSchema);
