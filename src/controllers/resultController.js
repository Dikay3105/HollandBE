// src/controllers/resultController.js
const { generateFullAdvice } = require('../helpers/aiHelper');
const Major = require('../models/Major');
const Student = require('../models/Student');
const crypto = require('crypto');
const { broadcast, sendTo } = require('../realtime');
const { getSchoolYear, normalizeSchoolYear } = require('../utils/schoolYear');


exports.submitResults = async (req, res) => {
    try {
        const { personalInfo, selectedBlocks, hollandScores, scores } = req.body;
        const { name, class: studentClass, number, university, major, universityOther, majorOther } = personalInfo;

        // 👇 Thêm schoolYear (lấy từ body, nếu ko có thì mặc định năm hiện tại)
        const schoolYear = normalizeSchoolYear(personalInfo.schoolYear) || getSchoolYear();

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

        // 3️⃣ Xác định topGroups - cập nhật: cho phép tối đa 4 nhóm, không lấy lẻ bucket
        let topGroups = [];

        if (groupsByScore.length > 0) {

            const included = [];
            const MIN_GROUPS = 3;
            const MAX_GROUPS = 4;

            for (let i = 0; i < groupsByScore.length; i++) {
                const bucket = groupsByScore[i];

                // nếu thêm bucket này vượt quá 4 → dừng
                if (included.length + bucket.types.length > MAX_GROUPS) {
                    break;
                }

                bucket.types.forEach(t => {
                    included.push({ type: t, score: bucket.score });
                });

                // đã đủ ít nhất 3 nhóm
                if (included.length >= MIN_GROUPS) {

                    // nếu bucket tiếp theo cùng điểm → cho phép lên 4
                    const nextBucket = groupsByScore[i + 1];

                    if (!nextBucket || nextBucket.score !== bucket.score) {
                        break;
                    }
                }
            }

            topGroups = included;
        }

        // tất cả bằng nhau → bỏ
        if (groupsByScore.length === 1 && groupsByScore[0].types.length === 6) {
            topGroups = [];
        }

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

        const startedAt = new Date();
        // Lời khuyên AI chạy nền sau khi trả kết quả → học sinh không phải chờ AI
        const adviceJobId = crypto.randomUUID();

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
                    advice: '',
                    adviceStatus: 'pending',
                    adviceJobId,
                    university: university || '',
                    major: major || '',
                    universityOther: universityOther === true,
                    majorOther: majorOther === true,
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

        // createdAt chỉ được set khi insert → mới hơn thời điểm bắt đầu xử lý nghĩa là bản ghi mới
        const created = updatedStudent.createdAt >= startedAt;
        console.log('Student upserted:', { id: updatedStudent._id, action: created ? 'created' : 'updated', schoolYear: updatedStudent.schoolYear });

        // Realtime: báo cho trang admin
        broadcast('student:upserted', { created, student: updatedStudent.toObject() });

        // 8️⃣ Trả về ngay (advice đang được AI viết, sẽ đẩy về qua realtime 'student:advice')
        res.json({
            success: true,
            message: 'Kết quả đã được xử lý',
            topGroups,
            recommendedMajors: uniqueMajors,
            recommendationText,
            student: updatedStudent,
            studentId: updatedStudent._id,
            advice: '',
            adviceStatus: 'pending'
        });

        // 9️⃣ Viết lời khuyên ở nền
        generateAdviceInBackground(updatedStudent._id, adviceJobId, {
            scores,
            topMajors: uniqueMajors,
            selectedBlocks,
            hollandScores,
            studentClass,
            university,
            major
        });
    } catch (err) {
        console.error(err);
        if (!res.headersSent) return res.status(500).json({ success: false, message: 'Server error' });
    }
};

async function generateAdviceInBackground(studentId, jobId, input) {
    const t0 = Date.now();
    let html = '';
    let status = 'fallback';
    let firstTextMs = null;
    const topic = `student:${studentId}`;
    try {
        // Stream phần AI đang viết tới đúng trang của học sinh này (kênh riêng)
        const result = await generateFullAdvice(input, {
            onProgress: ev => {
                if (ev.type === 'progress') sendTo(topic, 'advice:progress', { id: String(studentId), html: ev.html });
                else sendTo(topic, 'advice:reset', { id: String(studentId) });
            },
        });
        html = result.html;
        status = result.source === 'ai' ? 'done' : 'fallback';
        firstTextMs = result.firstTextMs || null;
    } catch (err) {
        console.error('Advice job lỗi:', err);
    }
    try {
        // Chỉ ghi nếu vẫn là job mới nhất của học sinh này (học sinh có thể đã nộp lại)
        const saved = await Student.findOneAndUpdate(
            { _id: studentId, adviceJobId: jobId },
            { $set: { advice: html, adviceStatus: status }, $unset: { adviceJobId: 1 } },
            { new: true }
        ).lean();
        if (!saved) return;
        console.log(`Advice ${status} cho ${studentId} sau ${((Date.now() - t0) / 1000).toFixed(1)}s` +
            (firstTextMs ? ` (chữ đầu tiên sau ${(firstTextMs / 1000).toFixed(1)}s)` : ''));
        const payload = { id: String(studentId), advice: html, adviceStatus: status };
        sendTo(topic, 'student:advice', payload); // trang học sinh
        broadcast('student:advice', payload);      // trang admin
    } catch (err) {
        console.error('Lưu advice lỗi:', err);
    }
}


/**
 * Server khởi động lại giữa lúc AI đang viết → các bản ghi còn 'pending' sẽ được viết lại (tuần tự).
 */
exports.resumePendingAdvice = async () => {
    try {
        const pending = await Student.find({ adviceStatus: 'pending' })
            .select('scores recommendedMajors selectedBlocks hollandScores class university major')
            .lean();
        if (!pending.length) return;
        console.log(`Viết lại ${pending.length} lời khuyên còn dang dở`);
        for (const s of pending) {
            const jobId = crypto.randomUUID();
            await Student.updateOne({ _id: s._id }, { $set: { adviceJobId: jobId } });
            await generateAdviceInBackground(s._id, jobId, {
                scores: s.scores,
                topMajors: s.recommendedMajors,
                selectedBlocks: s.selectedBlocks,
                hollandScores: s.hollandScores,
                studentClass: s.class,
                university: s.university,
                major: s.major,
            });
        }
    } catch (err) {
        console.error('resumePendingAdvice lỗi:', err.message);
    }
};
