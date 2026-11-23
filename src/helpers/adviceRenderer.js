const { majorField, universityType } = require('../utils/fields');
// src/helpers/adviceRenderer.js
// Dựng HTML lời khuyên từ dữ liệu có cấu trúc (JSON của AI hoặc lời khuyên mẫu).
// Mọi chuỗi đều được escape → không có HTML/JS lạ từ AI lọt vào trang.
// Class "adv-*" được style trong FE (src/index.css, khối .advice-content).

const HOLLAND_INFO = {
    R: ['Kỹ thuật', 'thích làm việc thực tế với máy móc, công cụ, kỹ thuật'],
    I: ['Nghiên cứu', 'thích phân tích, tìm tòi, giải quyết vấn đề khoa học'],
    A: ['Nghệ thuật', 'giàu sáng tạo, thích thiết kế, biểu đạt, nghệ thuật'],
    S: ['Xã hội', 'thích giao tiếp, giúp đỡ, giảng dạy, chăm sóc người khác'],
    E: ['Quản lý', 'năng động, thích thuyết phục, lãnh đạo, kinh doanh'],
    C: ['Nghiệp vụ', 'cẩn thận, ngăn nắp, thích làm việc với dữ liệu và quy trình'],
};

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Escape + cho phép **đậm**; bỏ ký tự CJK do model lỡ chèn vào. */
function txt(s) {
    return esc(String(s ?? '').replace(CJK, '').replace(/\s+/g, ' ').trim()).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

const arr = v => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && String(x).trim?.() !== '') : []);
const num = v => (v === null || v === undefined || v === '' || Number(v) === 0 ? null : Number(v));
const fmtScore = v => (num(v) === null ? '—' : String(Math.round(Number(v) * 100) / 100).replace('.', ','));

function list(items, cls = 'adv-list') {
    const li = arr(items).map(i => `<li>${txt(i)}</li>`).join('');
    return li ? `<ul class="${cls}">${li}</ul>` : '';
}

function section(index, title, body, key, badge = '') {
    if (!body || !body.trim()) return '';
    return `<section class="adv-section" data-k="${key}"><h3 class="adv-h"><span class="adv-num">${index}</span>${esc(title)}${badge}</h3>${body}</section>`;
}

const FIT_CLASS = { cao: 'adv-fit-high', 'trung bình': 'adv-fit-mid', thấp: 'adv-fit-low' };

/**
 * @param {object} d   dữ liệu lời khuyên (xem schema trong aiHelper)
 * @param {object} ctx { scores, hollandScores, hollandCode, university, major, isFallback, streaming }
 *   streaming = đang nhận dở từ AI (dữ liệu chưa đủ) → bỏ dòng ghi chú cuối
 */
function renderAdvice(d, ctx = {}) {
    const parts = [];
    let n = 0;
    const next = () => ++n;

    // --- Tổng quan ---
    // Mã Holland: ưu tiên mã hệ thống đã tính (cùng quy tắc trang kết quả/PDF, theo cấu hình admin), không lấy mã AI tự viết
    const code = String(ctx.hollandCode ?? d.hollandCode ?? '').toUpperCase().replace(/[^RIASEC]/g, '').slice(0, 6);
    if (d.summary || code) {
        parts.push(`<div class="adv-summary" data-k="summary">
${code ? `<div class="adv-code"><span class="adv-code-label">Mã Holland</span><span class="adv-code-value">${esc(code)}</span></div>` : ''}
<p>${txt(d.summary)}</p>
</div>`);
    }

    // --- Điểm mạnh / cần cải thiện ---
    const strengths = list(d.strengths, 'adv-list adv-list-good');
    const improvements = list(d.improvements, 'adv-list adv-list-warn');
    if (strengths || improvements) {
        parts.push(section(next(), 'Điểm mạnh & điều cần cải thiện', `<div class="adv-grid2">
${strengths ? `<div class="adv-card"><h4>Điểm mạnh</h4>${strengths}</div>` : ''}
${improvements ? `<div class="adv-card"><h4>Cần cải thiện</h4>${improvements}</div>` : ''}
</div>`, 'strengths'));
    }

    // --- Kế hoạch điểm số (số liệu lấy từ dữ liệu thật, AI chỉ viết lời khuyên) ---
    const scores = arr(ctx.scores);
    const planAdvice = new Map(arr(d.subjectPlan).map(p => [String(p.subject || '').trim().toLowerCase(), p.advice]));
    const hasAnyScore = scores.some(s => num(s.currentScore) !== null || num(s.targetScore) !== null);
    if (scores.length) {
        const rows = scores.map(s => {
            const cur = num(s.currentScore);
            const tgt = num(s.targetScore);
            const gap = cur !== null && tgt !== null ? Math.round((tgt - cur) * 100) / 100 : null;
            const gapHtml = gap === null ? '—' : gap > 0 ? `<span class="adv-up">+${fmtScore(gap)}</span>` : '<span class="adv-ok">Đạt</span>';
            const advice = planAdvice.get(String(s.subject || '').trim().toLowerCase());
            return `<tr><td class="adv-subj">${esc(s.subject)}</td><td>${fmtScore(cur)}</td><td>${fmtScore(tgt)}</td><td>${gapHtml}</td><td class="adv-tip">${advice ? txt(advice) : ''}</td></tr>`;
        }).join('');
        parts.push(section(next(), 'Kế hoạch cải thiện điểm số', `
${hasAnyScore ? '' : '<p class="adv-muted">Bạn chưa nhập điểm. Hãy nhập điểm hiện tại và điểm mục tiêu để nhận lời khuyên sát hơn.</p>'}
${d.scoreOverview ? `<p>${txt(d.scoreOverview)}</p>` : ''}
<div class="adv-table-wrap"><table class="adv-table"><thead><tr><th>Môn</th><th>Hiện tại</th><th>Mục tiêu</th><th>Cần tăng</th><th>Cách học</th></tr></thead><tbody>${rows}</tbody></table></div>`, 'scores'));
    }

    // --- Holland ---
    const hs = ctx.hollandScores || {};
    const bars = Object.keys(HOLLAND_INFO).map(k => {
        const v = Number(hs[k]) || 0;
        return { k, v };
    });
    const maxV = Math.max(...bars.map(b => b.v), 1);
    const barHtml = bars.some(b => b.v > 0)
        ? `<div class="adv-holland">${bars.map(b => `<div class="adv-hrow${code.includes(b.k) ? ' adv-hrow-top' : ''}"><span class="adv-hkey">${b.k}</span><span class="adv-hname">${HOLLAND_INFO[b.k][0]}</span><span class="adv-hbar"><span style="width:${Math.max((b.v / maxV) * 100, 3)}%"></span></span><span class="adv-hval">${b.v}</span></div>`).join('')}</div>`
        : '';
    if (d.hollandAnalysis || barHtml) {
        parts.push(section(next(), 'Phân tích tính cách nghề nghiệp (Holland)', `${barHtml}${d.hollandAnalysis ? `<p>${txt(d.hollandAnalysis)}</p>` : ''}`, 'holland'));
    }

    // --- Nguyện vọng của học sinh ---
    const asp = d.aspiration || {};
    if ((ctx.university || ctx.major) && (asp.comment || asp.fit)) {
        const fitKey = String(asp.fit || '').trim().toLowerCase();
        const fitCls = FIT_CLASS[fitKey] || 'adv-fit-mid';
        parts.push(section(next(), 'Nhận xét nguyện vọng của bạn', `<div class="adv-card">
<div class="adv-asp-head"><div><div class="adv-muted">Nguyện vọng</div><div class="adv-asp-main">${esc(ctx.major || '—')}${ctx.university ? ` · ${esc(ctx.university)}` : ''}</div></div>
${asp.fit ? `<span class="adv-fit ${fitCls}">Mức phù hợp: ${esc(asp.fit)}</span>` : ''}</div>
${asp.comment ? `<p>${txt(asp.comment)}</p>` : ''}
${arr(asp.alternatives).length ? `<h4>Phương án dự phòng</h4>${list(asp.alternatives)}` : ''}
</div>`, 'aspiration'));
    }

    // --- Ngành phù hợp ---
    const majors = arr(d.majors).slice(0, 6);
    if (majors.length) {
        // Ghi rõ nguồn: AI tự đề xuất hay hệ thống xếp hạng (lời khuyên mẫu khi AI không dùng được)
        const sourceBadge = ctx.isFallback
            ? '<span class="adv-badge adv-badge-sys">Hệ thống gợi ý</span>'
            : '<span class="adv-badge adv-badge-ai">✦ AI đề xuất</span>';
        const hasAiExtra = !ctx.isFallback && majors.some(m => String(m.source || '').trim().toLowerCase() === 'ai');
        const legend = ctx.isFallback
            ? '<p class="adv-muted">Xếp hạng tự động theo nhóm Holland, điểm các môn và tổ hợp của bạn.</p>'
            : `<p class="adv-muted">AI chọn từ các ngành hệ thống xếp hạng theo Holland, điểm và tổ hợp của bạn${hasAiExtra ? '; ngành có nhãn <strong>AI gợi ý thêm</strong> là ngành AI đề xuất ngoài danh sách' : ''}.</p>`;
        parts.push(section(next(), 'Ngành học phù hợp nhất', `${legend}<ol class="adv-majors">${majors.map(m => `<li class="adv-major">
<div class="adv-major-name">${txt(m.name)}${String(m.source || '').trim().toLowerCase() === 'ai' ? ' <span class="adv-chip adv-chip-ai">AI gợi ý thêm</span>' : ''}</div>
${m.reason ? `<p>${txt(m.reason)}</p>` : ''}
<div class="adv-chips">${arr(m.blocks).map(b => `<span class="adv-chip">${esc(b)}</span>`).join('')}</div>
${arr(m.universities).length ? `<div class="adv-unis"><span class="adv-muted">Trường tham khảo:</span> ${arr(m.universities).map(txt).join(', ')}</div>` : ''}
</li>`).join('')}</ol>`, 'majors', sourceBadge));
    }

    // --- Phương thức xét tuyển ---
    if (arr(d.admissionMethods).length) {
        parts.push(section(next(), 'Phương thức xét tuyển nên cân nhắc', list(d.admissionMethods), 'admission'));
    }

    // --- Kỹ năng & hoạt động ---
    if (arr(d.skills).length) {
        parts.push(section(next(), 'Kỹ năng & hoạt động nên phát triển', list(d.skills), 'skills'));
    }

    // --- Lộ trình ---
    const roadmap = arr(d.roadmap);
    if (roadmap.length) {
        parts.push(section(next(), 'Lộ trình hành động', `<ol class="adv-roadmap">${roadmap.map(r => `<li><div class="adv-period">${txt(r.period)}</div>${list(r.tasks)}</li>`).join('')}</ol>`, 'roadmap'));
    }

    // --- Lời nhắn ---
    if (d.message) parts.push(`<blockquote class="adv-quote" data-k="quote">${txt(d.message)}</blockquote>`);

    if (!ctx.streaming) parts.push(`<p class="adv-note" data-k="note">${ctx.isFallback
        ? 'Lời khuyên được tạo tự động từ kết quả của bạn. Hãy trao đổi thêm với giáo viên để có định hướng phù hợp nhất.'
        : 'Lời khuyên do AI tạo, mang tính tham khảo. Hãy trao đổi thêm với giáo viên và gia đình trước khi quyết định.'}</p>`);

    return `<div class="adv">${parts.filter(Boolean).join('\n')}</div>`;
}

/* ================= Lời khuyên mẫu (khi AI không dùng được) ================= */
// Không dùng AI nhưng vẫn cá nhân hoá theo: nhóm Holland đã tính, điểm từng môn (mẹo theo môn + mức chênh),
// tổ hợp/môn năng khiếu, nguyện vọng, lớp đang học.

const plainVi = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Mẹo theo môn: [cơ bản – khi cần tăng nhiều, nâng cao – khi gần đạt]
const SUBJECT_TIPS = [
    [/toan/, 'củng cố lại hàm số, lượng giác, hình học lớp 10–11; làm chắc câu nhận biết – thông hiểu trước khi luyện vận dụng',
        'mỗi tuần 1 đề thi thử bấm giờ 90 phút, ghi sổ lỗi sai và luyện thêm câu vận dụng cao'],
    [/van|ngu van/, 'luyện dàn ý nghị luận xã hội và nghị luận văn học, đọc mẫu bài hay rồi tự viết lại theo ý mình',
        'mỗi tuần viết 1 bài hoàn chỉnh trong thời gian thi, nhờ thầy cô chấm và sửa diễn đạt'],
    [/anh|tieng anh|ngoai ngu/, 'học 15–20 từ vựng/ngày theo chủ đề, ôn lại các thì và cấu trúc ngữ pháp hay gặp trong đề',
        'luyện đề đọc hiểu – điền từ có bấm giờ; cân nhắc thi IELTS để được quy đổi điểm/ưu tiên xét tuyển'],
    [/vat ly|^ly$| ly$/, 'tóm tắt công thức từng chương và làm lại các dạng bài cơ bản cho thật chắc',
        'luyện dạng bài tổng hợp, đồ thị và câu hỏi thí nghiệm; làm đề bấm giờ để tăng tốc độ'],
    [/hoa/, 'ôn phương trình phản ứng, tính chất chất vô cơ – hữu cơ và các công thức tính toán cơ bản',
        'luyện bài tập tính toán nhiều bước và câu hỏi thực nghiệm; làm sơ đồ chuỗi phản ứng để nhớ lâu'],
    [/sinh/, 'vẽ sơ đồ tư duy từng chương (di truyền, sinh thái, cơ thể) và học thuộc khái niệm cốt lõi',
        'luyện bài tập di truyền và câu hỏi phân tích số liệu thí nghiệm'],
    [/su|lich su/, 'lập trục thời gian cho từng giai đoạn, học theo sự kiện – nguyên nhân – ý nghĩa',
        'luyện câu hỏi so sánh, liên hệ và đề thi thử để quen cách hỏi mới'],
    [/dia/, 'ôn kiến thức theo vùng kinh tế, luyện đọc Atlat và nhận dạng biểu đồ',
        'luyện kỹ năng xử lý số liệu, vẽ – nhận xét biểu đồ và đề thi thử bấm giờ'],
    [/kinh te|phap luat|gdcd|gdkt/, 'học theo tình huống thực tế, ghi nhớ các khái niệm và quyền – nghĩa vụ công dân',
        'luyện câu hỏi tình huống pháp luật – kinh tế trong đề thi thử'],
    [/tin|tin hoc/, 'ôn lại thuật toán cơ bản và luyện viết chương trình nhỏ mỗi ngày',
        'luyện đề lập trình có giới hạn thời gian và bài toán tối ưu'],
    [/cong nghe/, 'ôn kiến thức trọng tâm theo chủ đề và hiểu nguyên lý thay vì học thuộc',
        'luyện câu hỏi ứng dụng thực tế và đề thi thử'],
    [/nang khieu|ve|hinh hoa|trang tri|hat|thanh nhac|mam non|the duc|the thao|nhac|mua|bieu dien|dien vien/,
        'luyện năng khiếu đều đặn mỗi ngày, tìm hiểu đề mẫu và tiêu chí chấm của trường bạn nhắm tới',
        'tham gia lớp luyện thi năng khiếu và thi thử để quen áp lực phòng thi'],
];

function subjectTip(subject, cur, gap) {
    const key = plainVi(subject);
    const found = SUBJECT_TIPS.find(([re]) => re.test(key));
    const [basic, advanced] = found ? [found[1], found[2]] : ['ôn lại kiến thức nền theo từng chương', 'luyện đề định kỳ và chữa kỹ lỗi sai'];
    if (cur === null) return `Nhập điểm hiện tại để có lộ trình sát hơn; trước mắt nên ${basic}.`;
    if (gap <= 0) return `Đã đạt mục tiêu – giữ phong độ: ${advanced}.`;
    const months = Math.ceil(gap / 0.5);
    const plan = gap >= 2 ? `${basic}. Cần tăng ${fmtScore(gap)} điểm – đặt mốc khoảng +0,5 điểm/tháng (≈${months} tháng)`
        : gap >= 1 ? `${basic}, sau đó ${advanced}`
            : advanced;
    return plan.charAt(0).toUpperCase() + plan.slice(1) + '.';
}

const GROUP_SKILLS = {
    R: 'Tham gia CLB kỹ thuật/robotics, tự làm mô hình hoặc sửa chữa đồ dùng để rèn kỹ năng thực hành.',
    I: 'Tham gia CLB khoa học, cuộc thi nghiên cứu khoa học kỹ thuật; đọc thêm sách và tài liệu chuyên ngành.',
    A: 'Xây dựng portfolio sáng tạo (vẽ, thiết kế, viết, quay dựng) – rất có lợi khi xét tuyển ngành nghệ thuật.',
    S: 'Tham gia tình nguyện, hoạt động Đoàn – Hội, kèm bạn học để rèn giao tiếp và kỹ năng hỗ trợ người khác.',
    E: 'Nhận vai trò cán sự lớp, tổ chức sự kiện, luyện thuyết trình trước đám đông.',
    C: 'Luyện tin học văn phòng (Excel, Word), tự lập kế hoạch học tập và quản lý thời gian chi tiết.',
};

const GROUP_MESSAGE = {
    R: 'Bạn mạnh ở làm thật, thấy kết quả thật – hãy biến mỗi buổi ôn tập thành một "sản phẩm" nhỏ hoàn thành mỗi ngày.',
    I: 'Sự tò mò là lợi thế lớn của bạn – đặt câu hỏi "vì sao" cho từng bài học, điểm số sẽ đến theo.',
    A: 'Sáng tạo của bạn cần một kế hoạch đủ chắc – giữ đam mê và kỷ luật song song, bạn sẽ đi rất xa.',
    S: 'Bạn giỏi kết nối và giúp đỡ người khác – học nhóm và dạy lại cho bạn bè sẽ giúp bạn nhớ bài lâu hơn.',
    E: 'Bạn có tố chất dẫn dắt – hãy đặt mục tiêu rõ ràng cho từng tuần và tự "quản lý dự án" việc học của mình.',
    C: 'Sự cẩn thận và ngăn nắp là điểm mạnh – một lịch ôn tập chi tiết sẽ giúp bạn về đích đúng hẹn.',
};

function gradeOf(cls) {
    const m = String(cls || '').match(/^(\d{1,2})/);
    return m ? Number(m[1]) : null;
}

function roadmapFor(grade) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const examYear = month >= 8 ? year + 1 : year;
    if (grade === 12) {
        return [
            { period: `Từ nay đến hết học kỳ 1 (tháng 1/${examYear})`, tasks: ['Hệ thống lại kiến thức nền các môn trong tổ hợp', 'Chốt danh sách 3–5 ngành/trường mục tiêu và phương thức xét tuyển'] },
            { period: `Tháng 2 – 5/${examYear}`, tasks: ['Luyện đề thi thử hằng tuần, theo dõi điểm từng môn', 'Nộp hồ sơ các phương thức xét tuyển sớm (học bạ, năng lực, chứng chỉ) nếu có'] },
            { period: `Tháng 6 – 8/${examYear}`, tasks: ['Thi tốt nghiệp THPT, giữ sức khoẻ và tâm lý ổn định', 'So sánh điểm với điểm chuẩn, điều chỉnh nguyện vọng hợp lý'] },
        ];
    }
    const yearsLeft = grade === 10 ? 2 : grade === 11 ? 1 : null;
    return [
        { period: 'Học kỳ này', tasks: ['Giữ điểm trung bình các môn trong tổ hợp ở mức cao (học bạ được dùng để xét tuyển)', 'Tìm hiểu kỹ ngành và trường mình quan tâm'] },
        { period: yearsLeft === 2 ? 'Hè và năm lớp 11' : 'Hè trước lớp 12', tasks: ['Tham gia hoạt động ngoại khoá/CLB phù hợp nhóm Holland', 'Bắt đầu luyện chứng chỉ (IELTS, tin học) nếu ngành yêu cầu'] },
        { period: `Năm lớp 12 (thi tháng 6/${examYear + (yearsLeft || 0)})`, tasks: ['Luyện đề thi thử theo tổ hợp đã chọn', 'Chốt nguyện vọng và chuẩn bị hồ sơ xét tuyển'] },
    ];
}

function buildRuleBasedAdvice({
    scores, ranked = [], alternatives = [], usableBlocks = [], hollandScores, hollandCode = '',
    university, major, studentClass, aptitudeSubjects = [],
}) {
    const blocks = arr(usableBlocks).map(b => b.name);
    const fmt = v => String(v).replace('.', ',');
    // Mã Holland: dùng đúng mã hệ thống đã tính (cùng quy tắc với trang kết quả, theo cấu hình admin)
    const codes = String(hollandCode || '').toUpperCase().split('').filter(k => HOLLAND_INFO[k]);
    const groupNames = codes.map(k => HOLLAND_INFO[k][0]);

    const subjectRows = arr(scores).map(s => {
        const cur = num(s.currentScore);
        const tgt = num(s.targetScore);
        return { subject: s.subject, cur, tgt, gap: cur !== null && tgt !== null ? Math.round((tgt - cur) * 100) / 100 : 0 };
    });
    const withScore = subjectRows.filter(r => r.cur !== null);
    const strong = withScore.filter(r => r.cur >= 8).sort((a, b) => b.cur - a.cur);
    const gaps = withScore.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap);
    const avg = withScore.length ? withScore.reduce((a, r) => a + r.cur, 0) / withScore.length : null;

    const reason = m => {
        const bits = [`Hợp nhóm **${arr(m.matchedGroups).join(', ')}** của bạn`];
        const a = m.academic;
        if (a && a.total !== null && a.total !== undefined) {
            bits.push(`tổ hợp ${a.block} hiện đạt ${fmt(a.total)}/30${m.benchmarkScore ? `, điểm chuẩn tham khảo ~${fmt(m.benchmarkScore)}` : ''}`);
        }
        if (m.aspirationMatch) bits.push('trùng nguyện vọng của bạn');
        return `${bits.join('; ')}.`;
    };

    // Nguyện vọng: có trong danh sách ngành phù hợp? cùng lĩnh vực?
    const aspMatch = arr(ranked).find(m => m.aspirationMatch);
    const aspField = major ? majorField(major) : '';
    const sameField = aspField && arr(ranked).some(m => majorField(m.name) === aspField);
    const fit = !major ? '' : aspMatch ? 'Cao' : sameField ? 'Trung bình' : 'Thấp';
    const aspComment = !major && !university ? ''
        : aspMatch ? `Nguyện vọng **${major}** nằm trong danh sách ngành phù hợp với nhóm Holland và tổ hợp của bạn – hãy giữ hướng này và tập trung nâng điểm.`
            : sameField ? `Ngành **${major}** cùng lĩnh vực ${aspField} với các ngành phù hợp của bạn, nhưng chưa phải lựa chọn sát nhất – nên tìm hiểu kỹ chương trình đào tạo và so sánh với các ngành gợi ý bên dưới.`
                : major ? `Ngành **${major}** chưa khớp rõ với nhóm Holland ${codes.join('') || ''} và tổ hợp hiện tại. Hãy tìm hiểu thực tế công việc, tham khảo thầy cô và cân nhắc thêm các ngành gợi ý bên dưới.`
                    : `Bạn đã chọn trường **${university}** – hãy xác định thêm ngành cụ thể để có lời khuyên sát hơn.`;

    // Phương thức xét tuyển theo hồ sơ
    const methods = [`Xét điểm thi tốt nghiệp THPT${blocks.length ? ` theo tổ hợp ${blocks.slice(0, 4).join(', ')}` : ''}.`];
    if (avg !== null && avg >= 7.5) methods.push(`Xét học bạ: điểm hiện tại trung bình ~${fmtScore(Math.round(avg * 10) / 10)} – giữ ổn định các học kỳ còn lại để có lợi thế.`);
    else methods.push('Xét học bạ nếu trường có áp dụng – cần cải thiện điểm trung bình các môn trong tổ hợp.');
    const uniType = university ? universityType(university) : '';
    if (uniType === 'ĐHQG-HCM') methods.push('Kỳ thi Đánh giá năng lực ĐHQG-HCM – phương thức quan trọng của các trường thành viên ĐHQG.');
    else methods.push('Kỳ thi Đánh giá năng lực ĐHQG-HCM (nhiều trường ngoài ĐHQG cũng sử dụng kết quả này).');
    const eng = subjectRows.find(r => /anh/.test(plainVi(r.subject)));
    if (eng && ((eng.tgt ?? 0) >= 8 || (eng.cur ?? 0) >= 7.5)) methods.push('Chứng chỉ IELTS (từ 5.5–6.0) để quy đổi điểm Tiếng Anh hoặc được ưu tiên xét tuyển.');
    if (arr(aptitudeSubjects).length) methods.push(`Thi năng khiếu (${arr(aptitudeSubjects).join(', ')}) theo lịch riêng của từng trường – nên đăng ký sớm.`);
    if (uniType === 'Quân đội – Công an') methods.push('Đăng ký sơ tuyển (sức khoẻ, lý lịch) tại địa phương trước hạn quy định.');

    const strengths = [
        ...codes.slice(0, 3).map(k => `Nhóm **${HOLLAND_INFO[k][0]}**: ${HOLLAND_INFO[k][1]}.`),
        strong.length ? `Học lực tốt ở ${strong.slice(0, 3).map(r => `${r.subject} (${fmtScore(r.cur)})`).join(', ')}.` : '',
        blocks.length > 1 ? `Có ${blocks.length} tổ hợp xét tuyển dùng được (${blocks.slice(0, 4).join(', ')}) – nhiều lựa chọn ngành.` : '',
    ].filter(Boolean);

    const improvements = [
        ...gaps.slice(0, 3).map(g => `Môn **${g.subject}**: ${fmtScore(g.cur)} → ${fmtScore(g.tgt)}, cần tăng ${fmtScore(g.gap)} điểm.`),
        !withScore.length ? 'Chưa nhập điểm các môn – nên cập nhật để biết mình đang cách mục tiêu bao xa.' : '',
        !major ? 'Chưa xác định ngành mong muốn – hãy chọn 2–3 ngành để tìm hiểu kỹ.' : '',
    ].filter(Boolean);

    return {
        hollandCode: codes.join(''),
        summary: codes.length
            ? `Bạn nổi trội ở nhóm **${groupNames.join(', ')}** (mã ${codes.join('')}).` +
              (avg !== null ? ` Điểm hiện tại trung bình khoảng ${fmtScore(Math.round(avg * 10) / 10)}.` : '') +
              (blocks.length ? ` Tổ hợp dùng được: ${blocks.slice(0, 5).join(', ')}.` : '')
            : 'Kết quả Holland chưa thể hiện rõ nhóm nổi trội. Bạn có thể làm lại bài test hoặc trao đổi với giáo viên.',
        strengths,
        improvements,
        scoreOverview: gaps.length
            ? `Bạn cần cải thiện nhiều nhất ở ${gaps.slice(0, 2).map(g => g.subject).join(' và ')}; các môn còn lại giữ nhịp ôn tập đều.`
            : withScore.length ? 'Điểm hiện tại đã sát hoặc đạt mục tiêu – tập trung giữ phong độ.' : '',
        subjectPlan: subjectRows.map(r => ({ subject: r.subject, advice: subjectTip(r.subject, r.cur, r.gap) })),
        hollandAnalysis: codes.length
            ? `Với nhóm ${groupNames.join(', ')}, bạn phù hợp môi trường mà ở đó bạn được ${codes.slice(0, 3).map(k => HOLLAND_INFO[k][1]).join('; ')}.`
            : '',
        aspiration: aspComment
            ? {
                fit,
                comment: aspComment,
                alternatives: [
                    ...arr(ranked).filter(m => !m.aspirationMatch).slice(0, 2).map(m => m.name),
                    ...arr(alternatives).slice(0, 1).map(m => `${m.name} (cần thêm môn ${arr(m.missingSubjects).join(', ')})`),
                ].slice(0, 3),
            }
            : {},
        majors: arr(ranked).slice(0, 6).map(m => ({
            name: m.name,
            reason: reason(m),
            blocks: [m.academic?.block, ...arr(m.academic?.otherBlocks)].filter(Boolean).slice(0, 3),
        })),
        admissionMethods: methods,
        skills: codes.slice(0, 3).map(k => GROUP_SKILLS[k]),
        roadmap: roadmapFor(gradeOf(studentClass)),
        message: GROUP_MESSAGE[codes[0]] || 'Hãy kiên trì từng bước nhỏ mỗi ngày – định hướng rõ ràng sẽ giúp bạn đi xa hơn.',
    };
}

module.exports = { renderAdvice, buildRuleBasedAdvice, HOLLAND_INFO };
