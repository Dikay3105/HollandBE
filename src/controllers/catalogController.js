// src/controllers/catalogController.js
// Môn học, tổ hợp, ngành, cấu hình tư vấn: API công khai (form học sinh) + CRUD cho admin.
const Subject = require('../models/Subject');
const ExamBlock = require('../models/ExamBlock');
const Major = require('../models/Major');
const catalogService = require('../services/catalog');
const { recommend } = require('../services/recommender');

const HOLLAND = ['R', 'I', 'A', 'S', 'E', 'C'];

const wrap = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ success: false, message: 'Mã hoặc tên đã tồn tại' });
        if (err.name === 'ValidationError' || err.name === 'CastError' || err.status === 400) {
            return res.status(400).json({ success: false, message: err.message });
        }
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

const bad = message => Object.assign(new Error(message), { status: 400 });
const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strList = (v, max = 80) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map(x => str(x, max)).filter(Boolean))];

/* ================= Công khai ================= */

// GET /api/config → dữ liệu form học sinh: môn học, tổ hợp đang bật, số môn tự chọn
exports.getPublicConfig = wrap(async (req, res) => {
    const c = await catalogService.load();
    res.json({
        success: true,
        data: {
            subjects: c.subjects.filter(s => s.active !== false)
                .map(({ code, name, shortName, kind, group }) => ({ code, name, shortName, kind, group })),
            blocks: c.blocks.filter(b => b.active !== false && b.valid)
                .map(({ name, subjects, subjectNames, aptitude }) => ({ name, subjects, subjectNames, aptitude })),
            electiveCount: c.settings.electiveCount,
            topGroups: c.settings.topGroups,
        },
    });
});

/* ================= Môn học ================= */

function subjectPayload(body) {
    const out = {};
    if (body.code !== undefined) out.code = str(body.code, 20).toUpperCase();
    if (body.name !== undefined) out.name = str(body.name, 80);
    if (body.shortName !== undefined) out.shortName = str(body.shortName, 30);
    if (body.aliases !== undefined) out.aliases = strList(body.aliases);
    if (body.kind !== undefined) out.kind = body.kind;
    if (body.group !== undefined) out.group = str(body.group, 60);
    if (body.order !== undefined && Number.isFinite(Number(body.order))) out.order = Number(body.order);
    if (typeof body.active === 'boolean') out.active = body.active;
    return out;
}

exports.listSubjects = wrap(async (req, res) => {
    const [subjects, blocks] = await Promise.all([Subject.find().sort({ order: 1, name: 1 }).lean(), ExamBlock.find().select('subjects').lean()]);
    const usage = {};
    blocks.forEach(b => (b.subjects || []).forEach(c => (usage[c] = (usage[c] || 0) + 1)));
    res.json({ success: true, data: subjects.map(s => ({ ...s, blockCount: usage[s.code] || 0 })) });
});

exports.createSubject = wrap(async (req, res) => {
    const data = subjectPayload(req.body);
    if (!data.code || !data.name || !data.kind) throw bad('Cần mã môn, tên môn và loại môn');
    if (data.order === undefined) data.order = await Subject.countDocuments();
    const s = await Subject.create(data);
    catalogService.invalidate();
    res.status(201).json({ success: true, data: s });
});

exports.updateSubject = wrap(async (req, res) => {
    const data = subjectPayload(req.body);
    delete data.code; // mã môn là khoá tham chiếu của tổ hợp → không cho đổi
    const s = await Subject.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!s) return res.status(404).json({ success: false, message: 'Không tìm thấy môn' });
    catalogService.invalidate();
    res.json({ success: true, data: s });
});

exports.deleteSubject = wrap(async (req, res) => {
    const s = await Subject.findById(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: 'Không tìm thấy môn' });
    const used = await ExamBlock.find({ subjects: s.code }).select('name').lean();
    if (used.length) {
        throw bad(`Môn đang dùng trong ${used.length} tổ hợp (${used.slice(0, 6).map(b => b.name).join(', ')}). Hãy tắt môn thay vì xoá, hoặc sửa các tổ hợp trước.`);
    }
    await s.deleteOne();
    catalogService.invalidate();
    res.json({ success: true });
});

/* ================= Tổ hợp ================= */

async function blockPayload(body) {
    const out = {};
    if (body.name !== undefined) {
        out.name = str(body.name, 10).toUpperCase();
        if (!/^[A-Z0-9]{2,10}$/.test(out.name)) throw bad('Mã tổ hợp chỉ gồm chữ và số, VD: A00');
    }
    if (body.subjects !== undefined) {
        const codes = [...new Set((body.subjects || []).map(c => String(c).toUpperCase()))];
        if (codes.length !== 3) throw bad('Tổ hợp phải có đúng 3 môn khác nhau');
        const found = await Subject.countDocuments({ code: { $in: codes } });
        if (found !== 3) throw bad('Có môn không tồn tại trong danh mục');
        out.subjects = codes;
    }
    if (body.note !== undefined) out.note = str(body.note, 200);
    if (typeof body.active === 'boolean') out.active = body.active;
    return out;
}

exports.listBlocks = wrap(async (req, res) => {
    const [blocks, majors] = await Promise.all([ExamBlock.find().sort({ name: 1 }).lean(), Major.find().select('examBlocks').lean()]);
    const usage = {};
    majors.forEach(m => (m.examBlocks || []).forEach(b => (usage[String(b).toUpperCase()] = (usage[String(b).toUpperCase()] || 0) + 1)));
    res.json({ success: true, data: blocks.map(b => ({ ...b, majorCount: usage[b.name] || 0 })) });
});

exports.createBlock = wrap(async (req, res) => {
    const data = await blockPayload(req.body);
    if (!data.name || !data.subjects) throw bad('Cần mã tổ hợp và 3 môn');
    const b = await ExamBlock.create(data);
    catalogService.invalidate();
    res.status(201).json({ success: true, data: b });
});

exports.updateBlock = wrap(async (req, res) => {
    const data = await blockPayload(req.body);
    const old = await ExamBlock.findById(req.params.id);
    if (!old) return res.status(404).json({ success: false, message: 'Không tìm thấy tổ hợp' });
    const renamed = data.name && data.name !== old.name ? old.name : null;
    Object.assign(old, data);
    await old.save();
    // Đổi mã tổ hợp → cập nhật luôn trong dữ liệu ngành
    if (renamed) await Major.updateMany({ examBlocks: renamed }, { $set: { 'examBlocks.$': old.name } });
    catalogService.invalidate();
    res.json({ success: true, data: old });
});

exports.deleteBlock = wrap(async (req, res) => {
    const b = await ExamBlock.findById(req.params.id);
    if (!b) return res.status(404).json({ success: false, message: 'Không tìm thấy tổ hợp' });
    const r = await Major.updateMany({ examBlocks: b.name }, { $pull: { examBlocks: b.name } });
    await b.deleteOne();
    catalogService.invalidate();
    res.json({ success: true, removedFromMajors: r.modifiedCount });
});

/* ================= Ngành ================= */

const MAJOR_DEFAULTS = { description: '', examBlocks: [], hollandGroups: [], keywords: [], benchmarkScore: null, active: true };

function majorPayload(body) {
    const out = {};
    if (body.name !== undefined) out.name = str(body.name, 150);
    if (body.description !== undefined) out.description = str(body.description, 500);
    if (body.examBlocks !== undefined) out.examBlocks = strList(body.examBlocks, 10).map(b => b.toUpperCase());
    if (body.hollandGroups !== undefined) {
        // Nhận ["R","I"], "R, I" hoặc "RI"
        const raw = Array.isArray(body.hollandGroups) ? body.hollandGroups.join(',') : String(body.hollandGroups || '');
        out.hollandGroups = [...new Set(raw.toUpperCase().match(/[RIASEC]/g) || [])];
    }
    if (body.benchmarkScore !== undefined) {
        const n = body.benchmarkScore === null || body.benchmarkScore === '' ? null : Number(String(body.benchmarkScore).replace(',', '.'));
        if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 30)) throw bad('Điểm chuẩn phải từ 0 đến 30');
        out.benchmarkScore = n;
    }
    if (body.keywords !== undefined) out.keywords = strList(body.keywords);
    if (typeof body.active === 'boolean') out.active = body.active;
    return out;
}

exports.listMajors = wrap(async (req, res) => {
    const majors = await Major.find().collation({ locale: 'vi' }).sort({ name: 1 }).lean();
    // Ngành cũ có thể thiếu trường mới → điền mặc định để FE không lỗi
    const data = majors.map(m => ({ ...MAJOR_DEFAULTS, ...m }));
    res.json({ success: true, data });
});

exports.createMajor = wrap(async (req, res) => {
    const data = majorPayload(req.body);
    if (!data.name) throw bad('Cần tên ngành');
    const m = await Major.create(data);
    catalogService.invalidate();
    res.status(201).json({ success: true, data: m });
});

exports.updateMajor = wrap(async (req, res) => {
    const m = await Major.findByIdAndUpdate(req.params.id, majorPayload(req.body), { new: true, runValidators: true });
    if (!m) return res.status(404).json({ success: false, message: 'Không tìm thấy ngành' });
    catalogService.invalidate();
    res.json({ success: true, data: m });
});

exports.deleteMajor = wrap(async (req, res) => {
    const m = await Major.findByIdAndDelete(req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Không tìm thấy ngành' });
    catalogService.invalidate();
    res.json({ success: true });
});

// POST /api/admin/majors/bulk { ids, set: { active?, addBlocks?, removeBlocks?, benchmarkScore? } }
exports.bulkUpdateMajors = wrap(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(id => /^[a-f0-9]{24}$/.test(id));
    if (!ids.length) throw bad('Chưa chọn ngành nào');
    const set = req.body.set || {};
    const ops = [];
    if (typeof set.active === 'boolean') ops.push({ $set: { active: set.active } });
    const add = strList(set.addBlocks, 10).map(b => b.toUpperCase());
    const remove = strList(set.removeBlocks, 10).map(b => b.toUpperCase());
    if (add.length) ops.push({ $addToSet: { examBlocks: { $each: add } } });
    if (remove.length) ops.push({ $pull: { examBlocks: { $in: remove } } });
    if (!ops.length) throw bad('Không có thay đổi');
    let modified = 0;
    for (const op of ops) modified += (await Major.updateMany({ _id: { $in: ids } }, op)).modifiedCount;
    catalogService.invalidate();
    res.json({ success: true, modified });
});

// POST /api/admin/majors/import { rows: [{ name, description?, examBlocks?, hollandGroups?, benchmarkScore?, keywords?, active? }], dryRun? }
// Khớp theo tên ngành (không phân biệt dấu/hoa thường): có rồi → cập nhật các cột được điền, chưa có → thêm mới.
exports.importMajors = wrap(async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 2000) : [];
    if (!rows.length) throw bad('File không có dòng dữ liệu nào');
    const existing = await Major.find().lean();
    const byKey = new Map(existing.map(m => [catalogService.matchKey(m.name), m]));
    const blockNames = new Set((await ExamBlock.find().select('name').lean()).map(b => b.name));

    const created = [];
    const updated = [];
    const errors = [];
    const unknownBlocks = new Set();
    const ops = [];
    let unchanged = 0;
    rows.forEach((row, i) => {
        try {
            // Chỉ lấy cột có giá trị → ô trống không xoá dữ liệu đang có
            const filled = Object.fromEntries(Object.entries(row || {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ''));
            const data = majorPayload(filled);
            if (!data.name) throw bad('thiếu tên ngành');
            (data.examBlocks || []).filter(b => !blockNames.has(b)).forEach(b => unknownBlocks.add(b));
            const found = byKey.get(catalogService.matchKey(data.name));
            if (found) {
                delete data.name;
                // Bỏ trường giống hệt dữ liệu đang có → chỉ đếm ngành thật sự thay đổi
                for (const k of Object.keys(data)) if (JSON.stringify(data[k]) === JSON.stringify(found[k] ?? MAJOR_DEFAULTS[k])) delete data[k];
                if (!Object.keys(data).length) unchanged++;
                else {
                    updated.push(found.name);
                    ops.push({ updateOne: { filter: { _id: found._id }, update: { $set: data } } });
                }
            } else {
                created.push(data.name);
                byKey.set(catalogService.matchKey(data.name), data);
                ops.push({ insertOne: { document: { hollandGroups: [], examBlocks: [], ...data } } });
            }
        } catch (err) {
            errors.push(`Dòng ${i + 2}: ${err.message}`);
        }
    });

    if (!req.body.dryRun && ops.length) {
        await Major.bulkWrite(ops, { ordered: false });
        catalogService.invalidate();
    }
    res.json({
        success: true,
        dryRun: !!req.body.dryRun,
        created: created.length,
        updated: updated.length,
        unchanged,
        createdNames: created.slice(0, 30),
        updatedNames: updated.slice(0, 30),
        unknownBlocks: [...unknownBlocks],
        errors: errors.slice(0, 30),
    });
});

/* ================= Cấu hình ================= */

exports.getSettings = wrap(async (req, res) => {
    res.json({ success: true, data: await catalogService.getSettings(), defaults: catalogService.DEFAULT_SETTINGS });
});

exports.updateSettings = wrap(async (req, res) => {
    res.json({ success: true, data: await catalogService.saveSettings(req.body || {}) });
});

// GET /api/admin/catalog/health → các vấn đề dữ liệu admin nên sửa
exports.getHealth = wrap(async (req, res) => {
    catalogService.invalidate();
    const c = await catalogService.load();
    const issues = [];
    const activeBlockNames = new Set(c.blocks.filter(b => b.active !== false && b.valid).map(b => b.name));
    for (const b of c.blocks) if (!b.valid) issues.push({ level: 'error', area: 'block', id: String(b._id), text: `Tổ hợp ${b.name} có môn không tồn tại` });
    for (const m of c.majors) {
        if (m.active === false) continue;
        const unknown = (m.examBlocks || []).filter(b => !c.blockByName.has(String(b).toUpperCase()));
        if (!(m.hollandGroups || []).length) issues.push({ level: 'error', area: 'major', id: String(m._id), text: `${m.name}: chưa có nhóm Holland → không bao giờ được gợi ý` });
        if (!(m.examBlocks || []).length) issues.push({ level: 'warn', area: 'major', id: String(m._id), text: `${m.name}: chưa có tổ hợp xét tuyển → không tính được học lực` });
        else if (!(m.examBlocks || []).some(b => activeBlockNames.has(String(b).toUpperCase()))) issues.push({ level: 'warn', area: 'major', id: String(m._id), text: `${m.name}: không có tổ hợp nào đang bật` });
        if (unknown.length) issues.push({ level: 'warn', area: 'major', id: String(m._id), text: `${m.name}: tổ hợp không có trong danh mục (${unknown.join(', ')})` });
    }
    const usedBlocks = new Set(c.majors.flatMap(m => (m.examBlocks || []).map(b => String(b).toUpperCase())));
    const summary = {
        subjects: c.subjects.length,
        blocks: c.blocks.length,
        blocksUsedByMajors: usedBlocks.size,
        majors: c.majors.length,
        majorsWithBenchmark: c.majors.filter(m => Number.isFinite(m.benchmarkScore)).length,
    };
    res.json({ success: true, data: { summary, issues } });
});

// POST /api/admin/recommendation/preview { hollandScores, electiveSubjects, aptitudeSubjects, scores, aspiration, settings? }
// Chạy thử bộ xếp hạng (có thể với cấu hình chưa lưu) để admin chỉnh trọng số.
exports.previewRecommendation = wrap(async (req, res) => {
    const c = await catalogService.load();
    const settings = req.body.settings ? catalogService.sanitizeSettings(req.body.settings) : c.settings;
    const result = recommend({ ...c, settings }, {
        hollandScores: req.body.hollandScores || {},
        electiveSubjects: (req.body.electiveSubjects || []).slice(0, settings.electiveCount),
        aptitudeSubjects: req.body.aptitudeSubjects || [],
        scores: req.body.scores || [],
        aspiration: req.body.aspiration || '',
    });
    res.json({ success: true, data: result });
});
