// src/controllers/resultController.js
const { generateFullAdvice, getAiStatus } = require('../helpers/aiHelper');
const Student = require('../models/Student');
const crypto = require('crypto');
const { broadcast, sendTo } = require('../realtime');
const { getSchoolYear, normalizeSchoolYear } = require('../utils/schoolYear');
const catalogService = require('../services/catalog');
const { recommend, scoreMap } = require('../services/recommender');

// Escape ký tự đặc biệt trong regex (tránh lỗi nếu tên có . * ? ...)
function escapeRegex(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Chuẩn hoá mã môn học sinh gửi: chỉ giữ môn có thật, đúng loại, bỏ trùng */
function pickCodes(catalog, codes, kinds, limit) {
    const out = [];
    for (const raw of Array.isArray(codes) ? codes : []) {
        const s = catalog.subjectByCode.get(String(raw).toUpperCase()) || catalog.resolveSubject(raw);
        if (s && kinds.includes(s.kind) && s.active !== false && !out.includes(s.code)) out.push(s.code);
    }
    return limit ? out.slice(0, limit) : out;
}

/** Điểm học sinh gửi → gắn mã môn + tên chuẩn, bỏ môn lạ, giới hạn 0–10 */
function normalizeScores(catalog, scores) {
    const map = scoreMap(catalog, scores);
    const out = [];
    for (const [code, v] of map) {
        const s = catalog.subjectByCode.get(code);
        out.push({ subject: s.shortName || s.name, code, currentScore: v.current ?? 0, targetScore: v.target ?? 0 });
    }
    return out;
}

function buildRecommendationText(result) {
    if (!result.topGroups.length) {
        return 'Bạn không thiên hẳn về nhóm Holland nào, hãy làm lại test hoặc tham khảo ý kiến giáo viên.';
    }
    if (!result.ranked.length) {
        return result.alternatives.length
            ? `Chưa có ngành nào vừa hợp nhóm Holland ${result.hollandCode} vừa xét tuyển được bằng môn thi bạn chọn. ` +
              `Nếu đổi môn thi, bạn có thể cân nhắc: ${result.alternatives.map(m => m.name).join(', ')}.`
            : `Chưa có ngành nào trong danh mục phù hợp với nhóm Holland ${result.hollandCode}. Hãy trao đổi thêm với giáo viên.`;
    }
    return `Ngành phù hợp nhất với bạn: ${result.ranked.map(m => `${m.name} (${m.matchScore}%)`).join(', ')}.`;
}

/** Dữ liệu cho AI viết lời khuyên (dùng lúc nộp bài và lúc server khởi động lại) */
function adviceInput(catalog, s) {
    return {
        scores: s.scores || [],
        hollandScores: s.hollandScores || {},
        studentClass: s.class,
        university: s.university,
        major: s.major,
        hollandCode: s.hollandCode || '',
        usableBlocks: (s.selectedBlocks || []).map(n => catalog.blockByName.get(String(n).toUpperCase())).filter(Boolean)
            .map(b => ({ name: b.name, subjects: b.subjectNames })),
        electiveSubjects: (s.electiveSubjects || []).map(c => catalog.subjectByCode.get(c)?.name || c),
        aptitudeSubjects: (s.aptitudeSubjects || []).map(c => catalog.subjectByCode.get(c)?.name || c),
        ranked: s.recommendedMajors || [],
        alternatives: s.alternativeMajors || [],
        settings: catalog.settings,
    };
}

exports.submitResults = async (req, res) => {
    try {
        const { personalInfo = {}, hollandScores, scores } = req.body;
        const { name, class: studentClass, number, university, major, universityOther, majorOther } = personalInfo;
        if (!name || !studentClass) return res.status(400).json({ success: false, message: 'Thiếu họ tên hoặc lớp' });

        // 👇 Thêm schoolYear (lấy từ body, nếu ko có thì mặc định năm hiện tại)
        const schoolYear = normalizeSchoolYear(personalInfo.schoolYear) || getSchoolYear();

        const catalog = await catalogService.load();
        let electiveSubjects = pickCodes(catalog, req.body.electiveSubjects, ['elective'], catalog.settings.electiveCount);
        let aptitudeSubjects = pickCodes(catalog, req.body.aptitudeSubjects, ['aptitude']);
        const cleanScores = normalizeScores(catalog, scores);

        // Bản cũ của FE chưa gửi môn thi, chỉ gửi tổ hợp tự chọn → lấy môn từ các tổ hợp đó
        const legacyBlocks = !electiveSubjects.length && Array.isArray(req.body.selectedBlocks) ? req.body.selectedBlocks : null;
        if (legacyBlocks) {
            const codes = legacyBlocks.flatMap(n => catalog.blockByName.get(String(n).toUpperCase())?.subjects || []);
            electiveSubjects = pickCodes(catalog, codes, ['elective']);
            aptitudeSubjects = pickCodes(catalog, codes, ['aptitude']);
        }

        // Xếp hạng ngành: Holland + học lực theo tổ hợp + nguyện vọng
        const result = recommend(catalog, {
            hollandScores,
            electiveSubjects,
            aptitudeSubjects,
            scores: cleanScores,
            aspiration: major,
        });
        const selectedBlocks = legacyBlocks || result.usableBlocks.map(b => b.name);
        const recommendationText = buildRecommendationText(result);
        console.log(`Mã Holland: ${result.hollandCode || '—'} · ${result.usableBlocks.length} tổ hợp · ${result.ranked.length} ngành`);

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
                    selectedBlocks,
                    electiveSubjects,
                    aptitudeSubjects,
                    hollandScores: hollandScores || {},            // fallback
                    topGroups: result.topGroups,
                    hollandCode: result.hollandCode,
                    scores: cleanScores,
                    recommendedMajors: result.ranked,
                    alternativeMajors: result.alternatives,
                    recommendationText,
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
            topGroups: result.topGroups,
            hollandCode: result.hollandCode,
            usableBlocks: result.usableBlocks,
            recommendedMajors: result.ranked,
            alternativeMajors: result.alternatives,
            recommendationText,
            student: updatedStudent,
            studentId: updatedStudent._id,
            advice: '',
            adviceStatus: 'pending'
        });

        // 9️⃣ Viết lời khuyên ở nền
        generateAdviceInBackground(updatedStudent._id, adviceJobId, adviceInput(catalog, updatedStudent.toObject()));
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
            .select('scores recommendedMajors alternativeMajors selectedBlocks electiveSubjects aptitudeSubjects hollandScores hollandCode class university major')
            .lean();
        if (!pending.length) return;
        console.log(`Viết lại ${pending.length} lời khuyên còn dang dở`);
        const catalog = await catalogService.load();
        for (const s of pending) {
            const jobId = crypto.randomUUID();
            await Student.updateOne({ _id: s._id }, { $set: { adviceJobId: jobId } });
            await generateAdviceInBackground(s._id, jobId, adviceInput(catalog, s));
        }
    } catch (err) {
        console.error('resumePendingAdvice lỗi:', err.message);
    }
};


/* ================= Viết lại lời khuyên mẫu bằng AI ================= */

const ADVICE_FIELDS = 'scores recommendedMajors alternativeMajors selectedBlocks electiveSubjects aptitudeSubjects hollandScores hollandCode class university major';

/** Đặt học sinh về trạng thái "AI đang viết" rồi viết lại ở nền */
async function queueRegenerate(student, catalog) {
    const jobId = crypto.randomUUID();
    await Student.updateOne({ _id: student._id }, { $set: { adviceStatus: 'pending', adviceJobId: jobId } });
    broadcast('student:advice', { id: String(student._id), advice: '', adviceStatus: 'pending' });
    return generateAdviceInBackground(student._id, jobId, adviceInput(catalog, student));
}

/**
 * Chạy định kỳ: học sinh nhận lời khuyên mẫu (AI hết quota / lỗi lúc nộp bài) sẽ được AI viết lại
 * khi có key dùng được. Mỗi lượt tối đa `limit` em, mới nộp trước; dừng ngay nếu AI vẫn không dùng được.
 */
exports.retryFallbackAdvice = async ({ limit = 5 } = {}) => {
    try {
        const status = await getAiStatus();
        if (!status.availableKeys) return;
        const list = await Student.find({ adviceStatus: 'fallback' }).sort({ createdAt: -1 }).limit(limit).select(ADVICE_FIELDS).lean();
        if (!list.length) return;
        console.log(`Thử viết lại bằng AI cho ${list.length} lời khuyên mẫu`);
        const catalog = await catalogService.load();
        for (const s of list) {
            await queueRegenerate(s, catalog);
            const after = await Student.findById(s._id).select('adviceStatus').lean();
            if (after?.adviceStatus !== 'done') break; // AI vẫn chưa dùng được → để lượt sau
        }
    } catch (err) {
        console.error('retryFallbackAdvice lỗi:', err.message);
    }
};

// POST /api/admin/students/:id/regenerate-advice → admin bấm "Tạo lại lời khuyên AI"
exports.regenerateAdvice = async (req, res) => {
    const student = await Student.findById(req.params.id).select(ADVICE_FIELDS).lean();
    if (!student) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
    const status = await getAiStatus();
    if (!status.availableKeys) {
        return res.status(503).json({ success: false, message: 'AI đang hết lượt dùng trong ngày (quota sẽ reset lúc 7h sáng). Hệ thống sẽ tự viết lại khi có lượt.' });
    }
    const catalog = await catalogService.load();
    res.status(202).json({ success: true, message: 'Đang tạo lại lời khuyên bằng AI' });
    queueRegenerate(student, catalog).catch(err => console.error('regenerateAdvice lỗi:', err.message));
};
