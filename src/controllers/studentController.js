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
        // Lấy page & limit từ query, mặc định page=1, limit=10
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;

        // Tính số bản ghi bỏ qua
        const skip = (page - 1) * limit;

        // Chạy song song để lấy dữ liệu + tổng số bản ghi
        const [students, total] = await Promise.all([
            Student.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Student.countDocuments()
        ]);

        res.json({
            success: true,
            results: students,
            total,                // tổng số học sinh
            page,                 // trang hiện tại
            totalPages: Math.ceil(total / limit)
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
            dateFrom,
            dateTo,
            page,
            limit = 1000000
        } = req.query;

        const conditions = [];

        // Tìm theo tên
        if (studentName && studentName.trim()) {
            conditions.push({
                name: { $regex: new RegExp(studentName.trim(), 'i') }
            });
        }

        // Tìm theo lớp
        if (studentClass && studentClass.trim()) {
            const input = studentClass.trim().toLowerCase().replace(/0+(\d+)/g, '$1');

            conditions.push({
                $expr: {
                    $eq: [
                        {
                            $replaceAll: {
                                input: { $toLower: "$class" },
                                find: "0",
                                replacement: ""
                            }
                        },
                        input
                    ]
                }
            });
        }


        // Tìm theo số báo danh
        if (studentNumber && !isNaN(Number(studentNumber))) {
            conditions.push({ number: Number(studentNumber) });
        }

        // Tìm theo khoảng ngày createdAt
        if ((dateFrom && dateFrom.trim()) || (dateTo && dateTo.trim())) {
            const dateCondition = {};
            if (dateFrom && dateFrom.trim()) dateCondition.$gte = new Date(dateFrom);
            if (dateTo && dateTo.trim()) {
                // kết thúc ngày phải là cuối ngày
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
                .sort({ number: 1 }) // sắp xếp tăng dần theo số báo danh
                .skip(skip)
                .limit(Number(limit)),
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

function normalizeClass(cls) {
    if (!cls) return '';
    cls = cls.toLowerCase().trim();

    // tách chữ và số, loại bỏ 0 đứng trước số
    cls = cls.replace(/\d+/g, (num) => String(Number(num)));

    return cls;
}

// Hàm so sánh lớp: số trước, chữ sau
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


exports.getClasses = async (req, res) => {
    try {
        const students = await Student.find().select('class -_id');
        const classSet = new Set();

        students.forEach(s => {
            if (s.class && typeof s.class === 'string') {
                const normalized = normalizeClass(s.class);
                if (normalized) classSet.add(normalized);
            }
        });

        const uniqueClasses = Array.from(classSet).sort(compareClass);

        res.json({
            success: true,
            classes: uniqueClasses
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};