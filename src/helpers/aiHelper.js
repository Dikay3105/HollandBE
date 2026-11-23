// src/helpers/aiHelper.js
// Sinh lời khuyên hướng nghiệp bằng AI – xoay vòng NHIỀU nhà cung cấp miễn phí (xem aiProviders.js):
// Gemini → Groq → OpenRouter → Z.ai → Cloudflare → custom.
//
// Tốc độ:
// - Model quá tải / trả JSON hỏng bị tạm nghỉ (thời gian chờ tăng dần); key/model hết quota ngày bị khoá tới lúc reset.
// - Trong cùng nhà cung cấp, model ra chữ nhanh nhất từng chạy được thử trước.
// - Hedging: chưa có chữ sau HEDGE_DELAY_MS → gọi song song model/nhà cung cấp kế tiếp, ai ra chữ trước thì giữ.
// - Stream + tắt "suy nghĩ" khi được → chữ hiện sau vài giây.
//
// Hết cách → lời khuyên mẫu (không dùng AI), cùng định dạng; BE tự viết lại bằng AI khi có lượt.
const OpenAI = require('openai');
const { renderAdvice, buildRuleBasedAdvice } = require('./adviceRenderer');
const providers = require('./aiProviders');

const REQUEST_TIMEOUT_MS = 60 * 1000;
const TOTAL_BUDGET_MS = 110 * 1000;
const HEDGE_DELAY_MS = 12 * 1000;
const MODEL_COOLDOWN_BASE_MS = 60 * 1000;      // 1 phút, nhân đôi mỗi lần quá tải liên tiếp
const MODEL_COOLDOWN_MAX_MS = 15 * 60 * 1000;  // tối đa 15 phút

const mask = key => `${key.slice(0, 8)}…${key.slice(-4)}`;

/* ================= Sức khoẻ từng (nhà cung cấp, model) ================= */
// id = "provider:model" → { cooldownUntil, strikes, avgMs (tổng), avgFirstMs (tới chữ đầu tiên), ok }

const deadModels = new Set();       // model bị gỡ / không dùng được (theo id)
const paramDrops = new Map();       // id -> Set('reasoning'|'json'): tham số model không nhận, lần sau bỏ luôn
const modelHealth = new Map();

function health(id) {
    if (!modelHealth.has(id)) modelHealth.set(id, { cooldownUntil: 0, strikes: 0, avgMs: null, avgFirstMs: null, ok: 0 });
    return modelHealth.get(id);
}

function markOverloaded(id) {
    const h = health(id);
    h.strikes += 1;
    const ms = Math.min(MODEL_COOLDOWN_BASE_MS * 2 ** (h.strikes - 1), MODEL_COOLDOWN_MAX_MS);
    h.cooldownUntil = Date.now() + ms;
    console.log(`AI: tạm bỏ ${id} ${Math.round(ms / 1000)}s (lỗi lần ${h.strikes})`);
}

function markSuccess(id, ms, firstMs) {
    const h = health(id);
    h.strikes = 0;
    h.cooldownUntil = 0;
    h.ok += 1;
    h.avgMs = h.avgMs === null ? ms : Math.round(h.avgMs * 0.6 + ms * 0.4);
    const f = firstMs ?? ms;
    h.avgFirstMs = h.avgFirstMs === null ? f : Math.round(h.avgFirstMs * 0.6 + f * 0.4);
}

/**
 * Hàng đợi cho lượt này: nhà cung cấp theo thứ tự ưu tiên (chất lượng tiếng Việt), trong mỗi nhà cung cấp
 * model từng ra chữ nhanh đứng trước. Bỏ model chết / đang nghỉ / không còn key nào dùng được.
 */
async function rankCandidates() {
    const out = [];
    const now = Date.now();
    for (const pid of providers.activeProviders()) {
        const models = await providers.providerModels(pid);
        const cands = models
            .map(model => ({ provider: pid, model, id: `${pid}:${model}` }))
            .filter(c => !deadModels.has(c.id) && health(c.id).cooldownUntil <= now && providers.availableKeysFor(pid, c.model).length);
        const proven = cands.filter(c => health(c.id).avgFirstMs !== null).sort((a, b) => health(a.id).avgFirstMs - health(b.id).avgFirstMs);
        out.push(...proven, ...cands.filter(c => !proven.includes(c)));
    }
    return out;
}

/* ================= Gọi API ================= */

function classifyError(err) {
    if (err?.name === 'AbortError' || /aborted/i.test(err?.message || '')) return 'aborted';
    const status = err?.status || err?.response?.status;
    const msg = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`.toLowerCase();
    // Hết quota ngày: OpenRouter "free-models-per-day", Gemini "...PerDay...", Groq/Cerebras "tokens per day (TPD)"…
    if (status === 429 && /per[\s-]?day|perday|daily|\btpd\b|\brpd\b|quota exceeded for metric.*day/.test(msg)) return 'key-daily-limit';
    if (status === 429) return 'overloaded';
    if (status === 401 || status === 403) return 'key-invalid';
    if (status === 400 && /api[ _-]?key|invalid.*(key|token)|authentication|unauthorized/.test(msg)) return 'key-invalid'; // Google trả 400 khi key sai
    if (status === 402) return 'key-no-credit';
    if (status === 404 || (status === 400 && /not a valid model|no endpoints|model/.test(msg))) return 'model-dead';
    if (status === 422) return 'bad-output';
    if (status === 408) return 'timeout';              // treo, không ra chữ
    if (status >= 500 && status < 600) return 'server-error'; // nhà cung cấp quá tải / lỗi (VD Gemini 503)
    return 'transient'; // mạng chập chờn...
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Lấy object JSON từ output của model (bỏ <think>, ```json, chữ thừa). */
function parseAdviceJson(text) {
    const cleaned = String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```(?:json)?/gi, '')
        .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const body = cleaned.slice(start, end + 1);
    // Thử nguyên văn trước, rồi bản đã sửa lỗi cú pháp hay gặp (model nhỏ như Llama trên Cloudflare hay mắc)
    for (const candidate of [body, repairJson(body)]) {
        try {
            const data = JSON.parse(candidate);
            if (data && typeof data === 'object') return data;
        } catch { /* thử cách tiếp theo */ }
    }
    return null;
}

/**
 * Sửa lỗi JSON hay gặp ở output của model: ngoặc kép "cong", dấu phẩy thừa trước } ],
 * xuống dòng / tab nằm trong chuỗi chưa escape, ký tự điều khiển lạ.
 */
function repairJson(s) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (const ch of s.replace(/[“”]/g, '"')) {
        if (inStr) {
            if (esc) { esc = false; out += ch; continue; }
            if (ch === '\\') { esc = true; out += ch; continue; }
            if (ch === '"') { inStr = false; out += ch; continue; }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') continue;
            if (ch === '\t') { out += '\\t'; continue; }
            if (ch < ' ') continue;
            out += ch;
        } else {
            if (ch === '"') inStr = true;
            out += ch;
        }
    }
    return out.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Parse JSON đang viết dở: tự đóng chuỗi / ngoặc còn mở; nếu vẫn lỗi (VD đang dở tên khoá)
 * thì cắt lùi về dấu phẩy / ngoặc gần nhất rồi thử lại.
 */
function closeJson(s) {
    const stack = [];
    let inStr = false;
    let esc = false;
    for (const ch of s) {
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if (ch === '}' || ch === ']') stack.pop();
    }
    let out = s;
    if (inStr) out = (esc ? out.slice(0, -1) : out) + '"';
    out = out.replace(/[,:]\s*$/, '');
    return out + stack.reverse().join('');
}

function parsePartialJson(text) {
    const cleaned = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let s = cleaned.slice(start);
    for (let attempt = 0; attempt < 8 && s.length > 1; attempt++) {
        try {
            const data = JSON.parse(closeJson(s));
            return data && typeof data === 'object' ? data : null;
        } catch {
            const cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{'), s.lastIndexOf('['));
            if (cut <= 0) return null;
            s = s.slice(0, s[cut] === ',' ? cut : cut + 1);
        }
    }
    return null;
}

const FIRST_TOKEN_TIMEOUT_MS = 25 * 1000; // chưa ra chữ đầu tiên sau 25s → coi như treo (model đang nghẽn / suy nghĩ quá lâu)
const IDLE_TIMEOUT_MS = 40 * 1000;        // đã ra chữ nhưng im lặng quá 40s giữa chừng → treo

/**
 * Gọi model dạng stream. onText(rawSoFar) được gọi mỗi khi có thêm chữ.
 * Trả về object JSON hoàn chỉnh khi model viết xong.
 */
async function callModel(cand, apiKey, messages, signal, onText) {
    const { provider, model, id } = cand;
    const client = new OpenAI({
        apiKey,
        baseURL: providers.PROVIDERS[provider].baseURL(),
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 0, // tự xoay vòng, không để SDK retry ngầm
    });
    const params = { model, messages, max_tokens: 4000, temperature: 0.6, stream: true };
    // JSON mode + tắt "suy nghĩ" khi nhà cung cấp/model hỗ trợ (đo với Nemotron: chữ đầu 15s → 1s)
    const extra = providers.requestParams(provider, model);
    const drops = paramDrops.get(id) || new Set();
    if (extra.response_format && !drops.has('json')) params.response_format = extra.response_format;
    // Tham số tắt "suy nghĩ" mỗi nơi một kiểu: reasoning (OpenRouter), reasoning_effort (Gemini/Groq), thinking (Z.ai)…
    const reasoningKeys = Object.keys(extra).filter(k => k !== 'response_format');
    if (!drops.has('reasoning')) for (const k of reasoningKeys) params[k] = extra[k];

    // Watchdog: tự huỷ nếu model im lặng quá lâu (cả trước chữ đầu tiên lẫn giữa chừng)
    const local = new AbortController();
    const onOuterAbort = () => local.abort();
    if (signal.aborted) local.abort();
    signal.addEventListener('abort', onOuterAbort);
    let idleTimer;
    let timedOut = false;
    let gotText = false;
    const kick = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { timedOut = true; local.abort(); }, gotText ? IDLE_TIMEOUT_MS : FIRST_TOKEN_TIMEOUT_MS);
    };

    let raw = '';
    let finish = null;
    try {
        kick();
        let stream;
        // Model không nhận tham số (bắt buộc suy nghĩ / không hỗ trợ JSON mode khi stream…) → nhớ lại, gọi lại không kèm
        for (let attempt = 0; ; attempt++) {
            try {
                stream = await client.chat.completions.create(params, { signal: local.signal });
                break;
            } catch (err) {
                const msg = `${err.message} ${JSON.stringify(err.error || '')}`;
                if (err?.status !== 400 || attempt >= 2) throw err;
                if (reasoningKeys.some(k => params[k] !== undefined) && /reason|thinking|effort/i.test(msg)) {
                    drops.add('reasoning');
                    reasoningKeys.forEach(k => delete params[k]);
                } else if (params.response_format && /response_format|json/i.test(msg)) {
                    drops.add('json');
                    delete params.response_format;
                } else {
                    throw err;
                }
                paramDrops.set(id, drops);
            }
        }
        for await (const chunk of stream) {
            kick();
            if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (!delta) continue;
            raw += delta;
            if (!gotText) { gotText = true; kick(); }
            // Lẫn nhiều chữ Trung/Nhật/Hàn ngay từ đầu → dừng sớm, khỏi chờ hết
            if ((raw.match(CJK) || []).length > 6) {
                throw Object.assign(new Error('Output lẫn chữ CJK'), { status: 422 });
            }
            onText?.(raw);
        }
    } catch (err) {
        if (timedOut) throw Object.assign(new Error(gotText ? `Model ngừng giữa chừng quá ${IDLE_TIMEOUT_MS / 1000}s` : `Chưa ra chữ sau ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`), { status: 408 });
        throw err;
    } finally {
        clearTimeout(idleTimer);
        signal.removeEventListener('abort', onOuterAbort);
    }
    // SDK có thể kết thúc vòng lặp stream ÊM khi bị huỷ (không ném lỗi) → phải tự kiểm tra,
    // nếu không sẽ tưởng model trả rỗng và phạt oan model đó
    if (local.signal.aborted) {
        if (timedOut) throw Object.assign(new Error(gotText ? `Model ngừng giữa chừng quá ${IDLE_TIMEOUT_MS / 1000}s` : `Chưa ra chữ sau ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`), { status: 408 });
        throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    }

    const data = parseAdviceJson(raw);
    if (!data || (!data.summary && !Array.isArray(data.majors))) {
        const tail = raw.slice(-120).replace(/\s+/g, ' ');
        throw Object.assign(new Error(`Model không trả về JSON hợp lệ (dài ${raw.length}, finish=${finish}, cuối: …${tail})`), { status: 422 });
    }
    return data;
}

/* ================= Prompt ================= */

const HOLLAND_REFERENCE = 'Holland (RIASEC): R=thực tế, kỹ thuật; I=nghiên cứu, phân tích; A=nghệ thuật, sáng tạo; S=xã hội, giúp đỡ; E=quản lý, kinh doanh; C=nghiệp vụ, quy trình.';

function jsonSchema(region, majorSourceHint) {
    return `{
  "hollandCode": "2-3 chữ cái nhóm nổi trội, VD: IEC",
  "summary": "2-3 câu tóm tắt hồ sơ",
  "strengths": ["3 điểm mạnh"],
  "improvements": ["2-3 điều cần cải thiện"],
  "scoreOverview": "1 câu nhận xét điểm (bỏ trống nếu chưa có điểm)",
  "subjectPlan": [{ "subject": "đúng tên môn như dữ liệu", "advice": "cách học cụ thể, 1 câu" }],
  "hollandAnalysis": "2-3 câu về nhóm nổi trội và môi trường làm việc phù hợp",
  "aspiration": { "fit": "Cao | Trung bình | Thấp", "comment": "nhận xét nguyện vọng so với Holland, điểm, tổ hợp", "alternatives": ["2 phương án dự phòng cụ thể"] },
  "majors": [{ "name": "tên ngành", "source": "${majorSourceHint}", "reason": "1 câu vì sao phù hợp, dựa trên số liệu", "blocks": ["tổ hợp học sinh dùng được"], "universities": ["2 trường ở ${region}"] }],
  "admissionMethods": ["2-3 phương thức xét tuyển nên cân nhắc"],
  "skills": ["3-4 kỹ năng/hoạt động nên phát triển"],
  "roadmap": [{ "period": "mốc thời gian", "tasks": ["2-3 việc cụ thể"] }],
  "message": "1 câu động viên"
}`;
}

function gradeFromClass(cls) {
    const m = String(cls || '').match(/^(\d{1,2})/);
    return m ? Number(m[1]) : null;
}

const fmt = v => String(v).replace('.', ',');

/** 1 dòng mô tả ngành đã xếp hạng, có số liệu để AI giải thích (không phải tự đoán) */
function rankedLine(m, i) {
    const bits = [`độ phù hợp ${m.matchScore}%`, `khớp nhóm ${(m.matchedGroups || []).join(',')}`];
    const a = m.academic;
    if (a?.block) {
        bits.push(a.total !== null && a.total !== undefined
            ? `${a.block} = ${fmt(a.total)}/30${a.targetTotal ? ` (mục tiêu ${fmt(a.targetTotal)})` : ''}`
            : `xét được bằng ${a.block}`);
    }
    if (m.benchmarkScore) bits.push(`điểm chuẩn tham khảo ~${fmt(m.benchmarkScore)}`);
    if (m.aspirationMatch) bits.push('trùng nguyện vọng');
    return `${i + 1}. ${m.name} (${bits.join('; ')})`;
}

function buildPrompt(input) {
    const {
        scores = [], hollandScores, studentClass, university, major, hollandCode,
        usableBlocks = [], electiveSubjects = [], aptitudeSubjects = [], ranked = [], alternatives = [],
    } = input;
    const settings = input.settings || {};
    const region = settings.region || 'TP.HCM';
    const ai = settings.ai || {};
    const majorCount = ai.majorCount || 6;
    const allowExternal = ai.allowExternalMajors !== false && (ai.maxExternalMajors ?? 2) > 0;

    const scoreLines = scores.length
        ? scores.map(s => {
            const cur = Number(s.currentScore) || 0;
            const tgt = Number(s.targetScore) || 0;
            return `${s.subject}: ${cur || 'chưa nhập'} → ${tgt || 'chưa nhập'}`;
        }).join('; ')
        : 'chưa có';
    const holland = Object.entries(hollandScores || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'chưa có';
    const grade = gradeFromClass(studentClass);
    const now = new Date();
    const examYear = now.getMonth() + 1 >= 8 ? now.getFullYear() + 1 : now.getFullYear();
    const today = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const blocksText = usableBlocks.map(b => `${b.name}=${b.subjects.join('-')}`).join('; ') || 'chưa xác định';

    const majorRule = allowExternal
        ? `"majors": đúng ${majorCount} ngành. ƯU TIÊN lấy từ "Ngành hệ thống xếp hạng" (giữ đúng tên, "source": "list"). ` +
          `Được thêm tối đa ${ai.maxExternalMajors ?? 2} ngành NGOÀI danh sách nếu thật sự hợp Holland và tổ hợp của học sinh ("source": "ai"). ` +
          'Chỉ ghi tổ hợp nằm trong "Tổ hợp dùng được".'
        : `"majors": tối đa ${majorCount} ngành, CHỈ lấy từ "Ngành hệ thống xếp hạng" (giữ đúng tên, "source": "list"). Chỉ ghi tổ hợp nằm trong "Tổ hợp dùng được".`;

    return `${HOLLAND_REFERENCE}

Hôm nay: ${today}. Kỳ thi tốt nghiệp THPT gần nhất: khoảng tháng 6/${examYear} (Toán, Văn bắt buộc + môn tự chọn).

Học sinh:
- Lớp ${studentClass || '?'}${grade ? ` (khối ${grade}${grade === 12 ? ', cuối cấp' : ''})` : ''}
- Holland: ${holland}${hollandCode ? ` → nhóm nổi trội ${hollandCode}` : ''}
- Môn thi tự chọn: ${electiveSubjects.join(', ') || 'chưa chọn'}${aptitudeSubjects.length ? `; thi năng khiếu: ${aptitudeSubjects.join(', ')}` : ''}
- Tổ hợp dùng được: ${blocksText}
- Điểm (hiện tại → mục tiêu, thang 10): ${scoreLines}
- Nguyện vọng: ngành "${major || 'chưa chọn'}" tại "${university || 'chưa chọn'}"

Ngành hệ thống xếp hạng (Holland + điểm theo tổ hợp + nguyện vọng):
${ranked.slice(0, 10).map(rankedLine).join('\n') || 'chưa có'}
${alternatives.length ? `Hợp tính cách nhưng chưa có tổ hợp (cần đổi môn/thi năng khiếu): ${alternatives.map(m => `${m.name} (thiếu ${(m.missingSubjects || []).join(', ')})`).join('; ')}` : ''}

Yêu cầu: tiếng Việt có dấu, thân thiện, xưng "bạn", cụ thể cho học sinh THPT ở ${region}, NGẮN GỌN (mỗi ý ≤ 1-2 câu).
"chưa nhập" = học sinh chưa điền điểm, KHÔNG nhận xét là điểm 0. ${scores.length ? `"subjectPlan": BẮT BUỘC đủ ${scores.length} môn, mỗi môn 1 mục, giữ đúng tên: ${scores.map(s => s.subject).join(', ')}. ` : ''}${majorRule} "reason" phải dựa trên số liệu ở trên (nhóm Holland, điểm tổ hợp). "roadmap": 3 mốc tính từ hôm nay. Được dùng **đậm**, không dùng HTML.
CHỈ trả về MỘT object JSON đúng cấu trúc:
${jsonSchema(region, allowExternal ? 'list | ai' : 'list')}`;
}

/* ================= Hàm chính ================= */

/**
 * Tạo lời khuyên hướng nghiệp.
 * @param {object} [opts]
 * @param {(ev: { type: 'progress', html: string } | { type: 'reset' }) => void} [opts.onProgress]
 *   nhận HTML dựng từ phần AI đã viết (để hiện chữ dần), 'reset' khi model đang viết bị hỏng phải đổi model
 * @returns {Promise<{ html: string, source: 'ai' | 'fallback', model?: string, ms: number }>}
 */
/**
 * @param {object} raw  { scores, hollandScores, hollandCode, studentClass, university, major,
 *                        usableBlocks, electiveSubjects, aptitudeSubjects, ranked, alternatives, settings }
 */
async function generateFullAdvice(raw = {}, { onProgress } = {}) {
    const t0 = Date.now();
    const input = {
        ...raw,
        scores: Array.isArray(raw.scores) ? raw.scores : [],
        hollandScores: raw.hollandScores || {},
        ranked: Array.isArray(raw.ranked) ? raw.ranked : [],
        alternatives: Array.isArray(raw.alternatives) ? raw.alternatives : [],
        usableBlocks: Array.isArray(raw.usableBlocks) ? raw.usableBlocks : [],
    };
    const { scores, hollandScores, university = '', major = '' } = input;
    // hollandCode do hệ thống tính (recommender) → mọi nơi hiển thị cùng 1 mã
    const ctx = { scores, hollandScores, university, major, hollandCode: String(input.hollandCode || '') };

    const fallback = reason => {
        console.error(`AI: ${reason} → dùng lời khuyên mẫu`);
        return {
            html: renderAdvice(buildRuleBasedAdvice(input), { ...ctx, isFallback: true }),
            source: 'fallback',
            ms: Date.now() - t0,
        };
    };

    if (!providers.activeProviders().length) return fallback('chưa cấu hình key AI nào (xem BE/.env.example)');

    const messages = [
        { role: 'system', content: 'Bạn là chuyên gia tư vấn hướng nghiệp cho học sinh THPT Việt Nam. Luôn trả lời bằng tiếng Việt và CHỈ trả về JSON hợp lệ.' },
        { role: 'user', content: buildPrompt(input) },
    ];

    const queue = await rankCandidates();
    const deadline = t0 + TOTAL_BUDGET_MS;
    const laneControllers = { 1: new Set(), 2: new Set() };
    let winner = null;
    let streamOwner = null; // luồng đang "giữ sân khấu" (đã ra chữ đầu tiên)
    let firstTextAt = null;

    // Gửi HTML dựng từ phần đã viết, tối đa ~1.6 lần/giây
    let lastEmit = 0;
    let lastHtml = '';
    const emitProgress = raw => {
        if (!onProgress) return;
        const now = Date.now();
        if (now - lastEmit < 600) return;
        lastEmit = now;
        const partial = parsePartialJson(raw);
        if (!partial) return;
        const html = renderAdvice(partial, { ...ctx, streaming: true });
        if (html === lastHtml) return;
        lastHtml = html;
        onProgress({ type: 'progress', html });
    };
    const abortLane = id => laneControllers[id].forEach(ac => ac.abort());

    /** Một "luồng": lấy model kế tiếp trong hàng đợi, thử lần lượt các key cho tới khi được / phải đổi model. */
    async function lane(laneId) {
        const other = laneId === 1 ? 2 : 1;
        while (!winner && Date.now() < deadline) {
            if (streamOwner !== null && streamOwner !== laneId) return null; // luồng kia đang viết
            const cand = queue.shift();
            if (!cand) return null;
            const { id: model } = cand; // "provider:model" – dùng làm khoá sức khoẻ và trong log
            if (deadModels.has(model) || health(model).cooldownUntil > Date.now()) continue;

            for (const key of providers.availableKeysFor(cand.provider, cand.model)) {
                if (winner || Date.now() > deadline) return null;
                const ac = new AbortController();
                laneControllers[laneId].add(ac);
                const started = Date.now();
                let callFirstAt = null; // chữ đầu tiên của lần gọi này (để xếp hạng model)
                const onText = raw => {
                    if (callFirstAt === null) callFirstAt = Date.now();
                    if (streamOwner === null) {
                        streamOwner = laneId;
                        firstTextAt = firstTextAt || Date.now();
                        abortLane(other); // đã có chữ → huỷ luồng dự phòng
                        console.log(`AI [lane ${laneId}] ${model} ra chữ đầu tiên sau ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                    }
                    if (streamOwner !== laneId) return ac.abort();
                    emitProgress(raw);
                };
                try {
                    const data = await callModel(cand, key, messages, ac.signal, onText);
                    laneControllers[laneId].delete(ac);
                    if (winner) return null;
                    winner = { data, model };
                    markSuccess(model, Date.now() - started, callFirstAt ? callFirstAt - started : null);
                    console.log(`AI OK [lane ${laneId}]: ${model} sau ${((Date.now() - started) / 1000).toFixed(1)}s (key ${mask(key)})`);
                    return winner;
                } catch (err) {
                    laneControllers[laneId].delete(ac);
                    const kind = classifyError(err);
                    if (kind === 'aborted' || winner) return null;
                    console.error(`AI lỗi [lane ${laneId}] [${kind}] ${model} (key ${mask(key)}) sau ${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}`);

                    // Đang hiện chữ dở thì xoá đi, nhường cho model khác
                    if (streamOwner === laneId) {
                        streamOwner = null;
                        lastHtml = '';
                        onProgress?.({ type: 'reset' });
                    }

                    if (kind === 'key-daily-limit' || kind === 'key-no-credit') {
                        providers.blockForDay(cand.provider, key, cand.model); // khoá theo tài khoản hoặc theo model tuỳ nhà cung cấp
                        continue; // thử key khác cùng model
                    }
                    if (kind === 'key-invalid') {
                        providers.blockKey(key, 24 * 60 * 60 * 1000);
                        console.error(`AI: key ${cand.provider} ${mask(key)} không hợp lệ – kiểm tra lại trong .env`);
                        continue;
                    }
                    if (kind === 'model-dead') deadModels.add(model);
                    // nghẽn / treo / lỗi máy chủ / trả JSON hỏng → tạm nghỉ (tăng dần) để lượt sau không chờ lại model này
                    else if (['overloaded', 'bad-output', 'timeout', 'server-error'].includes(kind)) markOverloaded(model);
                    break; // lỗi do model (quá tải / chết / output kém / timeout) → đổi model
                }
            }
        }
        return null;
    }

    // Luồng 1 chạy ngay; luồng 2 (hedge) khởi động nếu sau HEDGE_DELAY_MS chưa có kết quả
    // lane2 luôn resolve đúng 1 lần: kết quả của luồng 2, hoặc null nếu không cần chạy
    let hedgeStarted = false;
    let resolveLane2;
    const lane2 = new Promise(resolve => { resolveLane2 = resolve; });
    const startHedge = () => {
        if (hedgeStarted) return;
        hedgeStarted = true;
        clearTimeout(hedgeTimer);
        if (winner || streamOwner !== null) return resolveLane2(null);
        lane(2).then(resolveLane2, () => resolveLane2(null));
    };
    const hedgeTimer = setTimeout(startHedge, HEDGE_DELAY_MS);

    const lane1 = lane(1).then(
        r => {
            if (r) {
                // thắng trước khi hedge chạy → luồng 2 không cần nữa
                if (!hedgeStarted) { hedgeStarted = true; clearTimeout(hedgeTimer); resolveLane2(null); }
            } else if (!winner) {
                startHedge(); // luồng 1 thất bại sớm → chạy luồng 2 ngay, không chờ hết 12s
            }
            return r;
        },
        () => { startHedge(); return null; }
    );

    const result = await new Promise(resolve => {
        let pending = 2;
        const done = r => {
            if (r) return resolve(r);
            if (--pending === 0) resolve(null);
        };
        lane1.then(done);
        lane2.then(done);
    });
    clearTimeout(hedgeTimer);
    abortLane(1); // huỷ request còn lại (nếu có)
    abortLane(2);

    if (!result) {
        return fallback(Date.now() >= deadline ? 'hết thời gian chờ' : 'tất cả key/model đều không dùng được');
    }
    return {
        html: renderAdvice(result.data, ctx),
        source: 'ai',
        model: result.model,
        ms: Date.now() - t0,
        firstTextMs: firstTextAt ? firstTextAt - t0 : null,
    };
}

/** Trạng thái cho trang admin / debug */
async function getAiStatus() {
    const now = Date.now();
    const list = [];
    let totalKeys = 0;
    let availableKeys = 0;
    for (const pid of providers.activeProviders()) {
        const keys = providers.providerKeys(pid);
        const models = await providers.providerModels(pid);
        const usableKeys = keys.filter(k => models.some(m => providers.availableKeysFor(pid, m).includes(k)));
        totalKeys += keys.length;
        availableKeys += usableKeys.length;
        list.push({
            provider: pid,
            label: providers.PROVIDERS[pid].label,
            keys: keys.length,
            availableKeys: usableKeys.length,
            models: models.map(m => {
                const id = `${pid}:${m}`;
                const h = health(id);
                return {
                    model: m,
                    dead: deadModels.has(id),
                    usableKeys: providers.availableKeysFor(pid, m).length,
                    coolingDownFor: h.cooldownUntil > now ? Math.round((h.cooldownUntil - now) / 1000) : 0,
                    avgFirstMs: h.avgFirstMs,
                    successes: h.ok,
                };
            }),
        });
    }
    const missing = Object.keys(providers.PROVIDERS).filter(id => !list.some(p => p.provider === id));
    return { totalKeys, availableKeys, providers: list, notConfigured: missing };
}

module.exports = { generateFullAdvice, getAiStatus, parseAdviceJson, parsePartialJson, buildPrompt }; // buildPrompt: để đo/kiểm thử prompt
