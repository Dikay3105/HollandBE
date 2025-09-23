const mongoose = require('mongoose');

const examBlockSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // ví dụ: A00
    subjects: {
        type: [String],
        validate: v => v.length === 3   // đảm bảo luôn 3 môn
    }
});

module.exports = mongoose.model('ExamBlock', examBlockSchema);
