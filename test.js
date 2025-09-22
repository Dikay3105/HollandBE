const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Đường dẫn tới file Excel (đặt file .xlsx trong thư mục gốc dự án)
const excelPath = path.join(__dirname, './holland_khoi_nganh_mapping_20combos.xlsx');

const wb = xlsx.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet);

// Giả định các cột trong Excel tên là:
// ID | Name | Description | ExamBlocks | HollandTypes
// Sửa lại nếu tên cột khác.
const majors = rows.map((r, i) => ({
    id: r.ID || `M${i + 1}`,
    name: r.Name,
    description: r.Description || '',
    examBlocks: String(r.ExamBlocks || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    hollandTypes: String(r.HollandTypes || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean) // giữ nguyên 3 nhóm Holland trở lên
}));

fs.writeFileSync(
    path.join(__dirname, './majors_from_excel.json'),
    JSON.stringify(majors, null, 2),
    'utf8'
);

console.log(`✅ Đã tạo majors_from_excel.json với ${majors.length} ngành`);
