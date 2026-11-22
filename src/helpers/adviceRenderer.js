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

function section(index, title, body, key) {
    if (!body || !body.trim()) return '';
    return `<section class="adv-section" data-k="${key}"><h3 class="adv-h"><span class="adv-num">${index}</span>${esc(title)}</h3>${body}</section>`;
}

const FIT_CLASS = { cao: 'adv-fit-high', 'trung bình': 'adv-fit-mid', thấp: 'adv-fit-low' };

/**
 * @param {object} d   dữ liệu lời khuyên (xem schema trong aiHelper)
 * @param {object} ctx { scores, hollandScores, university, major, isFallback, streaming }
 *   streaming = đang nhận dở từ AI (dữ liệu chưa đủ) → bỏ dòng ghi chú cuối
 */
function renderAdvice(d, ctx = {}) {
    const parts = [];
    let n = 0;
    const next = () => ++n;

    // --- Tổng quan ---
    const code = String(d.hollandCode || '').toUpperCase().replace(/[^RIASEC]/g, '').slice(0, 3);
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
        parts.push(section(next(), 'Ngành học phù hợp nhất', `<ol class="adv-majors">${majors.map(m => `<li class="adv-major">
<div class="adv-major-name">${txt(m.name)}${String(m.source || '').trim().toLowerCase() === 'ai' ? ' <span class="adv-chip adv-chip-ai">AI gợi ý thêm</span>' : ''}</div>
${m.reason ? `<p>${txt(m.reason)}</p>` : ''}
<div class="adv-chips">${arr(m.blocks).map(b => `<span class="adv-chip">${esc(b)}</span>`).join('')}</div>
${arr(m.universities).length ? `<div class="adv-unis"><span class="adv-muted">Trường tham khảo:</span> ${arr(m.universities).map(txt).join(', ')}</div>` : ''}
</li>`).join('')}</ol>`, 'majors'));
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

/** Lời khuyên mẫu (không dùng AI) – cùng định dạng với lời khuyên AI. */
function buildRuleBasedAdvice({ scores, ranked = [], alternatives = [], usableBlocks = [], hollandScores, university, major }) {
    const blocks = arr(usableBlocks).map(b => b.name);
    const fmt = v => String(v).replace('.', ',');
    const reason = m => {
        const bits = [`Hợp nhóm **${arr(m.matchedGroups).join(', ')}** của bạn`];
        const a = m.academic;
        if (a && a.total !== null && a.total !== undefined) {
            bits.push(`tổ hợp ${a.block} hiện đạt ${fmt(a.total)}/30${m.benchmarkScore ? `, điểm chuẩn tham khảo ~${fmt(m.benchmarkScore)}` : ''}`);
        }
        if (m.aspirationMatch) bits.push('trùng nguyện vọng của bạn');
        return `${bits.join('; ')}.`;
    };
    const top = Object.entries(hollandScores || {})
        .map(([k, v]) => [k.toUpperCase(), Number(v) || 0])
        .filter(([k, v]) => HOLLAND_INFO[k] && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    const gaps = arr(scores)
        .map(s => ({ subject: s.subject, gap: (num(s.targetScore) ?? 0) - (num(s.currentScore) ?? 0), cur: num(s.currentScore) }))
        .filter(s => s.cur !== null && s.gap > 0)
        .sort((a, b) => b.gap - a.gap);

    return {
        hollandCode: top.map(t => t[0]).join(''),
        summary: top.length
            ? `Bạn nổi trội ở nhóm **${top.map(([k]) => HOLLAND_INFO[k][0]).join(', ')}**. Tổ hợp bạn dùng được: ${blocks.join(', ') || 'chưa xác định'}.`
            : 'Kết quả Holland chưa thể hiện rõ nhóm nổi trội. Bạn có thể làm lại bài test hoặc trao đổi với giáo viên.',
        strengths: top.map(([k]) => `${HOLLAND_INFO[k][0]}: ${HOLLAND_INFO[k][1]}.`),
        improvements: gaps.slice(0, 3).map(g => `Môn ${g.subject}: cần tăng thêm khoảng ${fmtScore(g.gap)} điểm để đạt mục tiêu.`),
        subjectPlan: gaps.map(g => ({ subject: g.subject, advice: 'Ôn lại kiến thức nền, luyện đề định kỳ và chữa kỹ lỗi sai.' })),
        hollandAnalysis: top.length ? `Các nhóm nổi bật của bạn gợi ý những công việc phù hợp với sở thích: ${top.map(([k]) => HOLLAND_INFO[k][1]).join('; ')}.` : '',
        aspiration: university || major
            ? {
                comment: 'Hãy tìm hiểu kỹ chương trình đào tạo, điểm chuẩn các năm gần đây và tổ hợp xét tuyển của nguyện vọng này.',
                alternatives: arr(alternatives).slice(0, 2).map(m => `${m.name} (cần thêm môn ${arr(m.missingSubjects).join(', ')})`),
            }
            : {},
        majors: arr(ranked).slice(0, 6).map(m => ({
            name: m.name,
            reason: reason(m),
            blocks: [m.academic?.block, ...arr(m.academic?.otherBlocks)].filter(Boolean).slice(0, 3),
        })),
        admissionMethods: [
            'Xét điểm thi tốt nghiệp THPT theo tổ hợp đã chọn.',
            'Xét học bạ (điểm trung bình các năm THPT) nếu trường có áp dụng.',
            'Kỳ thi Đánh giá năng lực của ĐHQG-HCM.',
        ],
        message: 'Hãy kiên trì từng bước nhỏ mỗi ngày – định hướng rõ ràng sẽ giúp bạn đi xa hơn.',
    };
}

module.exports = { renderAdvice, buildRuleBasedAdvice, HOLLAND_INFO };
