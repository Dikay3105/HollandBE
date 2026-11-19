// src/controllers/optionController.js
const Option = require('../models/Option');
const Major = require('../models/Major');
const Student = require('../models/Student');
const defaultUniversities = require('../data/universities');

const COLLATION = { locale: 'vi', strength: 2 };

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
async function insertNames(type, names) {
    const cleaned = [...new Set(names.map(cleanName).filter(Boolean))];
    if (!cleaned.length) return 0;

    const existing = await Option.find({ type }).select('name').lean();
    const existingKeys = new Set(existing.map(o => o.name.toLocaleLowerCase('vi')));
    const maxOrder = existing.length;

    const docs = [];
    for (const name of cleaned) {
        const key = name.toLocaleLowerCase('vi');
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        docs.push({ type, name, order: maxOrder + docs.length });
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
    const inserted = await insertNames(type, names);
    if (!inserted) {
        return res.status(409).json({ success: false, message: 'Tên đã tồn tại hoặc không hợp lệ' });
    }
    res.status(201).json({ success: true, inserted });
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
    const inserted = await insertNames('major', majorNames.sort((a, b) => a.localeCompare(b, 'vi')));
    res.json({ success: true, inserted });
};

// POST /api/admin/options/import-students  { type: 'major'|'university', minCount: 3 }
// Thêm các tên học sinh đã tự nhập, xuất hiện >= minCount lần, chưa có trong danh mục
exports.importFromStudents = async (req, res) => {
    const type = parseType(req.body.type);
    if (!type) return res.status(400).json({ success: false, message: 'type không hợp lệ' });
    const minCount = Math.max(1, parseInt(req.body.minCount, 10) || 3);

    const rows = await Student.aggregate([
        { $project: { v: { $trim: { input: { $ifNull: [`$${type}`, ''] } } } } },
        { $match: { v: { $ne: '' } } },
        { $group: { _id: { $toLower: '$v' }, name: { $first: '$v' }, count: { $sum: 1 } } },
        { $match: { count: { $gte: minCount } } },
        { $sort: { count: -1 } },
    ]);
    const inserted = await insertNames(type, rows.map(r => r.name));
    res.json({ success: true, inserted, candidates: rows.length });
};

exports.seedOptionsIfEmpty = seedOptionsIfEmpty;
