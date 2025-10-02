// const OpenAI = require("openai");

// const client = new OpenAI({
//     apiKey: process.env.OPENROUTER_API_KEY,
//     baseURL: "https://openrouter.ai/api/v1",
// });

// const DEFAULT_MODEL = "qwen/qwen3-30b-a3b:free";

// /**
//  * Tạo lời khuyên hướng nghiệp từ dữ liệu học sinh và nhóm Holland, trả về HTML sẵn
//  */
// async function generateFullAdvice({ scores, topMajors, selectedBlock, hollandScores }) {
//     // Điểm số hiện tại → mục tiêu
//     const scoreText = scores.length
//         ? scores.map(s => `<li><strong>${s.subject}</strong>: ${s.currentScore} → ${s.targetScore}</li>`).join("")
//         : "<li>Chưa có dữ liệu điểm</li>";

//     // Tóm tắt nhóm Holland
//     const hollandSummary = hollandScores && Object.keys(hollandScores).length
//         ? Object.entries(hollandScores)
//             .map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`)
//             .join("")
//         : "<li>Chưa có dữ liệu Holland</li>";

//     const hollandDesc = `
// <ul>
// <li><strong>R (Realistic)</strong>: thích lao động thực tế, kỹ thuật, cơ khí.</li>
// <li><strong>I (Investigative)</strong>: ưa phân tích, nghiên cứu khoa học.</li>
// <li><strong>A (Artistic)</strong>: giàu sáng tạo, nghệ thuật, thiết kế.</li>
// <li><strong>S (Social)</strong>: giỏi giao tiếp, giúp đỡ, giảng dạy.</li>
// <li><strong>E (Enterprising)</strong>: năng động, lãnh đạo, kinh doanh.</li>
// <li><strong>C (Conventional)</strong>: cẩn thận, quản lý dữ liệu, hành chính.</li>
// </ul>
// `;

//     const prompt = `
// Bạn là chuyên gia hướng nghiệp giàu kinh nghiệm. Viết lời khuyên bằng tiếng Việt, **trả về HTML**, thông tin học sinh như sau:
// - Điểm các môn học: ${scoreText}
// - Khối thi học sinh chọn: ${selectedBlock} (theo khối thi ở Việt Nam)
// - Kết quả test holland: ${hollandSummary}
// - Các ngành nghề mà giáo viên gợi ý: ${topMajors?.join(",")}

// có định dạng các đề mục rõ ràng:

// <h2>1. Tổng quan & Cải thiện điểm</h2>
// <p>Nhận xét tổng quan về điểm hiện tại, gợi ý cách cải thiện để đạt mục tiêu.</p>

// <h2>2. Phân tích Holland</h2>
// <p>Giải thích các nhóm Holland nổi trội và vì sao các ngành gợi ý phù hợp.</p>

// <h2>3. Định hướng tiếp theo</h2>
// <p>Đưa gợi ý về chọn ngành/khối thi và phát triển kỹ năng.</p>

// <h2>4. Top 6 ngành phù hợp</h2>
// <p>Đưa ra 6 ngành nghề phù hợp nhất dựa trên điểm số hiện tại của các môn, ngành thi và phân tích holland</p>
// `;

//     try {
//         const completion = await client.chat.completions.create({
//             model: DEFAULT_MODEL,
//             messages: [
//                 { role: "system", content: "Bạn là cố vấn hướng nghiệp giàu kinh nghiệm, trả lời bằng tiếng Việt, HTML sẵn, dễ render trên web." },
//                 { role: "user", content: prompt },
//             ],
//         });

//         return completion.choices[0].message.content.trim();
//     } catch (err) {
//         console.error("AI error:", err.message);
//         return null;
//     }
// }

// module.exports = { generateFullAdvice };

const OpenAI = require("openai");
const dayjs = require("dayjs");


// Gom 4 key vào mảng, lấy từ .env
const API_KEYS = [
    process.env.OPENROUTER_API_KEY_1,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
    process.env.OPENROUTER_API_KEY_4,
    process.env.OPENROUTER_API_KEY_5,
    process.env.OPENROUTER_API_KEY_6,
    process.env.OPENROUTER_API_KEY_7,
    process.env.OPENROUTER_API_KEY_8,
    process.env.OPENROUTER_API_KEY_9,
    process.env.OPENROUTER_API_KEY_10,
    process.env.OPENROUTER_API_KEY_11,
    process.env.OPENROUTER_API_KEY_12,
    process.env.OPENROUTER_API_KEY_13,
    process.env.OPENROUTER_API_KEY_14,
];

const MODEL = "qwen/qwen3-14b:free";

let exhaustedKeys = [];

// Hàm kiểm tra key còn dùng được không
function isKeyAvailable(key) {
    const today = dayjs().format("YYYY-MM-DD");
    exhaustedKeys = exhaustedKeys.filter(k => k.date === today); // loại bỏ key của ngày cũ
    return !exhaustedKeys.find(k => k.key === key);
}

// Đánh dấu key hết quota
function markKeyExhausted(key) {
    exhaustedKeys.push({ key, date: dayjs().format("YYYY-MM-DD") });
}

/**
 * Gọi OpenRouter bằng key cụ thể
 */
async function callWithKey(apiKey, messages) {
    const client = new OpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
    });
    const res = await client.chat.completions.create({
        model: MODEL,
        messages,
    });
    return res.choices[0].message.content.trim();
}

/**
 * Tạo lời khuyên hướng nghiệp từ dữ liệu học sinh và nhóm Holland, trả về HTML
 */
async function generateFullAdvice({ scores, topMajors, selectedBlock, hollandScores }) {
    const scoreText = scores.length
        ? scores.map(s => `<li><strong>${s.subject}</strong>: ${s.currentScore} → ${s.targetScore}</li>`).join("")
        : "<li>Chưa có dữ liệu điểm</li>";

    const hollandSummary = hollandScores && Object.keys(hollandScores).length
        ? Object.entries(hollandScores)
            .map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`)
            .join("")
        : "<li>Chưa có dữ liệu Holland</li>";

    const prompt = `
Bạn là chuyên gia hướng nghiệp giàu kinh nghiệm. Viết lời khuyên bằng TIẾNG VIỆT, tối đa 450 từ, không dài hơn 1 trang A4, **trả về HTML**.
Trước tiên, cần biết quy ước khối thi ở Việt Nam (2025) như sau:

- Khối A (khoa học tự nhiên):  
  A00: Toán, Lý, Hóa  
  A01: Toán, Lý, Anh  
  A02: Toán, Lý, Sinh  
  A03: Toán, Lý, Sử  
  A04: Toán, Lý, Địa  
  A05: Toán, Hóa, Sử  
  A06: Toán, Hóa, Địa  
  A07: Toán, Sử, Địa  
  A08: Toán, Sử, Giáo dục kinh tế và pháp luật  
  A09: Toán, Địa, Giáo dục kinh tế và pháp luật  
  A10: Toán, Lý, Giáo dục kinh tế và pháp luật  
  A11: Toán, Hóa, Giáo dục kinh tế và pháp luật  

- Khối B (Y Dược, Sinh học, Nông – Lâm – Ngư nghiệp):  
  B00: Toán, Hóa, Sinh  
  B01: Toán, Lịch sử, Sinh  
  B02: Toán, Địa, Sinh  
  B03: Toán, Văn, Sinh  
  B08: Toán, Anh, Sinh  

- Khối C (ngôn ngữ, xã hội, nhân văn):  
  C00: Văn, Sử, Địa  
  C01: Văn, Toán, Lý  
  C02: Văn, Toán, Hóa  
  C03: Văn, Toán, Sử  
  C04: Văn, Toán, Địa  
  C05: Văn, Lý, Hóa  
  C06: Văn, Lý, Sinh  
  C07: Văn, Lý, Sử  
  C08: Văn, Hóa, Sinh  
  C09: Văn, Lý, Địa  
  C10: Văn, Hóa, Sử  
  C12: Văn, Sinh, Sử  
  C13: Văn, Sinh, Địa  
  C14: Văn, Toán, Giáo dục kinh tế và pháp luật  
  C16: Văn, Lý, Giáo dục kinh tế và pháp luật  
  C17: Văn, Hóa, Giáo dục kinh tế và pháp luật  
  C19: Văn, Sử, Giáo dục kinh tế và pháp luật  

- Khối D (ngoại ngữ, thương mại, truyền thông):  
  D01: Toán, Văn, Anh  
  D07: Toán, Hóa, Anh  
  D08: Toán, Sinh, Anh  
  D09: Toán, Anh, Sử  
  D10: Toán, Địa, Anh  
  D12: Văn, Hóa, Anh  
  D13: Văn, Sinh, Anh  
  D14: Văn, Sử, Anh  
  D15: Văn, Địa, Anh  
  D66: Văn, Giáo dục kinh tế và pháp luật, Anh  
  D84: Toán, Giáo dục kinh tế và pháp luật, Anh  

Ngoài ra, đây là mô tả 6 nhóm Holland (RIASEC):  
<ul>
<li><strong>R (Realistic)</strong>: thích lao động thực tế, kỹ thuật, cơ khí.</li>
<li><strong>I (Investigative)</strong>: ưa phân tích, nghiên cứu khoa học.</li>
<li><strong>A (Artistic)</strong>: giàu sáng tạo, nghệ thuật, thiết kế.</li>
<li><strong>S (Social)</strong>: giỏi giao tiếp, giúp đỡ, giảng dạy.</li>
<li><strong>E (Enterprising)</strong>: năng động, lãnh đạo, kinh doanh.</li>
<li><strong>C (Conventional)</strong>: cẩn thận, quản lý dữ liệu, hành chính.</li>
</ul>

Thông tin học sinh như sau:
- Điểm các môn học: ${scoreText}
- Khối thi học sinh chọn: ${selectedBlock} (theo khối thi ở Việt Nam)
- Kết quả test holland: ${hollandSummary}
- Các ngành nghề mà giáo viên gợi ý: ${topMajors?.name?.join(",")}

có định dạng các đề mục rõ ràng:

<h2>1. Tổng quan & Cải thiện điểm</h2>
<p>Nhận xét tổng quan về điểm hiện tại, gợi ý cách cải thiện để đạt điểm mục tiêu.</p>

<h2>2. Phân tích Holland</h2>
<p>Giải thích các nhóm Holland nổi trội và vì sao các ngành gợi ý phù hợp.</p>

<h2>3. Định hướng tiếp theo</h2>
<p>Đưa gợi ý về chọn ngành/khối thi và phát triển kỹ năng</p>

<h2>4. Top 6 ngành phù hợp</h2>
<p>Đưa ra 6 ngành nghề phù hợp nhất dựa trên điểm số HIỆN TẠI(không phải điểm mục tiêu) của các môn, ngành thi, khối thi mà học sinh đã chọn và phân tích holland</p>
`;

    const messages = [
        { role: "system", content: "Bạn là cố vấn hướng nghiệp giàu kinh nghiệm, trả lời bằng tiếng Việt, HTML sẵn, dễ render trên web." },
        { role: "user", content: prompt },
    ];

    // Thử lần lượt từng key cho tới khi thành công hoặc hết key
    for (const key of API_KEYS) {
        if (!key || !isKeyAvailable(key)) continue;
        try {
            console.log(`Gọi model bằng key: ${key.slice(0, 6)}...`);
            const result = await callWithKey(key, messages);
            return result;
        } catch (err) {
            console.error(`Key ${key.slice(0, 6)}... lỗi:`, err.message);
            // Nếu 429 hoặc lỗi khác -> thử key tiếp theo
            // Nếu lỗi quota, đánh dấu hết hạn trong ngày
            if (err.message.includes("429")) {
                markKeyExhausted(key);
            }
            continue;
        }
    }

    // Nếu không key nào dùng được
    console.error("Tất cả key đều đã hết quota hoặc gặp lỗi.");
    return null;
}

module.exports = { generateFullAdvice };
