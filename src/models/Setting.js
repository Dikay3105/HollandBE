// src/models/Setting.js
// Cấu hình dạng key → value (admin chỉnh trên trang "Cấu hình tư vấn").
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true },
        value: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true, minimize: false }
);

module.exports = mongoose.model('Setting', settingSchema);
