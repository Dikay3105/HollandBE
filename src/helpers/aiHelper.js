const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

const DEFAULT_MODEL = "qwen/qwen3-30b-a3b:free";

/**
 * Tạo lời khuyên hướng nghiệp từ dữ liệu học sinh và nhóm Holland, trả về HTML sẵn
 */
async function generateFullAdvice({ scores, topMajors, selectedBlock, hollandScores }) {
    // Điểm số hiện tại → mục tiêu
    const scoreText = scores.length
        ? scores.map(s => `<li><strong>${s.subject}</strong>: ${s.currentScore} → ${s.targetScore}</li>`).join("")
        : "<li>Chưa có dữ liệu điểm</li>";

    // Tóm tắt nhóm Holland
    const hollandSummary = hollandScores && Object.keys(hollandScores).length
        ? Object.entries(hollandScores)
            .map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`)
            .join("")
        : "<li>Chưa có dữ liệu Holland</li>";

    const hollandDesc = `
<ul>
<li><strong>R (Realistic)</strong>: thích lao động thực tế, kỹ thuật, cơ khí.</li>
<li><strong>I (Investigative)</strong>: ưa phân tích, nghiên cứu khoa học.</li>
<li><strong>A (Artistic)</strong>: giàu sáng tạo, nghệ thuật, thiết kế.</li>
<li><strong>S (Social)</strong>: giỏi giao tiếp, giúp đỡ, giảng dạy.</li>
<li><strong>E (Enterprising)</strong>: năng động, lãnh đạo, kinh doanh.</li>
<li><strong>C (Conventional)</strong>: cẩn thận, quản lý dữ liệu, hành chính.</li>
</ul>
`;

    const prompt = `
Bạn là chuyên gia hướng nghiệp giàu kinh nghiệm. Viết lời khuyên bằng tiếng Việt, **trả về HTML**, thông tin học sinh như sau:
- Điểm các môn học: ${scoreText}
- Khối thi học sinh chọn: ${selectedBlock} (theo khối thi ở Việt Nam)
- Kết quả test holland: ${hollandSummary}
- Các ngành nghề mà giáo viên gợi ý: ${topMajors?.join(",")}

có định dạng các đề mục rõ ràng:

<h2>1. Tổng quan & Cải thiện điểm</h2>
<p>Nhận xét tổng quan về điểm hiện tại, gợi ý cách cải thiện để đạt mục tiêu.</p>

<h2>2. Phân tích Holland</h2>
<p>Giải thích các nhóm Holland nổi trội và vì sao các ngành gợi ý phù hợp.</p>

<h2>3. Định hướng tiếp theo</h2>
<p>Đưa gợi ý về chọn ngành/khối thi và phát triển kỹ năng.</p>

<h2>4. Top 6 ngành phù hợp</h2>
<p>Đưa ra 6 ngành nghề phù hợp nhất dựa trên điểm số hiện tại của các môn, ngành thi và phân tích holland</p>
`;

    try {
        const completion = await client.chat.completions.create({
            model: DEFAULT_MODEL,
            messages: [
                { role: "system", content: "Bạn là cố vấn hướng nghiệp giàu kinh nghiệm, trả lời bằng tiếng Việt, HTML sẵn, dễ render trên web." },
                { role: "user", content: prompt },
            ],
        });

        return completion.choices[0].message.content.trim();
    } catch (err) {
        console.error("AI error:", err.message);
        return null;
    }
}

module.exports = { generateFullAdvice };
