// src/models/Option.js
// Danh mục lựa chọn cho học sinh: trường đại học mong muốn & ngành học mong muốn.
const mongoose = require('mongoose');

const OPTION_TYPES = ['university', 'major'];

const optionSchema = new mongoose.Schema(
    {
        type: { type: String, enum: OPTION_TYPES, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 150 },
        order: { type: Number, default: 0 },      // số nhỏ hiển thị trước
        active: { type: Boolean, default: true }, // ẩn khỏi form học sinh nhưng vẫn giữ để thống kê
    },
    { timestamps: true }
);

// Không cho trùng tên trong cùng loại (không phân biệt hoa thường)
optionSchema.index(
    { type: 1, name: 1 },
    { unique: true, collation: { locale: 'vi', strength: 2 } }
);

optionSchema.statics.TYPES = OPTION_TYPES;

module.exports = mongoose.model('Option', optionSchema);
