// src/models/Major.js
const mongoose = require('mongoose');

const majorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    examBlocks: [String],
    hollandTypes: [String]
});

module.exports = mongoose.model('Major', majorSchema);
