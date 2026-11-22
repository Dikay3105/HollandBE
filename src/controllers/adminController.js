const Question = require('../models/Question');
const Major = require('../models/Major');
const Student = require('../models/Student');
const ExamBlock = require('../models/ExamBlock');

exports.getStats = async (req, res) => {
    try {
        const [totalQuestions, totalMajors, totalStudents, totalBlocks] = await Promise.all([
            Question.countDocuments(),
            Major.countDocuments(),
            Student.countDocuments(),
            ExamBlock.countDocuments({ active: { $ne: false } })
        ]);

        res.json({
            success: true,
            data: {
                totalQuestions,
                totalMajors,
                totalStudents,
                totalBlocks
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể lấy thống kê'
        });
    }
};
