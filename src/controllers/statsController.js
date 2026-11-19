// src/controllers/statsController.js
// Thống kê chi tiết cho trang admin.
const Student = require('../models/Student');
const Option = require('../models/Option');

const HOLLAND = ['R', 'I', 'A', 'S', 'E', 'C'];

function normKey(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
}

/**
 * Đếm theo tên, gộp các cách viết khác hoa/thường/khoảng trắng.
 * Tên hiển thị = cách viết xuất hiện nhiều nhất.
 */
function countByName(values) {
    const map = new Map(); // key -> { count, spellings: Map }
    for (const raw of values) {
        const key = normKey(raw);
        if (!key) continue;
        const display = String(raw).replace(/\s+/g, ' ').trim();
        let entry = map.get(key);
        if (!entry) {
            entry = { count: 0, spellings: new Map() };
            map.set(key, entry);
        }
        entry.count++;
        entry.spellings.set(display, (entry.spellings.get(display) || 0) + 1);
    }
    return [...map.values()]
        .map(e => ({
            name: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
            count: e.count,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'));
}

function countSimple(values) {
    const map = new Map();
    for (const v of values) {
        if (!v) continue;
        map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'vi'));
}

/** Nhóm Holland cao nhất (trả về mảng vì có thể đồng điểm). */
function topHollandTypes(scores) {
    if (!scores) return [];
    const entries = HOLLAND.map(k => [k, Number(scores[k]) || 0]);
    const max = Math.max(...entries.map(e => e[1]));
    if (max <= 0) return [];
    return entries.filter(e => e[1] === max).map(e => e[0]);
}

/** Mã Holland 2 chữ (2 nhóm điểm cao nhất), bỏ qua nếu không có điểm. */
function hollandCode2(scores) {
    if (!scores) return '';
    const entries = HOLLAND.map(k => [k, Number(scores[k]) || 0]).filter(e => e[1] > 0);
    if (entries.length < 2) return '';
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0] + entries[1][0];
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/admin/stats/detailed?schoolYear=2025-2026&class=12A1
exports.getDetailedStats = async (req, res) => {
    const { schoolYear, class: cls } = req.query;

    const filter = {};
    if (typeof schoolYear === 'string' && schoolYear.trim()) filter.schoolYear = schoolYear.trim();
    if (typeof cls === 'string' && cls.trim()) {
        filter.class = { $regex: new RegExp(`^${escapeRegex(cls.trim())}$`, 'i') };
    }

    const [students, schoolYears, universityOptions, majorOptions] = await Promise.all([
        Student.find(filter)
            .select('class schoolYear selectedBlocks hollandScores university major universityOther majorOther advice createdAt')
            .lean(),
        Student.distinct('schoolYear'),
        Option.find({ type: 'university' }).select('name').lean(),
        Option.find({ type: 'major' }).select('name').lean(),
    ]);

    const total = students.length;
    const uniKeys = new Set(universityOptions.map(o => normKey(o.name)));
    const majorKeys = new Set(majorOptions.map(o => normKey(o.name)));

    // Trường / ngành mong muốn
    const withUniversity = students.filter(s => normKey(s.university));
    const withMajor = students.filter(s => normKey(s.major));

    // "Khác" = học sinh tự nhập, hoặc tên không nằm trong danh mục hiện tại
    const isOtherMajor = s => s.majorOther === true || !majorKeys.has(normKey(s.major));
    const isOtherUni = s => s.universityOther === true || !uniKeys.has(normKey(s.university));

    const otherMajorStudents = withMajor.filter(isOtherMajor);
    const otherUniStudents = withUniversity.filter(isOtherUni);

    // Holland
    const dominant = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    const sums = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    let withHolland = 0;
    const codes = [];
    for (const s of students) {
        const top = topHollandTypes(s.hollandScores);
        if (!top.length) continue;
        withHolland++;
        top.forEach(t => dominant[t]++);
        HOLLAND.forEach(k => (sums[k] += Number(s.hollandScores[k]) || 0));
        const code = hollandCode2(s.hollandScores);
        if (code) codes.push(code);
    }

    // Theo ngày (YYYY-MM-DD theo giờ VN)
    const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const byDay = countSimple(students.map(s => (s.createdAt ? dayFmt.format(new Date(s.createdAt)) : null)))
        .sort((a, b) => a.name.localeCompare(b.name));

    // Cặp trường + ngành phổ biến
    const pairs = countByName(
        students
            .filter(s => normKey(s.university) && normKey(s.major))
            .map(s => `${s.major.trim()} — ${s.university.trim()}`)
    );

    const byUniversity = countByName(withUniversity.map(s => s.university));
    const byMajor = countByName(withMajor.map(s => s.major));
    const classes = countSimple(students.map(s => String(s.class || '').toUpperCase()));

    res.json({
        success: true,
        data: {
            filters: {
                schoolYear: filter.schoolYear || null,
                class: cls || null,
                schoolYears: schoolYears.filter(Boolean).sort().reverse(),
            },
            summary: {
                totalStudents: total,
                totalClasses: classes.length,
                distinctUniversities: byUniversity.length,
                distinctMajors: byMajor.length,
                withUniversity: withUniversity.length,
                withMajor: withMajor.length,
                otherMajorCount: otherMajorStudents.length,
                otherUniversityCount: otherUniStudents.length,
                withAdvice: students.filter(s => s.advice && s.advice.trim()).length,
                withHolland,
            },
            byUniversity,
            byMajor,
            otherMajors: countByName(otherMajorStudents.map(s => s.major)),
            otherUniversities: countByName(otherUniStudents.map(s => s.university)),
            topPairs: pairs.slice(0, 15),
            holland: {
                dominant: HOLLAND.map(k => ({ type: k, count: dominant[k] })),
                average: HOLLAND.map(k => ({
                    type: k,
                    value: withHolland ? Math.round((sums[k] / withHolland) * 10) / 10 : 0,
                })),
                topCodes: countSimple(codes).slice(0, 10),
            },
            examBlocks: countSimple(students.flatMap(s => s.selectedBlocks || [])),
            byClass: classes.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true })),
            byDay,
        },
    });
};
