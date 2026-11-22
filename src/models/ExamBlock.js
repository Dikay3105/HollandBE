const mongoose = require('mongoose');

const examBlockSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mã tổ hợp, VD: A00
        // Mã môn (Subject.code), đúng 3 môn
        subjects: {
            type: [String],
            validate: { validator: v => Array.isArray(v) && v.length === 3, message: 'Tổ hợp phải có đúng 3 môn' },
        },
        note: { type: String, trim: true, maxlength: 200, default: '' },
        active: { type: Boolean, default: true }, // tắt = không dùng để gợi ý (vẫn giữ trong dữ liệu ngành)
    },
    { timestamps: true }
);

module.exports = mongoose.model('ExamBlock', examBlockSchema);
