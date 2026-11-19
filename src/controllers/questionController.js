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
