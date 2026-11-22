// src/data/catalogDefaults.js
// Dữ liệu KHỞI TẠO cho môn học, tổ hợp và cấu hình tư vấn.
// Chỉ được nạp 1 lần khi database còn trống (xem services/catalog.js). Sau đó admin chỉnh trên giao diện,
// file này không còn được đọc lại → sửa ở đây KHÔNG ảnh hưởng hệ thống đang chạy.

// [code, tên, tên ngắn, loại, nhóm năng khiếu, aliases]
const SUBJECTS = [
    ['TOAN', 'Toán', 'Toán', 'required', '', ['Toán học']],
    ['VAN', 'Ngữ văn', 'Văn', 'required', '', ['Văn', 'Văn học']],
    ['LY', 'Vật lý', 'Lý', 'elective', '', ['Lý', 'Vật lí', 'Lí']],
    ['HOA', 'Hóa học', 'Hóa', 'elective', '', ['Hóa', 'Hoá', 'Hoá học']],
    ['SINH', 'Sinh học', 'Sinh', 'elective', '', ['Sinh']],
    ['SU', 'Lịch sử', 'Sử', 'elective', '', ['Sử']],
    ['DIA', 'Địa lý', 'Địa', 'elective', '', ['Địa', 'Địa lí']],
    ['ANH', 'Tiếng Anh', 'Anh', 'elective', '', ['Anh', 'Anh văn', 'Ngoại ngữ']],
    ['GDKTPL', 'Giáo dục kinh tế và pháp luật', 'GDKT&PL', 'elective', '', ['GD Kinh tế & Pháp luật', 'GDKT&PL', 'GDCD', 'Giáo dục công dân', 'GD công dân']],
    ['TIN', 'Tin học', 'Tin', 'elective', '', ['Tin']],
    ['CNCN', 'Công nghệ công nghiệp', 'CN công nghiệp', 'elective', '', ['Công nghệ (Công nghiệp)']],
    ['CNNN', 'Công nghệ nông nghiệp', 'CN nông nghiệp', 'elective', '', ['Công nghệ (Nông nghiệp)']],
    ['VE_HH', 'Vẽ hình họa', 'Hình họa', 'aptitude', 'Mỹ thuật – Kiến trúc', ['Hình họa', 'Năng khiếu Hình họa', 'Vẽ mỹ thuật']],
    ['VE_TT', 'Vẽ trang trí màu', 'Trang trí màu', 'aptitude', 'Mỹ thuật – Kiến trúc', ['Trang trí màu', 'Bố cục màu', 'Năng khiếu Vẽ']],
    ['NK_NHAC1', 'Năng khiếu âm nhạc 1 (thẩm âm, tiết tấu)', 'Âm nhạc 1', 'aptitude', 'Âm nhạc – Sân khấu', ['Thanh nhạc 1', 'Năng khiếu âm nhạc 1']],
    ['NK_NHAC2', 'Năng khiếu âm nhạc 2 (hát, nhạc cụ)', 'Âm nhạc 2', 'aptitude', 'Âm nhạc – Sân khấu', ['Thanh nhạc 2', 'Năng khiếu âm nhạc 2']],
    ['NK_MN', 'Năng khiếu mầm non (kể chuyện, đọc diễn cảm, hát)', 'NK mầm non', 'aptitude', 'Sư phạm mầm non', ['Năng khiếu mầm non']],
    ['NK_TDTT', 'Năng khiếu thể dục thể thao', 'NK TDTT', 'aptitude', 'Thể dục thể thao', ['Năng khiếu TDTT']],
    ['NK_BC', 'Năng khiếu báo chí', 'NK báo chí', 'aptitude', 'Báo chí', ['Năng khiếu báo chí']],
];

// Tổ hợp xét tuyển phổ biến (theo chương trình 2018, áp dụng từ 2025)
const BLOCKS = {
    A00: ['TOAN', 'LY', 'HOA'], A01: ['TOAN', 'LY', 'ANH'], A02: ['TOAN', 'LY', 'SINH'], A03: ['TOAN', 'LY', 'SU'],
    A04: ['TOAN', 'LY', 'DIA'], A05: ['TOAN', 'HOA', 'SU'], A06: ['TOAN', 'HOA', 'DIA'], A07: ['TOAN', 'SU', 'DIA'],
    A08: ['TOAN', 'SU', 'GDKTPL'], A09: ['TOAN', 'DIA', 'GDKTPL'], A10: ['TOAN', 'LY', 'GDKTPL'], A11: ['TOAN', 'HOA', 'GDKTPL'],
    B00: ['TOAN', 'HOA', 'SINH'], B01: ['TOAN', 'SINH', 'SU'], B02: ['TOAN', 'SINH', 'DIA'], B03: ['TOAN', 'VAN', 'SINH'],
    B08: ['TOAN', 'SINH', 'ANH'],
    C00: ['VAN', 'SU', 'DIA'], C01: ['VAN', 'TOAN', 'LY'], C02: ['VAN', 'TOAN', 'HOA'], C03: ['VAN', 'TOAN', 'SU'],
    C04: ['VAN', 'TOAN', 'DIA'], C05: ['VAN', 'LY', 'HOA'], C06: ['VAN', 'LY', 'SINH'], C07: ['VAN', 'LY', 'SU'],
    C08: ['VAN', 'HOA', 'SINH'], C09: ['VAN', 'LY', 'DIA'], C10: ['VAN', 'HOA', 'SU'], C12: ['VAN', 'SINH', 'SU'],
    C13: ['VAN', 'SINH', 'DIA'], C14: ['VAN', 'TOAN', 'GDKTPL'], C16: ['VAN', 'LY', 'GDKTPL'], C17: ['VAN', 'HOA', 'GDKTPL'],
    C19: ['VAN', 'SU', 'GDKTPL'],
    D01: ['TOAN', 'VAN', 'ANH'], D07: ['TOAN', 'HOA', 'ANH'], D08: ['TOAN', 'SINH', 'ANH'], D09: ['TOAN', 'SU', 'ANH'],
    D10: ['TOAN', 'DIA', 'ANH'], D12: ['VAN', 'HOA', 'ANH'], D13: ['VAN', 'SINH', 'ANH'], D14: ['VAN', 'SU', 'ANH'],
    D15: ['VAN', 'DIA', 'ANH'], D66: ['VAN', 'GDKTPL', 'ANH'], D84: ['TOAN', 'GDKTPL', 'ANH'],
    X06: ['TOAN', 'LY', 'TIN'], X26: ['TOAN', 'ANH', 'TIN'],
    // Năng khiếu
    V00: ['TOAN', 'LY', 'VE_HH'], V01: ['TOAN', 'VAN', 'VE_HH'], V02: ['TOAN', 'ANH', 'VE_HH'],
    H00: ['VAN', 'VE_HH', 'VE_TT'], H01: ['TOAN', 'VAN', 'VE_HH'],
    N00: ['VAN', 'NK_NHAC1', 'NK_NHAC2'], M00: ['VAN', 'TOAN', 'NK_MN'], T00: ['TOAN', 'SINH', 'NK_TDTT'],
    R00: ['VAN', 'SU', 'NK_BC'],
};

const DEFAULT_SETTINGS = {
    // Trọng số tính độ phù hợp (tự quy về 100%; thành phần thiếu dữ liệu sẽ bị bỏ và chia lại)
    weights: { holland: 50, academic: 35, aspiration: 15 },
    // Số nhóm Holland nổi trội
    topGroups: { min: 3, max: 4 },
    // Số môn thi tốt nghiệp tự chọn học sinh phải chọn
    electiveCount: 2,
    // Điểm dùng để tính học lực: current = hiện tại, target = mục tiêu, average = trung bình 2 loại
    scoreBasis: 'current',
    // Số ngành hiển thị trong danh sách xếp hạng
    topMajorCount: 8,
    // Hiện mục "Phù hợp tính cách nhưng cần đổi môn thi / thi năng khiếu"
    showAlternatives: true,
    alternativeCount: 4,
    // Khu vực dùng trong lời khuyên AI (gợi ý trường)
    region: 'TP.HCM',
    ai: {
        majorCount: 6,             // số ngành AI phân tích
        allowExternalMajors: true, // cho AI đề xuất thêm ngành ngoài danh mục
        maxExternalMajors: 2,
    },
};

// Tên môn cũ cần bổ sung vào môn đã có trong DB (chạy 1 lần theo phiên bản, xem services/catalog.js)
const ALIAS_MIGRATIONS = {
    2: { GDKTPL: ['GD công dân'], VE_HH: ['Năng khiếu Hình họa'], VE_TT: ['Năng khiếu Vẽ'] },
};
// Gỡ alias đặt nhầm ở phiên bản trước
const ALIAS_REMOVALS = {
    2: { VE_HH: ['Năng khiếu Vẽ'] },
};

module.exports = { SUBJECTS, BLOCKS, DEFAULT_SETTINGS, ALIAS_MIGRATIONS, ALIAS_REMOVALS };
