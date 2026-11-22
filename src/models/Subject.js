// src/models/Subject.js
// Danh mục môn học (admin quản lý). Mọi nơi khác (tổ hợp, điểm của học sinh) tham chiếu theo `code`.
const mongoose = require('mongoose');

const SUBJECT_KINDS = ['required', 'elective', 'aptitude'];

const subjectSchema = new mongoose.Schema(
    {
        // Mã ngắn, không dấu, VD: TOAN, LY, VE_HH
        code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_]{1,20}$/ },
        name: { type: String, required: true, trim: true, maxlength: 80 }, // tên hiển thị, VD "Vật lý"
        shortName: { type: String, trim: true, maxlength: 30 },              // tên ngắn, VD "Lý"
        aliases: { type: [String], default: [] },                          // cách viết khác (để nhận dữ liệu cũ)
        // required = môn thi bắt buộc (Toán, Văn) · elective = môn thi tự chọn · aptitude = môn năng khiếu (thi riêng)
        kind: { type: String, enum: SUBJECT_KINDS, required: true },
        group: { type: String, trim: true, maxlength: 60, default: '' },   // nhóm năng khiếu, VD "Mỹ thuật"
        order: { type: Number, default: 0 },
        active: { type: Boolean, default: true },
    },
    { timestamps: true }
);

subjectSchema.statics.KINDS = SUBJECT_KINDS;

module.exports = mongoose.model('Subject', subjectSchema);
