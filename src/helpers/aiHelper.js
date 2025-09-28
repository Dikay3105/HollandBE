const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

const DEFAULT_MODEL = "qwen/qwen3-30b-a3b:free";

async function generateFullAdvice({ scores, topMajors, selectedBlock, hollandScores }) {
    // điểm số hiện tại → mục tiêu
    const scoreText = scores.length
        ? scores.map(s => `• ${s.subject}: ${s.currentScore} → ${s.targetScore}`).join("\n")
        : "• Chưa có dữ liệu điểm";

    // tóm tắt nhóm Holland (ghi điểm kèm giải thích ngắn)
    const hollandSummary = hollandScores && Object.keys(hollandScores).length
        ? Object.entries(hollandScores).map(([k, v]) => `• ${k}: ${v}`).join("\n")
        : "• Chưa có dữ liệu Holland";

    const hollandDesc = `
**Giải thích 6 nhóm Holland**  
- **R (Realistic)**: thích lao động thực tế, kỹ thuật, cơ khí.  
- **I (Investigative)**: ưa phân tích, nghiên cứu khoa học.  
- **A (Artistic)**: giàu sáng tạo, nghệ thuật, thiết kế.  
- **S (Social)**: giỏi giao tiếp, giúp đỡ, giảng dạy.  
- **E (Enterprising)**: năng động, lãnh đạo, kinh doanh.  
- **C (Conventional)**: cẩn thận, quản lý dữ liệu, hành chính.
`;

    const prompt = `
Bạn là chuyên gia hướng nghiệp.

### Dữ liệu học sinh
- **Điểm hiện tại → mục tiêu:**  
${scoreText}
- **Ngành gợi ý hàng đầu:** ${topMajors?.join(", ") || "Chưa có"}
- **Khối thi:** ${selectedBlock || "Chưa chọn"}
- **Điểm Holland:**  
${hollandSummary}

${hollandDesc}

**Yêu cầu**: Viết **khoảng 120–150 chữ tiếng Việt**, định dạng Markdown rõ ràng với các mục sau:

1. Tổng quan & Cải thiện điểm  
Nhận xét mức điểm hiện tại so với mục tiêu, đề xuất cách nâng điểm.

2. Phân tích Holland  
Nêu nhóm Holland nổi trội (dựa trên điểm cao) và giải thích vì sao các ngành đã gợi ý phù hợp.

3. Định hướng tiếp theo  
Đưa gợi ý về chọn ngành/khối thi và phát triển kỹ năng.

4. Top 6 ngành phù hợp  
Liệt kê rõ ràng danh sách 6 ngành nghề đề xuất nhất dựa trên ngành gợi ý, điểm số và phân tích holland
`;

    try {
        const completion = await client.chat.completions.create({
            model: DEFAULT_MODEL,
            messages: [
                { role: "system", content: "Bạn là cố vấn hướng nghiệp giàu kinh nghiệm, trả lời bằng tiếng Việt và định dạng Markdown." },
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
