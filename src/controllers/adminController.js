const Question = require('../models/Question');
const Major = require('../models/Major');
const Student = require('../models/Student');

exports.getStats = async (req, res) => {
    try {
        const [totalQuestions, totalMajors, totalStudents] = await Promise.all([
            Question.countDocuments(),
            Major.countDocuments(),
            Student.countDocuments()
        ]);

        res.json({
            success: true,
            data: {
                totalQuestions,
                totalMajors,
                totalStudents
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
