const mongoose = require('mongoose');

const majorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    examBlocks: [String],

    // Cho phép 1 ngành thuộc nhiều nhóm Holland, mỗi phần tử chỉ 1 ký tự R I A S E C
    hollandGroups: [{
        type: String,
        enum: ['R', 'I', 'A', 'S', 'E', 'C'],
        uppercase: true,
        trim: true
    }]
});

module.exports = mongoose.model('Major', majorSchema);
