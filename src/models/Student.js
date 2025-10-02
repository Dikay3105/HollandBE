const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    class: { type: String, required: true },

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
            subject: { type: String, required: true },
            currentScore: { type: Number, min: 0, max: 10 },
            targetScore: { type: Number, min: 0, max: 10 }
        }
    ],
    recommendedMajors: [
        {
            id: String,
            name: String,
            description: String,
        }
    ],
    recommendationText: [String],

    university: { type: String, default: '' },   // Trường ĐH mong muốn
    major: { type: String, default: '' },        // Ngành học mong muốn
    advice: { type: String, default: '' },

    // 👉 thêm năm học
    schoolYear: {
        type: Number,
        default: () => new Date().getFullYear(), // mặc định là năm hiện tại
        index: true                              // đánh index để query nhanh hơn
    },

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', studentSchema);
