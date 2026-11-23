// src/services/recommender.js
// Xếp hạng ngành cho học sinh: Holland + học lực theo tổ hợp + nguyện vọng.
// Hàm thuần (không đọc DB) → dễ kiểm thử, dùng chung cho nộp bài và trang "thử cấu hình" của admin.
const { matchKey } = require('./catalog');
const { majorField } = require('../utils/fields');

const HOLLAND_TYPES = ['R', 'I', 'A', 'S', 'E', 'C'];

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const validScore = v => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
};

/* ================= Nhóm Holland nổi trội ================= */

/**
 * Mức độ của 1 nhóm: tỉ lệ số câu đã chọn / số câu của nhóm (0–1).
 * Không có số câu (VD gọi từ chỗ khác) → dùng điểm thô (tương đương khi các nhóm cùng số câu).
 */
function groupLevel(hollandScores, type, questionCounts) {
    const score = Number(hollandScores?.[type] ?? hollandScores?.[type.toLowerCase()]) || 0;
    const total = Number(questionCounts?.[type]) || 0;
    return { score, level: total > 0 ? score / total : score };
}

/**
 * Lấy theo từng bậc (các nhóm bằng mức đi cùng nhau, không cắt lẻ) cho tới khi đủ `min` nhóm,
 * không vượt `max`. Bậc cao nhất đã quá `max` nhóm hoặc mọi nhóm 0 điểm → không có nhóm nổi trội.
 * So sánh theo TỈ LỆ khi biết số câu mỗi nhóm (nhóm nhiều câu hơn không được lợi); `score` trả về vẫn là điểm thô.
 */
function computeTopGroups(hollandScores, { min = 3, max = 4 } = {}, questionCounts = null) {
    const key = v => Math.round(v * 10000); // so bằng an toàn với số thực
    const sorted = HOLLAND_TYPES
        .map(t => ({ type: t, ...groupLevel(hollandScores, t, questionCounts) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.level - a.level || HOLLAND_TYPES.indexOf(a.type) - HOLLAND_TYPES.indexOf(b.type));

    const buckets = [];
    for (const item of sorted) {
        const last = buckets[buckets.length - 1];
        if (last && key(last.level) === key(item.level)) last.items.push(item);
        else buckets.push({ level: item.level, items: [item] });
    }
    if (!buckets.length || buckets[0].items.length > max) return [];

    const included = [];
    for (const bucket of buckets) {
        if (included.length >= min) break;
        if (included.length + bucket.items.length > max) break;
        bucket.items.forEach(it => included.push({ type: it.type, score: it.score }));
    }
    return included;
}

/* ================= Tổ hợp học sinh dùng được ================= */

/**
 * Môn học sinh có: môn bắt buộc + môn tự chọn + môn năng khiếu đã chọn.
 * Tổ hợp dùng được = tổ hợp đang bật có cả 3 môn nằm trong số đó.
 */
function availableSubjects(catalog, { electiveSubjects = [], aptitudeSubjects = [] } = {}) {
    const set = new Set(catalog.subjects.filter(s => s.active !== false && s.kind === 'required').map(s => s.code));
    for (const code of [...electiveSubjects, ...aptitudeSubjects]) {
        const s = catalog.subjectByCode.get(code);
        if (s && s.active !== false && s.kind !== 'required') set.add(code);
    }
    return set;
}

function usableBlocks(catalog, available) {
    return catalog.blocks.filter(b => b.active !== false && b.valid && b.subjects.every(c => available.has(c)));
}

/* ================= Điểm theo môn ================= */

/** Map mã môn → { current, target }; nhận cả dữ liệu cũ chỉ có tên môn. */
function scoreMap(catalog, scores = []) {
    const map = new Map();
    for (const s of scores || []) {
        const subj = (s.code && catalog.subjectByCode.get(s.code)) || catalog.resolveSubject(s.subject);
        if (!subj) continue;
        map.set(subj.code, { current: validScore(s.currentScore), target: validScore(s.targetScore) });
    }
    return map;
}

function pickScore(entry, basis) {
    if (!entry) return null;
    const { current, target } = entry;
    if (basis === 'target') return target ?? current;
    if (basis === 'average') return current !== null && target !== null ? (current + target) / 2 : current ?? target;
    return current ?? target; // 'current': chưa có điểm hiện tại thì tạm dùng điểm mục tiêu
}

function blockTotals(block, scores, basis) {
    const values = block.subjects.map(c => pickScore(scores.get(c), basis));
    const targets = block.subjects.map(c => scores.get(c)?.target ?? null);
    return {
        total: values.every(v => v !== null) ? round(values.reduce((a, b) => a + b, 0)) : null,
        targetTotal: targets.every(v => v !== null) ? round(targets.reduce((a, b) => a + b, 0)) : null,
    };
}

/* ================= Xếp hạng ================= */

/**
 * Mức khớp nguyện vọng: 1 = tên ngành / từ khoá nằm trong câu trả lời của học sinh (hoặc ngược lại),
 * 0.5 = cùng lĩnh vực (VD "CNTT" và "Khoa học máy tính"), 0 = không liên quan.
 */
function aspirationLevel(major, aspirationKey, aspirationField) {
    if (!aspirationKey) return 0;
    const padded = ` ${aspirationKey} `;
    const exact = [major.name, ...(major.keywords || [])].some(k => {
        const key = matchKey(k);
        if (!key || key.length < 2) return false;
        return padded.includes(` ${key} `) || (aspirationKey.length >= 4 && ` ${key} `.includes(padded));
    });
    if (exact) return 1;
    return aspirationField && majorField(major.name) === aspirationField ? 0.5 : 0;
}

/**
 * @param {object} catalog   kết quả catalog.load()
 * @param {object} input     { hollandScores, electiveSubjects, aptitudeSubjects, scores, aspiration }
 * @returns {{ topGroups, hollandCode, usableBlocks, ranked, alternatives }}
 */
function recommend(catalog, input) {
    const settings = catalog.settings;
    const counts = input.questionCounts || catalog.questionCounts || null;
    const topGroups = computeTopGroups(input.hollandScores, settings.topGroups, counts);
    const topTypes = new Set(topGroups.map(g => g.type));
    const level = t => groupLevel(input.hollandScores, t, counts).level;
    const maxLevel = Math.max(1e-9, ...HOLLAND_TYPES.map(level));
    const norm = t => level(t) / maxLevel;
    const profileNorm = Math.sqrt(topGroups.reduce((s, g) => s + norm(g.type) ** 2, 0)) || 1;

    const available = availableSubjects(catalog, input);
    const blocks = usableBlocks(catalog, available);
    const usable = new Set(blocks.map(b => b.name));
    const scores = scoreMap(catalog, input.scores);
    const hasScores = [...scores.values()].some(s => s.current !== null || s.target !== null);
    const aspirationKey = matchKey(input.aspiration);
    const field = majorField(input.aspiration);
    const aspirationField = field && field !== 'Khác' && field !== 'Chưa xác định' ? field : null;
    const w = settings.weights;

    const ranked = [];
    const alternatives = [];

    for (const major of catalog.majors) {
        if (major.active === false) continue;
        const groups = (major.hollandGroups || []).filter(g => HOLLAND_TYPES.includes(g));
        const matchedGroups = groups.filter(g => topTypes.has(g));
        if (!groups.length || !matchedGroups.length) continue; // không khớp nhóm nổi trội nào

        // Holland: độ giống (cosine) giữa hồ sơ nhóm nổi trội của học sinh và các nhóm của ngành.
        // Ngành khớp nhiều nhóm nổi trội (VD học sinh ICE, ngành IC) cao hơn ngành chỉ khớp 1 nhóm (I),
        // ngành có nhóm học sinh không mạnh (VD IR) bị kéo xuống.
        const hollandFit = Math.min(1, groups.reduce((sum, g) => sum + (topTypes.has(g) ? norm(g) : 0), 0) / (profileNorm * Math.sqrt(groups.length)));

        const majorBlocks = (major.examBlocks || []).map(n => catalog.blockByName.get(String(n).toUpperCase())).filter(b => b && b.active !== false && b.valid);
        const aspirationScore = aspirationLevel(major, aspirationKey, aspirationField);
        const aspiration = aspirationScore === 1;
        const base = {
            majorId: String(major._id),
            name: major.name,
            description: major.description || '',
            hollandGroups: groups,
            matchedGroups,
            hollandFit: round(hollandFit),
            aspirationMatch: aspiration,
            aspirationSameField: aspirationScore === 0.5,
            benchmarkScore: Number.isFinite(major.benchmarkScore) ? major.benchmarkScore : null,
            requiresAptitude: majorBlocks.length > 0 && majorBlocks.every(b => b.aptitude),
        };

        const open = majorBlocks.filter(b => usable.has(b.name));
        if (majorBlocks.length && !open.length) {
            // Hợp tính cách nhưng học sinh chưa có tổ hợp nào → gợi ý đổi môn / thi năng khiếu
            const best = majorBlocks
                .map(b => ({ block: b, missing: b.subjects.filter(c => !available.has(c)) }))
                .sort((a, b) => a.missing.length - b.missing.length || Number(a.block.aptitude) - Number(b.block.aptitude))[0];
            alternatives.push({
                ...base,
                block: best.block.name,
                missingSubjects: best.missing.map(c => catalog.subjectByCode.get(c)?.name || c),
                missingAptitude: best.missing.some(c => catalog.subjectByCode.get(c)?.kind === 'aptitude'),
                matchScore: Math.round(hollandFit * 100),
            });
            continue;
        }

        // Học lực: tổ hợp có tổng điểm cao nhất trong các tổ hợp học sinh dùng được
        let academic = null;
        if (open.length) {
            const options = open.map(b => ({ block: b, ...blockTotals(b, scores, settings.scoreBasis) }));
            options.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
            const best = options[0];
            let fit = null;
            let status = null;
            if (best.total !== null) {
                if (base.benchmarkScore) {
                    const diff = best.total - base.benchmarkScore;
                    fit = Math.min(1, Math.max(0, 0.5 + diff / 6)); // ±3 điểm quanh điểm chuẩn
                    status = diff >= 1 ? 'safe' : diff >= -1.5 ? 'fit' : 'reach';
                } else {
                    fit = best.total / 30;
                }
            }
            academic = {
                block: best.block.name,
                subjects: best.block.subjectNames,
                total: best.total,
                targetTotal: best.targetTotal,
                fit: fit === null ? null : round(fit),
                status,
                otherBlocks: open.filter(b => b.name !== best.block.name).map(b => b.name),
            };
        }

        // Tổng hợp: bỏ thành phần thiếu dữ liệu rồi chia lại trọng số
        const parts = [[w.holland, hollandFit]];
        if (academic?.fit !== null && academic?.fit !== undefined && hasScores) parts.push([w.academic, academic.fit]);
        if (aspirationKey) parts.push([w.aspiration, aspirationScore]);
        const totalWeight = parts.reduce((s, [wt]) => s + wt, 0) || 1;
        const matchScore = Math.round((parts.reduce((s, [wt, v]) => s + wt * v, 0) / totalWeight) * 100);

        ranked.push({ ...base, academic, noBlockData: !majorBlocks.length, matchScore });
    }

    ranked.sort((a, b) => b.matchScore - a.matchScore || b.hollandFit - a.hollandFit || a.name.localeCompare(b.name, 'vi'));
    alternatives.sort((a, b) => b.matchScore - a.matchScore || a.missingSubjects.length - b.missingSubjects.length);

    return {
        topGroups,
        hollandCode: topGroups.map(g => g.type).join(''),
        usableBlocks: blocks.map(b => ({ name: b.name, subjects: b.subjectNames, aptitude: b.aptitude })),
        ranked: ranked.slice(0, settings.topMajorCount),
        alternatives: settings.showAlternatives ? alternatives.slice(0, settings.alternativeCount) : [],
    };
}

module.exports = { recommend, computeTopGroups, availableSubjects, usableBlocks, scoreMap, HOLLAND_TYPES };
