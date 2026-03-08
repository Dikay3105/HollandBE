const mongoose = require('mongoose');

// Hàm helper tính niên khóa hiện tại (dựa trên tháng)
function getCurrentSchoolYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1 → 12

    // Từ tháng 8 đến tháng 12: niên khóa year - (year+1)
    // Từ tháng 1 đến tháng 7: niên khóa (year-1) - year
    if (month >= 8) {
        return `${year}-${year + 1}`;
    } else {
        return `${year - 1}-${year}`;
    }
}

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

    selectedBlocks: [String],

    hollandScores: {
        R: Number,
        I: Number,
        A: Number,
        S: Number,
        E: Number,
        C: Number,
    },

    scores: [
        {
            subject: { type: String, required: true },
            currentScore: { type: Number, min: 0, max: 10 },
            targetScore: { type: Number, min: 0, max: 10 },
        },
    ],

    recommendedMajors: [
        {
            id: String,
            name: String,
            description: String,
        },
    ],

    recommendationText: [String],

    university: { type: String, default: '' }, // Trường ĐH mong muốn
    major: { type: String, default: '' }, // Ngành học mong muốn
    advice: { type: String, default: '' },

    // 👉 Niên khóa dạng "2025-2026" – chính xác theo năm học VN
    schoolYear: {
        type: String,
        default: getCurrentSchoolYear, // tự động tính khi tạo document
        index: true, // index để query nhanh
    },

    createdAt: { type: Date, default: Date.now },
});

// Pre-save hook: đảm bảo schoolYear luôn được set nếu chưa có
studentSchema.pre('save', function (next) {
    if (!this.schoolYear) {
        this.schoolYear = getCurrentSchoolYear();
    }
    next();
});

// Nếu bạn muốn cho phép admin override thủ công, có thể thêm method hoặc bỏ hook trên

module.exports = mongoose.model('Student', studentSchema);