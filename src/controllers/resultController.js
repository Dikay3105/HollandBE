// src/controllers/resultController.js
const { generateFullAdvice } = require('../helpers/aiHelper');
const Major = require('../models/Major');
const Student = require('../models/Student');

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores, scores } = req.body;
        const { name, class: studentClass, number, university, major } = personalInfo;

        // 👇 Thêm schoolYear (lấy từ body, nếu ko có thì mặc định năm hiện tại)
        const schoolYear = personalInfo.schoolYear || new Date().getFullYear();

        // 1️⃣ Sắp xếp nhóm theo điểm giảm dần
        const sorted = Object.entries(hollandScores || {})
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
            .sort((a, b) => b[1] - a[1]);

        // 2️⃣ Gom nhóm cùng điểm thành bucket
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

        // 3️⃣ Xác định topGroups - fix: không lấy lẻ từ bucket sau, chỉ lấy bucket fit nguyên
        let topGroups = [];
        if (groupsByScore.length > 0) {
            const maxBucket = groupsByScore[0];
            if (maxBucket.types.length >= 4 || (groupsByScore.length === 1 && maxBucket.types.length === 6)) {
                topGroups = [];  // discard trường hợp đặc biệt
            } else {
                const included = [];
                for (let bi = 0; bi < groupsByScore.length; bi++) {
                    const bucket = groupsByScore[bi];
                    if (included.length + bucket.types.length > 3) {
                        break;  // Không fit nguyên → dừng, không lấy lẻ
                    }
                    bucket.types.forEach(t => included.push({ type: t, score: bucket.score }));
                    if (included.length >= 3) break;
                }
                topGroups = included;
            }
        }

        // Tạo chuỗi mã Holland (ví dụ: EI hoặc IE)
        const hollandCode = topGroups.map(g => g.type).join('');
        console.log("Top groups:", topGroups);
        console.log("Mã Holland:", hollandCode);

        // Escape ký tự đặc biệt trong regex (tránh lỗi nếu tên có . * ? ...)
        function escapeRegex(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // 4️⃣ Tìm ngành phù hợp
        const majors = topGroups.length > 0
            ? await Major.find({
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

        // 6️⃣ Gợi ý
        let recommendationText = uniqueMajors.length
            ? `Ngành nghề bạn có thể lựa chọn: ${uniqueMajors.map(m => m.name).join(', ')}.`
            : 'Hiện chưa có ngành nào phù hợp với nhóm Holland và khối thi bạn chọn.';
        if (topGroups.length === 0) {
            recommendationText =
                'Bạn không thiên hẳn về nhóm Holland nào, hãy làm lại test hoặc tham khảo ý kiến giáo viên.';
        }

        const aiAdvice = await generateFullAdvice({
            scores,
            topMajors: uniqueMajors,
            selectedBlocks,
            hollandScores
        });

        // 7️⃣ Lưu hoặc cập nhật Student (upsert dựa trên name + class + number + schoolYear)
        const updatedStudent = await Student.findOneAndUpdate(
            {
                // Match chính xác, case-insensitive cho name
                name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') },
                class: studentClass,
                number: number,               // đảm bảo number là Number
                schoolYear: schoolYear        // String "2025-2026" – match chính xác
            },
            {
                $set: {
                    name,
                    class: studentClass,
                    number,
                    schoolYear,
                    selectedBlocks: selectedBlocks || [],          // fallback nếu undefined
                    hollandScores: hollandScores || {},            // fallback
                    scores: scores || [],
                    recommendedMajors: uniqueMajors || [],
                    recommendationText: recommendationText || [],
                    advice: aiAdvice || '',
                    university: university || '',
                    major: major || '',
                    // KHÔNG set createdAt ở đây để tránh reset khi update
                    // createdAt chỉ tự động khi insert (schema default)
                },
                // Nếu muốn reset createdAt chỉ khi tạo mới, dùng $setOnInsert
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            {
                new: true,          // trả về document sau update
                upsert: true,       // tạo mới nếu không tìm thấy
                runValidators: true // chạy validation schema khi upsert
            }
        );

        // Optional: log để debug
        console.log('Student upserted:', {
            id: updatedStudent._id,
            action: updatedStudent.createdAt.getTime() === new Date().getTime() ? 'created' : 'updated',
            schoolYear: updatedStudent.schoolYear
        });

        // 8️⃣ Trả về
        return res.json({
            success: true,
            message: 'Kết quả đã được xử lý',
            topGroups,
            recommendedMajors: uniqueMajors,
            recommendationText,
            student: updatedStudent,
            advice: aiAdvice
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
