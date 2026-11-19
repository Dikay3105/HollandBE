// src/utils/fields.js
// Phân loại tên ngành / tên trường học sinh tự ghi vào nhóm lớn để thống kê.
// So khớp theo từ khoá đã bỏ dấu, theo từng cụm từ (không khớp nửa từ). Thứ tự quy tắc quan trọng:
// quy tắc cụ thể đứng trước (VD "an ninh mạng" → CNTT trước khi "an ninh" → Luật – Công an).

function plain(s) {
    return ` ${String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()} `
        // "kĩ sư / kĩ thuật / tâm lí" (i ngắn) → cùng cách viết với "kỹ / lý"
        .replace(/ ki /g, ' ky ')
        .replace(/ li( |$)/g, ' ly ');
}

const has = (text, words) => words.some(w => text.includes(` ${w} `));

const UNKNOWN = ['chua', 'khong', 'chua biet', 'khong biet', 'chua co', 'chua chon', 'chua xac dinh', 'chua ro', 'bi mat', 'tuy', 'ko', 'k'];

const MAJOR_FIELDS = [
    ['CNTT – Dữ liệu', ['cong nghe thong tin', 'cntt', 'it', 'phan mem', 'khoa hoc may tinh', 'ky thuat may tinh', 'an ninh mang',
        'an toan thong tin', 'bao mat', 'tri tue nhan tao', 'ai', 'khoa hoc du lieu', 'du lieu', 'he thong thong tin', 'lap trinh',
        'thiet ke game', 'game', 'mang may tinh', 'ky su phan mem', 'thuong mai dien tu', 'cong nghe so', 'vi tinh', 'khoa hoc vi tinh']],
    ['Y – Dược – Sức khỏe', ['y', 'y khoa', 'y da khoa', 'bac si', 'duoc', 'duoc hoc', 'y duoc', 'dieu duong', 'rang ham mat', 'nha khoa',
        'y te', 'y te cong cong', 'ho sinh', 'xet nghiem', 'ky thuat y hoc', 'thu y', 'dinh duong', 'vat ly tri lieu', 'phuc hoi chuc nang',
        'y hoc co truyen', 'gay me', 'da khoa', 'rhm']],
    ['Kinh tế – Kinh doanh', ['kinh te', 'kinh doanh', 'quan tri', 'marketing', 'tai chinh', 'ngan hang', 'ke toan', 'kiem toan', 'logistic',
        'logistics', 'chuoi cung ung', 'xuat nhap khau', 'thuong mai', 'bat dong san', 'nhan su', 'khoi nghiep', 'dau tu', 'chung khoan', 'fintech',
        'makerting', 'maketing', 'marketinh', 'digital marketing', 'thue', 'quan ly', 'quan ly cong nghiep']],
    ['Ngôn ngữ', ['ngon ngu', 'ngoai ngu', 'tieng anh', 'anh van', 'tieng han', 'tieng nhat', 'tieng trung', 'han quoc hoc', 'nhat ban hoc',
        'phien dich', 'bien dich', 'su pham anh']],
    ['Sư phạm – Giáo dục', ['su pham', 'giao vien', 'giao duc', 'mam non', 'giang vien', 'tieu hoc']],
    ['Luật – Công an – Quân đội', ['luat', 'luat su', 'cong an', 'quan doi', 'canh sat', 'an ninh', 'bo doi', 'si quan', 'phong chay', 'hai quan',
        'hanh chinh', 'chinh tri', 'quan ly nha nuoc', 'toa an', 'tham phan', 'hinh su']],
    ['Báo chí – Truyền thông', ['bao chi', 'truyen thong', 'quan he cong chung', 'pr', 'mc', 'quang cao', 'xuat ban', 'phong vien', 'bien tap',
        'truyen thong da phuong tien', 'social media', 'to chuc su kien', 'su kien']],
    ['Nghệ thuật – Thiết kế', ['thiet ke', 'do hoa', 'my thuat', 'thoi trang', 'noi that', 'nhiep anh', 'dien anh', 'am nhac', 'thanh nhac',
        'dien vien', 'dao dien', 'hoi hoa', 'nghe thuat', 'mua', 'san khau', 'animation', 'hoat hinh', 've', 'piano', 'photoshop']],
    ['Du lịch – Nhà hàng – Khách sạn', ['du lich', 'khach san', 'nha hang', 'lu hanh', 'am thuc', 'huong dan vien', 'tiep vien', 'bartender', 'batender', 'pha che']],
    ['Kỹ thuật – Xây dựng', ['ky thuat', 'ky su', 'co khi', 'dien', 'dien tu', 'tu dong hoa', 'o to', 'oto', 'xay dung', 'kien truc', 'co dien tu',
        'robot', 'vat lieu', 'moi truong', 'hang hai', 'dau khi', 'dia chat', 'quy hoach', 'giao thong', 'hoa hoc', 'cong nghe',
        'ban dan', 'chip', 'vi mach', 'che tao may', 'hang khong', 'phi cong', 'khong luu', 'may bay']],
    ['Khoa học xã hội – Nhân văn', ['tam ly', 'tam ly hoc', 'tam ly ly', 'xa hoi hoc', 'cong tac xa hoi', 'lich su', 'van hoc', 'quan he quoc te', 'dong phuong hoc',
        'nhan hoc', 'triet hoc', 'dia ly', 'viet nam hoc', 'thu vien', 'luu tru']],
    ['Khoa học tự nhiên', ['toan', 'toan hoc', 'vat ly', 'sinh hoc', 'cong nghe sinh hoc', 'thong ke', 'khoa hoc tu nhien', 'nong nghiep', 'thuc pham',
        'cong nghe thuc pham', 'thuy san', 'lam nghiep']],
    ['Thể thao', ['the thao', 'the duc', 'huan luyen vien', 'giao duc the chat']],
];

/** Lĩnh vực của 1 tên ngành; '' nếu trống, 'Chưa xác định' nếu là câu trả lời kiểu "chưa biết" */
function majorField(name) {
    const t = plain(name);
    if (!t.trim()) return '';
    if (UNKNOWN.includes(t.trim())) return 'Chưa xác định';
    for (const [field, words] of MAJOR_FIELDS) if (has(t, words)) return field;
    return 'Khác';
}

/**
 * Nhóm trường mong muốn: ĐHQG-HCM / Công lập khác / Tư thục – Quốc tế / Học viện / Quân đội – Công an / Cao đẳng / Du học.
 * Nhận diện theo tên (danh sách trường phổ biến ở TP.HCM); trường đại học không nhận ra → "Công lập khác".
 */
const VNUHCM = ['dai hoc quoc gia', 'dh quoc gia', 'dhqg', 'bach khoa', 'khoa hoc tu nhien', 'khoa hoc xa hoi va nhan van', 'nhan van', 'kinh te luat',
    'khoa hoc suc khoe', 'khoa y dhqg', 'cong nghe thong tin', 'uit', 'hcmus', 'hcmut', 'uel', 'ussh'];
const PRIVATE = ['van lang', 'hutech', 'cong nghe tp hcm', 'cong nghe tphcm', 'hoa sen', 'fpt', 'rmit', 'nguyen tat thanh', 'hong bang', 'van hien',
    'kinh te tai chinh', 'uef', 'gia dinh', 'hung vuong', 'lac hong', 'huflit', 'ngoai ngu tin hoc', 'fulbright', 'quoc te sai gon', 'quoc te mien dong',
    'tan tao', 'binh duong', 'duy tan', 'swinburne', 'greenwich', 'buv', 'vinuni', 'western sydney', 'van hoa nghe thuat quan doi', 'hoa binh', 'thu dau mot',
    'cong nghe sai gon', 'kinh te cong nghiep long an', 'quang trung', 'anh quoc viet nam', 'yersin', 'tay do', 'ky thuat cong nghe can tho'];

function universityType(name) {
    const t = plain(name);
    if (!t.trim()) return '';
    if (UNKNOWN.includes(t.trim())) return 'Chưa xác định';
    if (has(t, ['si quan', 'quan doi', 'cong an', 'canh sat', 'bien phong', 'an ninh nhan dan', 'luc quan', 'phong khong', 'ky thuat quan su', 'quan y']))
        return 'Quân đội – Công an';
    const isLocalSchool = has(t, ['dai hoc', 'truong dai hoc', 'hoc vien', 'cao dang', 'dh', 'tphcm', 'tp hcm', 'ha noi', 'da nang']);
    if (has(t, ['du hoc', 'nuoc ngoai']) ||
        (!isLocalSchool && has(t, ['my', 'uc', 'anh', 'anh quoc', 'nhat', 'nhat ban', 'han', 'han quoc', 'singapore', 'canada', 'duc', 'phap', 'dai loan', 'trung quoc'])))
        return 'Du học';
    if (has(t, ['cao dang'])) return 'Cao đẳng';
    if (has(t, ['hoc vien', 'nhac vien'])) return 'Học viện';
    if (has(t, PRIVATE)) return 'Tư thục – Quốc tế';
    if (has(t, ['ha noi']) && has(t, ['bach khoa'])) return 'Công lập khác'; // Bách khoa Hà Nội
    if (has(t, VNUHCM)) return 'ĐHQG-HCM';
    if (has(t, ['dai hoc', 'dh', 'truong', 'university', 'khoa y'])) return 'Công lập khác';
    return 'Khác';
}

module.exports = { majorField, universityType, MAJOR_FIELD_NAMES: MAJOR_FIELDS.map(f => f[0]) };
