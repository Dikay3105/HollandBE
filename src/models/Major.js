// src/models/Major.js
const mongoose = require('mongoose');

const majorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    examBlocks: [String],

    // Mỗi phần tử là một chuỗi 3 ký tự, ví dụ: "SEC", "RAS"
    hollandGroups: [{
        type: String,
        match: /^[RIASEC]{3}$/,      // đúng 3 ký tự, chỉ gồm R I A S E C
        uppercase: true,             // tự động viết hoa
        trim: true
    }]
});

module.exports = mongoose.model('Major', majorSchema);
