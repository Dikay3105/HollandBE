// src/controllers/studentController.js
const Student = require('../models/Student');

// Hàm helper tính niên khóa hiện tại (dùng nếu cần override hoặc log)
function getCurrentSchoolYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    if (month >= 8) {
        return `${year}-${year + 1}`;
    } else {
        return `${year - 1}-${year}`;
    }
}

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
            recommendedMajors,
            schoolYear, // client có thể gửi thủ công, nếu không thì schema default tự tính
        } = req.body;

        const student = await Student.create({
            name,
            class: studentClass,
            number,
            selectedBlocks,
            hollandScores,
            scores,
            recommendedMajors,
            schoolYear: schoolYear || undefined, // nếu client gửi thì dùng, không thì default schema
        });

        res.status(201).json({
            success: true,
            message: 'Tạo học sinh thành công',
            data: student,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server', error: err.message });
    }
};

/**
 * ✅ Lấy toàn bộ danh sách học sinh (phân trang)
 */
exports.getStudents = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        const [students, total] = await Promise.all([
            Student.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Student.countDocuments(),
        ]);

        res.json({
            success: true,
            results: students,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
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
            recommendedMajors,
            schoolYear, // hỗ trợ update thủ công nếu cần
        } = req.body;

        const updateData = {
            name,
            class: studentClass,
            number,
            selectedBlocks,
            hollandScores,
            scores,
            recommendedMajors,
        };

        if (schoolYear) {
            updateData.schoolYear = schoolYear;
        }

        // Không update createdAt khi edit (trừ khi bạn cố ý muốn reset)
        // Nếu muốn reset: updateData.createdAt = new Date();

        const student = await Student.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true,
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
        }

        res.json({ success: true, message: 'Cập nhật thành công', data: student });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server', error: err.message });
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
 * GET /api/students/search?studentName=&studentClass=&studentNumber=&schoolYear=2025-2026&page=&limit=
 */
exports.searchStudents = async (req, res) => {
    try {
        const {
            studentName,
            studentClass,
            studentNumber,
            dateFrom,
            dateTo,
            schoolYear, // giờ là string "2025-2026"
            page = 1,
            limit = 20, // thay vì 1000000 để tránh overload, có thể để client gửi limit lớn nếu cần
        } = req.query;

        const conditions = [];

        if (studentName && studentName.trim()) {
            conditions.push({
                name: { $regex: new RegExp(studentName.trim(), 'i') },
            });
        }

        if (studentClass && studentClass.trim()) {
            const input = studentClass.trim().toLowerCase();
            const normalized = input.replace(/(\d+)/g, (m) => `0*${parseInt(m, 10)}`);
            const regex = new RegExp(`^${normalized}$`, 'i');
            conditions.push({ class: { $regex: regex } });
        }

        if (studentNumber && !isNaN(Number(studentNumber))) {
            conditions.push({ number: Number(studentNumber) });
        }

        // Sửa phần schoolYear: so sánh string trực tiếp
        if (schoolYear && typeof schoolYear === 'string' && schoolYear.trim()) {
            conditions.push({ schoolYear: schoolYear.trim() });
        }

        if ((dateFrom && dateFrom.trim()) || (dateTo && dateTo.trim())) {
            const dateCondition = {};
            if (dateFrom && dateFrom.trim()) dateCondition.$gte = new Date(dateFrom);
            if (dateTo && dateTo.trim()) {
                const toDate = new Date(dateTo);
                toDate.setHours(23, 59, 59, 999);
                dateCondition.$lte = toDate;
            }
            conditions.push({ createdAt: dateCondition });
        }

        const query = conditions.length ? { $and: conditions } : {};
        const skip = (Number(page) - 1) * Number(limit);

        const [results, total] = await Promise.all([
            Student.find(query)
                .sort({ number: 1 }) // hoặc sort theo class/number nếu cần
                .skip(skip)
                .limit(Number(limit)),
            Student.countDocuments(query),
        ]);

        res.json({
            success: true,
            results,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            currentSchoolYear: getCurrentSchoolYear(), // optional: gửi thêm để frontend biết
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server', error: err.message });
    }
};

/**
 * Hàm normalizeClass và compareClass giữ nguyên (đã tốt)
 */
function normalizeClass(cls) {
    if (!cls) return '';
    cls = cls.toLowerCase().trim();
    cls = cls.replace(/\d+/g, (num) => String(Number(num)));
    return cls.toUpperCase().trim();
}

function compareClass(a, b) {
    const matchA = a.match(/^(\d+)([a-z]*)(\d*)$/i);
    const matchB = b.match(/^(\d+)([a-z]*)(\d*)$/i);

    if (!matchA || !matchB) return a.localeCompare(b);

    const numA = parseInt(matchA[1], 10);
    const numB = parseInt(matchB[1], 10);
    if (numA !== numB) return numA - numB;

    const strA = matchA[2];
    const strB = matchB[2];
    const cmpStr = strA.localeCompare(strB);
    if (cmpStr !== 0) return cmpStr;

    const subNumA = matchA[3] ? parseInt(matchA[3], 10) : 0;
    const subNumB = matchB[3] ? parseInt(matchB[3], 10) : 0;
    return subNumA - subNumB;
}

/**
 * ✅ Lấy danh sách lớp duy nhất
 */
exports.getClasses = async (req, res) => {
    try {
        const students = await Student.find().select('class -_id');
        const classSet = new Set();

        students.forEach((s) => {
            if (s.class && typeof s.class === 'string') {
                const normalized = normalizeClass(s.class);
                if (normalized) classSet.add(normalized);
            }
        });

        const uniqueClasses = Array.from(classSet).sort(compareClass);

        res.json({
            success: true,
            classes: uniqueClasses,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};