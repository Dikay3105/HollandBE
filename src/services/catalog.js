// src/services/catalog.js
// Nguồn dữ liệu cho việc tư vấn: môn học, tổ hợp, ngành, cấu hình.
// Đọc từ database (admin quản lý), cache trong bộ nhớ; mọi API ghi của admin gọi invalidate().
const Subject = require('../models/Subject');
const ExamBlock = require('../models/ExamBlock');
const Major = require('../models/Major');
const Setting = require('../models/Setting');
const { SUBJECTS, BLOCKS, DEFAULT_SETTINGS, ALIAS_MIGRATIONS, ALIAS_REMOVALS } = require('../data/catalogDefaults');

const SETTINGS_KEY = 'recommendation';
const SEED_FLAG_KEY = 'catalogSeeded';
const VERSION_KEY = 'catalogVersion';
const CACHE_MS = 60 * 1000;

let cache = null;
let cacheAt = 0;

/** Khoá so khớp: bỏ dấu, chữ thường, chỉ giữ chữ + số */
function matchKey(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* ================= Cấu hình ================= */

const clamp = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Gộp cấu hình admin gửi lên với mặc định, ép kiểu + giới hạn để không lưu giá trị hỏng. */
function sanitizeSettings(input = {}) {
    const d = DEFAULT_SETTINGS;
    const w = input.weights || {};
    const tg = input.topGroups || {};
    const ai = input.ai || {};
    const min = clamp(tg.min, 1, 6, d.topGroups.min);
    return {
        weights: {
            holland: clamp(w.holland, 0, 100, d.weights.holland),
            academic: clamp(w.academic, 0, 100, d.weights.academic),
            aspiration: clamp(w.aspiration, 0, 100, d.weights.aspiration),
        },
        topGroups: { min, max: clamp(tg.max, min, 6, Math.max(min, d.topGroups.max)) },
        electiveCount: clamp(input.electiveCount, 1, 6, d.electiveCount),
        scoreBasis: ['current', 'target', 'average'].includes(input.scoreBasis) ? input.scoreBasis : d.scoreBasis,
        topMajorCount: clamp(input.topMajorCount, 3, 20, d.topMajorCount),
        showAlternatives: typeof input.showAlternatives === 'boolean' ? input.showAlternatives : d.showAlternatives,
        alternativeCount: clamp(input.alternativeCount, 0, 10, d.alternativeCount),
        region: typeof input.region === 'string' && input.region.trim() ? input.region.trim().slice(0, 60) : d.region,
        ai: {
            majorCount: clamp(ai.majorCount, 3, 10, d.ai.majorCount),
            allowExternalMajors: typeof ai.allowExternalMajors === 'boolean' ? ai.allowExternalMajors : d.ai.allowExternalMajors,
            maxExternalMajors: clamp(ai.maxExternalMajors, 0, 5, d.ai.maxExternalMajors),
        },
    };
}

async function getSettings() {
    const doc = await Setting.findOne({ key: SETTINGS_KEY }).lean();
    return sanitizeSettings(doc?.value || {});
}

async function saveSettings(input) {
    const value = sanitizeSettings(input);
    await Setting.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { value } }, { upsert: true });
    invalidate();
    return value;
}

/* ================= Khởi tạo / chuyển dữ liệu cũ ================= */

/**
 * Chạy khi server khởi động:
 * - Lần đầu: nạp môn học + tổ hợp mặc định (không ghi đè tổ hợp admin đã có).
 * - Tổ hợp cũ lưu tên môn ("Vật lý") → đổi sang mã môn ("LY").
 * Cờ catalogSeeded đảm bảo chỉ nạp 1 lần: admin xoá môn/tổ hợp thì không bị nạp lại.
 */
async function ensureCatalog() {
    try {
        const seeded = await Setting.exists({ key: SEED_FLAG_KEY });
        if (!seeded) {
            if (!(await Subject.exists({}))) {
                await Subject.insertMany(SUBJECTS.map(([code, name, shortName, kind, group, aliases], i) => ({
                    code, name, shortName, kind, group, aliases, order: i,
                })));
                console.log(`🌱 Nạp ${SUBJECTS.length} môn học mặc định`);
            }
            const existing = new Set((await ExamBlock.find().select('name').lean()).map(b => b.name.toUpperCase()));
            const missing = Object.entries(BLOCKS).filter(([name]) => !existing.has(name));
            if (missing.length) {
                await ExamBlock.insertMany(missing.map(([name, subjects]) => ({ name, subjects })));
                console.log(`🌱 Thêm ${missing.length} tổ hợp mặc định`);
            }
            if (!(await Setting.exists({ key: SETTINGS_KEY }))) {
                await Setting.create({ key: SETTINGS_KEY, value: DEFAULT_SETTINGS });
            }
            await Setting.create({ key: SEED_FLAG_KEY, value: new Date().toISOString() });
        }

        // Bổ sung tên gọi cũ cho môn (theo phiên bản, mỗi phiên bản chạy 1 lần)
        const versionDoc = await Setting.findOne({ key: VERSION_KEY }).lean();
        const version = Number(versionDoc?.value) || 1;
        const versions = Object.keys(ALIAS_MIGRATIONS).map(Number).filter(v => v > version).sort((a, b) => a - b);
        for (const v of versions) {
            for (const [code, names] of Object.entries(ALIAS_REMOVALS[v] || {})) {
                await Subject.updateOne({ code }, { $pull: { aliases: { $in: names } } });
            }
            for (const [code, names] of Object.entries(ALIAS_MIGRATIONS[v])) {
                await Subject.updateOne({ code }, { $addToSet: { aliases: { $each: names } } });
            }
            await Setting.findOneAndUpdate({ key: VERSION_KEY }, { $set: { value: v } }, { upsert: true });
            console.log(`🔁 Cập nhật danh mục môn lên phiên bản ${v}`);
        }

        // Tổ hợp còn lưu tên môn → đổi sang mã môn
        const subjects = await Subject.find().lean();
        const resolve = subjectResolver(subjects);
        const codes = new Set(subjects.map(s => s.code));
        for (const block of await ExamBlock.find().lean()) {
            if ((block.subjects || []).every(s => codes.has(s))) continue;
            const mapped = (block.subjects || []).map(s => resolve(s)?.code || s);
            const unknown = mapped.filter(s => !codes.has(s));
            if (unknown.length) {
                console.warn(`⚠️ Tổ hợp ${block.name}: không nhận ra môn ${unknown.join(', ')} – admin cần sửa`);
                continue;
            }
            await ExamBlock.updateOne({ _id: block._id }, { $set: { subjects: mapped } });
            console.log(`🔁 Tổ hợp ${block.name}: ${block.subjects.join(', ')} → ${mapped.join(', ')}`);
        }
        invalidate();
    } catch (err) {
        console.error('ensureCatalog lỗi:', err.message);
    }
}

/* ================= Đọc dữ liệu (cache) ================= */

/** Tìm môn theo mã / tên / tên ngắn / alias (không phân biệt dấu, hoa thường). */
function subjectResolver(subjects) {
    const map = new Map();
    for (const s of subjects) {
        for (const k of [s.code, s.name, s.shortName, ...(s.aliases || [])]) {
            const key = matchKey(k);
            if (key && !map.has(key)) map.set(key, s);
        }
    }
    return value => map.get(matchKey(value)) || null;
}

async function load() {
    if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
    const [subjects, blocks, majors, settings] = await Promise.all([
        Subject.find().sort({ order: 1, name: 1 }).lean(),
        ExamBlock.find().sort({ name: 1 }).lean(),
        Major.find().lean(),
        getSettings(),
    ]);
    const subjectByCode = new Map(subjects.map(s => [s.code, s]));
    const enrichedBlocks = blocks.map(b => {
        const subs = (b.subjects || []).map(c => subjectByCode.get(c)).filter(Boolean);
        return {
            ...b,
            name: b.name.toUpperCase(),
            subjectNames: subs.map(s => s.shortName || s.name),
            aptitude: subs.some(s => s.kind === 'aptitude'),
            valid: subs.length === 3,
        };
    });
    cache = {
        subjects,
        subjectByCode,
        resolveSubject: subjectResolver(subjects),
        blocks: enrichedBlocks,
        blockByName: new Map(enrichedBlocks.map(b => [b.name, b])),
        majors,
        settings,
    };
    cacheAt = Date.now();
    return cache;
}

function invalidate() {
    cache = null;
}

module.exports = { ensureCatalog, load, invalidate, getSettings, saveSettings, sanitizeSettings, matchKey, DEFAULT_SETTINGS };
