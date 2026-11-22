// src/controllers/optionController.js
const Option = require('../models/Option');
const Major = require('../models/Major');
const Student = require('../models/Student');
const defaultUniversities = require('../data/universities');

const crypto = require('crypto');

const COLLATION = { locale: 'vi', strength: 2 };

/**
 * Khoá so trùng "mềm": bỏ dấu, chữ thường, bỏ ký tự phân cách → "Tài chính - ngân hàng" ≡ "Tài chính – Ngân hàng",
 * "Công Nghệ Thông Tin" ≡ "công nghệ thông tin".
 */
function matchKey(s) {
    return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Câu trả lời không phải tên ngành/trường
const JUNK = /^(chua|khong|ko|k|chua biet|khong biet|chua co|chua chon|chua xac dinh|chua nghi|chua ro|bi mat|tuy|gi cung duoc|khong co|none|no|x+|\.+|-+|\?+)$/;

/** Viết hoa chữ cái đầu nếu học sinh gõ toàn chữ thường / toàn chữ hoa ("công an" → "Công an") */
function tidyCase(name) {
    const s = cleanName(name);
    if (s === s.toLocaleLowerCase('vi') || (s === s.toLocaleUpperCase('vi') && s.length > 4)) {
        const lower = s.toLocaleLowerCase('vi');
        return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
    }
    return s;
}

function parseType(raw) {
    return Option.TYPES.includes(raw) ? raw : null;
}

function cleanName(name) {
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 150) : '';
}

/**
 * Thêm nhiều tên, bỏ qua tên đã tồn tại (không phân biệt hoa thường).
 * Trả về số bản ghi thêm mới.
 */
async function insertNames(type, names, batchId) {
    const cleaned = [...new Set(names.map(cleanName).filter(Boolean))];
    if (!cleaned.length) return 0;

    const existing = await Option.find({ type }).select('name').lean();
    const existingKeys = new Set(existing.map(o => matchKey(o.name)));
    const maxOrder = existing.length;

    const docs = [];
    for (const name of cleaned) {
        const key = matchKey(name);
        if (!key || existingKeys.has(key)) continue;
        existingKeys.add(key);
        docs.push({ type, name, order: maxOrder + docs.length, ...(batchId ? { batchId } : {}) });
    }
    if (!docs.length) return 0;
    await Option.insertMany(docs, { ordered: false });
    return docs.length;
}

/** Seed lần đầu: trường từ danh sách mặc định, ngành từ collection Major hiện có. */
async function seedOptionsIfEmpty() {
    try {
        if (!(await Option.exists({ type: 'university' }))) {
            const n = await insertNames('university', defaultUniversities);
            console.log(`🌱 Seed ${n} trường đại học`);
        }
        if (!(await Option.exists({ type: 'major' }))) {
            const majorNames = await Major.distinct('name');
            const n = await insertNames('major', majorNames.sort((a, b) => a.localeCompare(b, 'vi')));
            console.log(`🌱 Seed ${n} ngành học mong muốn`);
        }
    } catch (err) {
        console.error('Seed options error:', err.message);
    }
}

/* ======== Public ======== */

// GET /api/options?type=university|major  → chỉ trả về tên đang active
exports.getPublicOptions = async (req, res) => {
    const type = parseType(req.query.type);
    const filter = { active: true };
    if (type) filter.type = type;

    const options = await Option.find(filter)
        .collation(COLLATION)
        .sort({ order: 1, name: 1 })
        .select('type name -_id')
        .lean();

    if (type) return res.json({ success: true, data: options.map(o => o.name) });

    res.json({
        success: true,
        data: {
            universities: options.filter(o => o.type === 'university').map(o => o.name),
            majors: options.filter(o => o.type === 'major').map(o => o.name),
        },
    });
};

/* ======== Admin ======== */

// GET /api/admin/options?type=
exports.listOptions = async (req, res) => {
    const type = parseType(req.query.type);
    if (!type) return res.status(400).json({ success: false, message: 'type không hợp lệ' });

    const options = await Option.find({ type }).collation(COLLATION).sort({ order: 1, name: 1 }).lean();
    res.json({ success: true, data: options });
};

// POST /api/admin/options  { type, name } hoặc { type, names: [] }
exports.createOptions = async (req, res) => {
    const type = parseType(req.body.type);
    if (!type) return res.status(400).json({ success: false, message: 'type không hợp lệ' });

    const names = Array.isArray(req.body.names) ? req.body.names : [req.body.name];
    const batchId = crypto.randomUUID();
    const inserted = await insertNames(type, names, batchId);
    if (!inserted) {
        return res.status(409).json({ success: false, message: 'Tên đã tồn tại hoặc không hợp lệ' });
    }
    res.status(201).json({ success: true, inserted, batchId });
};

// PUT /api/admin/options/:id  { name?, active?, order? }
exports.updateOption = async (req, res) => {
    const update = {};
    if (req.body.name !== undefined) {
        const name = cleanName(req.body.name);
        if (!name) return res.status(400).json({ success: false, message: 'Tên không được để trống' });
        update.name = name;
    }
    if (typeof req.body.active === 'boolean') update.active = req.body.active;
    if (Number.isFinite(req.body.order)) update.order = req.body.order;

    try {
        const option = await Option.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (!option) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        res.json({ success: true, data: option });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: 'Tên đã tồn tại' });
        }
        throw err;
    }
};

// DELETE /api/admin/options/:id
exports.deleteOption = async (req, res) => {
    const option = await Option.findByIdAndDelete(req.params.id);
    if (!option) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true });
};

// POST /api/admin/options/import-majors → thêm các ngành trong collection Major chưa có
exports.importFromMajors = async (req, res) => {
    const majorNames = await Major.distinct('name');
    const batchId = crypto.randomUUID();
    const inserted = await insertNames('major', majorNames.sort((a, b) => a.localeCompare(b, 'vi')), batchId);
    res.json({ success: true, inserted, batchId });
};

// GET /api/admin/options/import-students/preview?type=major&minCount=3
// Gợi ý tên học sinh đã tự nhập: gộp cách viết khác nhau (hoa/thường, dấu, gạch nối), bỏ câu trả lời rác
// và tên đã có trong danh mục. Admin chọn rồi mới thêm (không thêm thẳng như trước).
exports.previewFromStudents = async (req, res) => {
    const type = parseType(req.query.type);
    if (!type) return res.status(400).json({ success: false, message: 'type không hợp lệ' });
    const minCount = Math.max(1, parseInt(req.query.minCount, 10) || 3);

    const [students, existing] = await Promise.all([
        Student.find({ [type]: { $nin: [null, ''] } }).select(type).lean(),
        Option.find({ type }).select('name').lean(),
    ]);
    const existingKeys = new Set(existing.map(o => matchKey(o.name)));

    const groups = new Map(); // key -> { count, spellings: Map }
    for (const s of students) {
        const raw = cleanName(s[type]);
        const key = matchKey(raw);
        if (!key || key.length < 2 || JUNK.test(key)) continue;
        if (!groups.has(key)) groups.set(key, { count: 0, spellings: new Map() });
        const g = groups.get(key);
        g.count++;
        g.spellings.set(raw, (g.spellings.get(raw) || 0) + 1);
    }

    const candidates = [...groups.entries()]
        .filter(([key, g]) => g.count >= minCount && !existingKeys.has(key))
        .map(([, g]) => {
            const spellings = [...g.spellings.entries()].sort((x, y) => y[1] - x[1]);
            return {
                name: tidyCase(spellings[0][0]),           // cách viết phổ biến nhất, sửa hoa/thường
                count: g.count,
                variants: spellings.slice(0, 4).map(([v]) => v),
            };
        })
        .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'vi'));

    res.json({ success: true, data: candidates, minCount });
};

// DELETE /api/admin/options/batch/:batchId → hoàn tác 1 lần thêm/nhập
exports.undoBatch = async (req, res) => {
    const batchId = String(req.params.batchId || '');
    if (!/^[0-9a-f-]{36}$/.test(batchId)) return res.status(400).json({ success: false, message: 'batchId không hợp lệ' });
    const r = await Option.deleteMany({ batchId });
    res.json({ success: true, deleted: r.deletedCount });
};

// POST /api/admin/options/bulk-delete { ids: [] }
exports.bulkDelete = async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(id => /^[a-f0-9]{24}$/.test(id));
    if (!ids.length) return res.status(400).json({ success: false, message: 'Chưa chọn mục nào' });
    const r = await Option.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: r.deletedCount });
};

exports.seedOptionsIfEmpty = seedOptionsIfEmpty;

// POST /api/admin/options/import  { type, rows: [{ name, active?, order? }], dryRun }
// Khớp tên "mềm" (không dấu, không phân biệt hoa thường) → cập nhật hiển thị/thứ tự; tên mới → thêm (hoàn tác được).
exports.importOptions = async (req, res) => {
    const type = parseType(req.body.type);
    if (!type) return res.status(400).json({ success: false, message: 'type không hợp lệ' });
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ success: false, message: 'File không có dòng dữ liệu nào' });

    const existing = await Option.find({ type }).lean();
    const byKey = new Map(existing.map(o => [matchKey(o.name), o]));
    const batchId = crypto.randomUUID();
    const ops = [];
    const createdNames = [];
    const errors = [];
    let updated = 0;
    let unchanged = 0;
    let order = existing.length;

    rows.forEach((row, i) => {
        const name = cleanName(String(row?.name ?? ''));
        const key = matchKey(name);
        if (!key) return errors.push(`Dòng ${i + 2}: thiếu tên`);
        const active = typeof row.active === 'boolean' ? row.active : undefined;
        const ord = row.order === undefined || row.order === '' ? undefined : Number(row.order);
        if (ord !== undefined && !Number.isFinite(ord)) return errors.push(`Dòng ${i + 2}: thứ tự phải là số`);

        const found = byKey.get(key);
        if (found) {
            const set = {};
            if (active !== undefined && active !== found.active) set.active = active;
            if (ord !== undefined && ord !== found.order) set.order = ord;
            if (!found._id || !Object.keys(set).length) return unchanged++; // !found._id: trùng dòng trước trong file
            updated++;
            ops.push({ updateOne: { filter: { _id: found._id }, update: { $set: set } } });
            return;
        }
        const doc = { type, name, order: ord ?? order++, active: active ?? true, batchId };
        byKey.set(key, doc);
        createdNames.push(name);
        ops.push({ insertOne: { document: doc } });
    });

    if (!req.body.dryRun && ops.length) await Option.bulkWrite(ops, { ordered: false });
    res.json({
        success: true,
        dryRun: !!req.body.dryRun,
        created: createdNames.length,
        updated,
        unchanged,
        createdNames: createdNames.slice(0, 30),
        errors: errors.slice(0, 30),
        batchId: createdNames.length ? batchId : null,
    });
};
