const mongoose = require('mongoose');
const { getSchoolYear } = require('../utils/schoolYear');


const studentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    class: { type: String, required: true },

    number: {
        type: Number,
        required: true,
        min: 0,
        validate: {
            validator: Number.isInteger,
            message: 'Số báo danh phải là số nguyên không âm',
        },
    },

    // Tổ hợp học sinh dùng được (hệ thống tự suy ra từ môn thi; dữ liệu cũ: học sinh tự chọn)
    selectedBlocks: [String],
    electiveSubjects: [String], // mã môn thi tự chọn (Subject.code)
    aptitudeSubjects: [String], // mã môn năng khiếu dự thi

    hollandScores: {
        R: Number,
        I: Number,
        A: Number,
        S: Number,
        E: Number,
        C: Number,
    },
    topGroups: [{ _id: false, type: { type: String }, score: Number }],
    hollandCode: { type: String, default: '' },

    scores: [
        {
            subject: { type: String, required: true },
            code: String, // mã môn (Subject.code)
            currentScore: { type: Number, min: 0, max: 10 },
            targetScore: { type: Number, min: 0, max: 10 },
        },
    ],

    // Ngành xếp hạng theo độ phù hợp (xem services/recommender.js)
    recommendedMajors: [{ type: mongoose.Schema.Types.Mixed }],
    // Hợp tính cách nhưng chưa có tổ hợp phù hợp (cần đổi môn / thi năng khiếu)
    alternativeMajors: [{ type: mongoose.Schema.Types.Mixed }],

    recommendationText: [String],

    university: { type: String, default: '' }, // Trường ĐH mong muốn
    major: { type: String, default: '' }, // Ngành học mong muốn
    universityOther: { type: Boolean, default: false }, // true = học sinh tự nhập (không có trong danh mục)
    majorOther: { type: Boolean, default: false },
    advice: { type: String, default: '' },
    // pending = AI đang viết (chạy nền), done = lời khuyên AI, fallback = lời khuyên mẫu
    adviceStatus: { type: String, enum: ['pending', 'done', 'fallback'], default: 'done' },
    adviceJobId: { type: String, select: false }, // chống ghi đè khi học sinh nộp lại lúc AI chưa xong

    // 👉 Niên khóa dạng "2025-2026" – chính xác theo năm học VN
    schoolYear: {
        type: String,
        default: () => getSchoolYear(), // tự động tính khi tạo document (giờ VN)
        index: true, // index để query nhanh
    },

    createdAt: { type: Date, default: Date.now },
});

// Pre-save hook: đảm bảo schoolYear luôn được set nếu chưa có
studentSchema.pre('save', function (next) {
    if (!this.schoolYear) {
        this.schoolYear = getSchoolYear();
    }
    next();
});

// Nếu bạn muốn cho phép admin override thủ công, có thể thêm method hoặc bỏ hook trên

module.exports = mongoose.model('Student', studentSchema);