// src/controllers/questionController.js
const Question = require('../models/Question');

const TYPES = ['R', 'I', 'A', 'S', 'E', 'C'];

function cleanText(text) {
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/* ======== Public (học sinh làm bài) ======== */

exports.getQuestions = async (req, res) => {
    try {
        const data = await Question.find().sort({ id: 1 }).lean();
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

/* ======== Admin CRUD ======== */

// GET /api/admin/questions → mảng câu hỏi, sắp theo id (thứ tự hiển thị trong bài test)
exports.listQuestions = async (req, res) => {
    res.json(await Question.find().sort({ id: 1 }).lean());
};

// POST /api/admin/questions  { type, text } hoặc { type, texts: [] }  → id tự tăng
exports.createQuestions = async (req, res) => {
    const type = String(req.body.type || '').toUpperCase();
    if (!TYPES.includes(type)) return res.status(400).json({ success: false, message: 'Nhóm Holland không hợp lệ' });

    const raw = Array.isArray(req.body.texts) ? req.body.texts : [req.body.text];
    // Bỏ dòng trùng trong chính lần thêm này (không phân biệt hoa thường)
    const seen = new Set();
    const texts = raw.map(cleanText).filter(t => {
        const key = t.toLocaleLowerCase('vi');
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const tooShort = texts.find(t => t.length < 3);
    const tooLong = texts.find(t => t.length > 300);
    if (!texts.length) return res.status(400).json({ success: false, message: 'Nội dung câu hỏi trống' });
    if (tooShort || tooLong) {
        return res.status(400).json({ success: false, message: 'Mỗi câu hỏi dài từ 3 đến 300 ký tự' });
    }

    // Bỏ câu trùng nội dung trong cùng nhóm (không phân biệt hoa thường)
    const existing = await Question.find({ type }).select('text').lean();
    const keys = new Set(existing.map(q => q.text.toLocaleLowerCase('vi')));
    const fresh = texts.filter(t => !keys.has(t.toLocaleLowerCase('vi')));
    if (!fresh.length) return res.status(409).json({ success: false, message: 'Câu hỏi đã tồn tại trong nhóm này' });

    const last = await Question.findOne().sort({ id: -1 }).select('id').lean();
    let nextId = (last?.id || 0) + 1;
    const created = await Question.insertMany(fresh.map(text => ({ id: nextId++, text, type })));

    const submitted = raw.map(cleanText).filter(Boolean).length;
    res.status(201).json({ success: true, inserted: created.length, skipped: submitted - created.length, data: created });
};

// PUT /api/admin/questions/:id  { text?, type? }
exports.updateQuestion = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'id không hợp lệ' });

    const current = await Question.findOne({ id }).lean();
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy câu hỏi' });

    const update = {};
    if (req.body.text !== undefined) {
        const text = cleanText(req.body.text);
        if (text.length < 3 || text.length > 300) {
            return res.status(400).json({ success: false, message: 'Câu hỏi dài từ 3 đến 300 ký tự' });
        }
        update.text = text;
    }
    if (req.body.type !== undefined) {
        const type = String(req.body.type).toUpperCase();
        if (!TYPES.includes(type)) return res.status(400).json({ success: false, message: 'Nhóm Holland không hợp lệ' });
        if (type !== current.type && (await Question.countDocuments({ type: current.type })) <= 1) {
            return res.status(409).json({ success: false, message: 'Mỗi nhóm cần ít nhất 1 câu hỏi' });
        }
        update.type = type;
    }

    const q = await Question.findOneAndUpdate({ id }, update, { new: true, runValidators: true }).lean();
    res.json({ success: true, data: q });
};

// DELETE /api/admin/questions/:id
exports.deleteQuestion = async (req, res) => {
    const id = Number(req.params.id);
    const q = await Question.findOne({ id }).lean();
    if (!q) return res.status(404).json({ success: false, message: 'Không tìm thấy câu hỏi' });
    if ((await Question.countDocuments({ type: q.type })) <= 1) {
        return res.status(409).json({ success: false, message: 'Không thể xoá câu hỏi cuối cùng của nhóm' });
    }
    await Question.deleteOne({ id });
    res.json({ success: true });
};

// POST /api/admin/questions/import  { rows: [{ id?, type, text }], dryRun }
// Có "Mã" trùng câu đang có → cập nhật; không có mã → thêm mới (bỏ qua câu trùng nội dung trong cùng nhóm).
exports.importQuestions = async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 2000) : [];
    if (!rows.length) return res.status(400).json({ success: false, message: 'File không có dòng dữ liệu nào' });

    const existing = await Question.find().lean();
    const byId = new Map(existing.map(q => [q.id, q]));
    const keyOf = (type, text) => `${type}|${text.toLocaleLowerCase('vi')}`;
    const keys = new Set(existing.map(q => keyOf(q.type, q.text)));
    const finalType = new Map(existing.map(q => [q.id, q.type]));

    let nextId = existing.reduce((m, q) => Math.max(m, q.id), 0) + 1;
    const ops = [];
    const created = [];
    const updated = [];
    const errors = [];
    let unchanged = 0;

    rows.forEach((row, i) => {
        const line = `Dòng ${i + 2}`;
        const text = cleanText(String(row?.text ?? ''));
        const type = (String(row?.type ?? '').trim().toUpperCase().match(/^[RIASEC]/) || [])[0];
        const id = Number(String(row?.id ?? '').trim());
        const current = Number.isInteger(id) && id > 0 ? byId.get(id) : null;

        if (current) {
            const update = {};
            if (text && text !== current.text) update.text = text;
            if (type && type !== current.type) update.type = type;
            if (update.text && (update.text.length < 3 || update.text.length > 300)) return errors.push(`${line}: câu hỏi dài từ 3 đến 300 ký tự`);
            if (!Object.keys(update).length) return unchanged++;
            if (update.type) finalType.set(current.id, update.type);
            updated.push(current.id);
            ops.push({ updateOne: { filter: { id: current.id }, update: { $set: update } } });
            return;
        }
        if (!text) return errors.push(`${line}: thiếu nội dung câu hỏi`);
        if (!type) return errors.push(`${line}: nhóm phải là một trong R, I, A, S, E, C`);
        if (text.length < 3 || text.length > 300) return errors.push(`${line}: câu hỏi dài từ 3 đến 300 ký tự`);
        const key = keyOf(type, text);
        if (keys.has(key)) return unchanged++;
        keys.add(key);
        const newId = nextId++;
        finalType.set(newId, type);
        created.push(newId);
        ops.push({ insertOne: { document: { id: newId, text, type } } });
    });

    const left = new Set(finalType.values());
    const empty = TYPES.filter(t => !left.has(t));
    if (empty.length) errors.push(`Sau khi nhập, nhóm ${empty.join(', ')} sẽ không còn câu hỏi nào`);

    const ok = !empty.length;
    if (!req.body.dryRun && ok && ops.length) await Question.bulkWrite(ops, { ordered: true });
    res.json({ success: true, dryRun: !!req.body.dryRun, blocked: !ok, created: created.length, updated: updated.length, unchanged, errors: errors.slice(0, 30) });
};
