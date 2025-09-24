// src/controllers/studentController.js
const Student = require('../models/Student');

/**
 * ✅ Tạo mới học sinh
 */
exports.createStudent = async (req, res) => {
    try {
        const {
            name,
            class: studentClass,
            number,
            selectedBlocks,
            hollandScores,
            scores,
            recommendedMajors
        } = req.body;

        const student = await Student.create({
            name,
            class: studentClass,
            number,
            selectedBlocks,
            hollandScores,
            scores,
            recommendedMajors
        });

        res.status(201).json({
            success: true,
            message: 'Tạo học sinh thành công',
            data: student
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * ✅ Lấy toàn bộ danh sách học sinh
 */
exports.getStudents = async (req, res) => {
    try {
        const list = await Student.find().sort({ createdAt: -1 });
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * ✅ Lấy chi tiết 1 học sinh theo ID
 */
exports.getStudentById = async (req, res) => {
    try {
        const student = await Student.findById(req.params.id);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        }
        res.json({ success: true, data: student });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * ✅ Cập nhật thông tin học sinh
 */
exports.updateStudent = async (req, res) => {
    try {
        const {
            name,
            class: studentClass,
            number,
            selectedBlocks,
            hollandScores,
            scores,
            recommendedMajors
        } = req.body;

        const student = await Student.findByIdAndUpdate(
            req.params.id,
            {
                name,
                class: studentClass,
                number,
                selectedBlocks,
                hollandScores,
                scores,
                recommendedMajors,
                createdAt: new Date()
            },
            { new: true }
        );

        if (!student) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        }

        res.json({ success: true, message: 'Cập nhật thành công', data: student });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * ✅ Xóa học sinh
 */
exports.deleteStudent = async (req, res) => {
    try {
        const student = await Student.findByIdAndDelete(req.params.id);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        }
        res.json({ success: true, message: 'Xóa thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * ✅ Tìm kiếm + phân trang
 * GET /api/students/search?studentName=&studentClass=&studentNumber=&page=&limit=
 */
exports.searchStudents = async (req, res) => {
    try {
        const {
            studentName,
            studentClass,
            studentNumber,
            page = 1,
            limit = 10
        } = req.query;

        const query = {};

        if (studentName && studentName.trim() !== '') {
            query.name = { $regex: new RegExp(studentName.trim(), 'i') };
        }
        if (studentClass && studentClass.trim() !== '') {
            query.class = { $regex: new RegExp(studentClass.trim(), 'i') };
        }
        if (studentNumber && !isNaN(Number(studentNumber))) {
            query.number = Number(studentNumber);
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [results, total] = await Promise.all([
            Student.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
            Student.countDocuments(query)
        ]);

        res.json({
            success: true,
            results,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

