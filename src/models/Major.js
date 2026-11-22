const mongoose = require('mongoose');

const majorSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    examBlocks: { type: [String], default: [] }, // mã tổ hợp xét tuyển (ExamBlock.name)

    // Cho phép 1 ngành thuộc nhiều nhóm Holland, mỗi phần tử chỉ 1 ký tự R I A S E C
    hollandGroups: [{
        type: String,
        enum: ['R', 'I', 'A', 'S', 'E', 'C'],
        uppercase: true,
        trim: true
    }],

    // Điểm chuẩn tham khảo (thang 30, 3 môn). Bỏ trống = so theo tổng điểm trên 30.
    benchmarkScore: { type: Number, min: 0, max: 30, default: null },
    // Từ khoá để nhận ra nguyện vọng của học sinh (VD "IT", "lập trình" cho CNTT)
    keywords: { type: [String], default: [] },
    active: { type: Boolean, default: true }, // tắt = không gợi ý
});

module.exports = mongoose.model('Major', majorSchema);
