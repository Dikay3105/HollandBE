// src/utils/schoolYear.js
// Nguồn duy nhất để tính niên khoá. Đổi mốc chỉ cần sửa SCHOOL_YEAR_START_MONTH.

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const SCHOOL_YEAR_START_MONTH = 8; // từ tháng 8 trở đi tính là năm học mới

/** Năm và tháng theo giờ Việt Nam (không phụ thuộc múi giờ của server, VD Render chạy UTC). */
function vnYearMonth(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric' })
        .formatToParts(date);
    return {
        year: Number(parts.find(p => p.type === 'year').value),
        month: Number(parts.find(p => p.type === 'month').value),
    };
}

/** Niên khoá dạng "2025-2026" tại thời điểm `date` (mặc định: bây giờ). */
function getSchoolYear(date = new Date()) {
    const { year, month } = vnYearMonth(date);
    const start = month >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
    return `${start}-${start + 1}`;
}

/** Chuẩn hoá giá trị niên khoá: "2025" (dữ liệu cũ) → "2025-2026"; sai định dạng → null. */
function normalizeSchoolYear(value) {
    const s = String(value ?? '').trim();
    if (/^\d{4}$/.test(s)) return `${s}-${Number(s) + 1}`;
    const m = s.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}`;
    return null;
}

module.exports = { getSchoolYear, normalizeSchoolYear, vnYearMonth, TIME_ZONE, SCHOOL_YEAR_START_MONTH };
