const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    class: { type: String, required: true },
    selectedBlocks: [String],
    hollandScores: {
        R: Number, I: Number, A: Number,
        S: Number, E: Number, C: Number
    },
    recommendedMajors: [
        {
            id: String,
            name: String,
            description: String,
            examBlocks: [String],
            hollandTypes: [String]
        }
    ],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', studentSchema);
