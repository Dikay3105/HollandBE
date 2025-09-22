const Major = require('../models/Major');

exports.getAllMajors = async (req, res) => {
    const majors = await Major.find();
    res.json(majors);
};

exports.getMajorById = async (req, res) => {
    const major = await Major.findById(req.params.id);
    if (!major) return res.status(404).json({ message: 'Not found' });
    res.json(major);
};

// Lấy ngành theo khối thi
exports.getMajorsByExamBlock = async (req, res) => {
    try {
        const { block } = req.params;              // ví dụ A00
        // Tìm các ngành có examBlocks chứa block
        const majors = await Major.find({ examBlocks: block });
        res.json(majors);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};