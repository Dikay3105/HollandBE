const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    class: { type: String, required: true },

    // 🔑 Thêm số báo danh (integer, không âm)
    number: {
        type: Number,
        required: true,
        min: 0,
        validate: {
            validator: Number.isInteger,
            message: 'Số báo danh phải là số nguyên không âm'
        }
    },

    selectedBlocks: [String],
    hollandScores: {
        R: Number,
        I: Number,
        A: Number,
        S: Number,
        E: Number,
        C: Number
    },
    scores: [
        {
            subject: { type: String, required: true },      // Tên môn
            currentScore: { type: Number, min: 0, max: 10 },// Điểm hiện tại
            targetScore: { type: Number, min: 0, max: 10 }  // Điểm mong muốn
        }
    ],
    recommendedMajors: [
        {
            id: String,
            name: String,
            description: String,
            examBlocks: [String],
            hollandGroups: [String]
        }
    ],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', studentSchema);
