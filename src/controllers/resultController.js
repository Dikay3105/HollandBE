// src/controllers/resultController.js
const Major = require('../models/Major');
const Student = require('../models/Student');

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores, scores } = req.body;
        const { name, class: studentClass, number } = personalInfo;

        // 1️⃣ Sắp xếp nhóm theo điểm giảm dần
        const sorted = Object.entries(hollandScores || {})
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
            .sort((a, b) => b[1] - a[1]);

        // 2️⃣ Gom các nhóm có cùng điểm thành từng "bucket"
        const groupsByScore = [];
        for (let i = 0; i < sorted.length;) {
            const score = sorted[i][1];
            const types = [];
            while (i < sorted.length && sorted[i][1] === score) {
                types.push(sorted[i][0]);
                i++;
            }
            groupsByScore.push({ score, types });
        }

        // 3️⃣ Xác định topGroups
        // Quy tắc:
        //  - Nếu bucket cao nhất có >=4 nhóm (hoặc cả 6 nhóm bằng nhau) => rỗng
        //  - Ngược lại, duyệt lần lượt các bucket; chỉ thêm nguyên cả bucket
        //    nếu tổng số nhóm sau khi thêm ≤ 3. Không thêm một phần bucket.
        let topGroups = [];
        if (groupsByScore.length > 0) {
            const maxBucket = groupsByScore[0];
            if (maxBucket.types.length >= 4 || (groupsByScore.length === 1 && maxBucket.types.length === 6)) {
                topGroups = [];
            } else {
                const included = [];
                for (let bi = 0; bi < groupsByScore.length && included.length < 3; bi++) {
                    const bucket = groupsByScore[bi];
                    if (included.length + bucket.types.length <= 3) {
                        bucket.types.forEach(t => included.push({ type: t, score: bucket.score }));
                    } else {
                        // nếu thêm cả bucket sẽ vượt quá 3 nhóm -> bỏ nguyên bucket
                    }
                }
                topGroups = included;
            }
        }

        // 4️⃣ Tìm ngành phù hợp: khối thi hợp lệ + có ít nhất 1 nhóm trong topGroups
        const majors = topGroups.length > 0
            ? await Major.find({
                examBlocks: { $in: selectedBlocks || [] },
                hollandGroups: { $in: topGroups.map(t => t.type) }
            }).lean()
            : [];

        // 5️⃣ Loại bỏ ngành trùng
        const uniqueMajors = [];
        const seen = new Set();
        for (const m of majors) {
            if (!seen.has(m._id.toString())) {
                seen.add(m._id.toString());
                uniqueMajors.push(m);
            }
        }

        // 6️⃣ Thông điệp gợi ý
        let recommendationText = uniqueMajors.length
            ? `Ngành nghề bạn có thể lựa chọn: ${uniqueMajors.map(m => m.name).join(', ')}.`
            : 'Hiện chưa có ngành nào phù hợp với nhóm Holland và khối thi bạn chọn.';
        if (topGroups.length === 0) {
            recommendationText =
                'Bạn không thiên hẳn về nhóm Holland nào, hãy làm lại test hoặc tham khảo ý kiến giáo viên.';
        }

        // 7️⃣ Lưu hoặc cập nhật Student
        const updatedStudent = await Student.findOneAndUpdate(
            { name, class: studentClass, number },
            {
                $set: {
                    selectedBlocks,
                    hollandScores,
                    scores,
                    recommendedMajors: uniqueMajors,
                    createdAt: new Date()
                }
            },
            { new: true, upsert: true }
        );

        // 8️⃣ Trả về kết quả
        return res.json({
            success: true,
            message: 'Kết quả đã được xử lý',
            topGroups,                    // 👉 chỉ trả mảng {type, score} như yêu cầu
            recommendedMajors: uniqueMajors,
            recommendationText,
            student: updatedStudent
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
