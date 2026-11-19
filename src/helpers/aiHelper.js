// src/helpers/aiHelper.js
// Sinh lời khuyên hướng nghiệp qua OpenRouter.
//
// Tốc độ:
// - Model quá tải (429 từ nhà cung cấp) bị tạm bỏ với MỌI key, thời gian chờ tăng dần → không đốt
//   thời gian gọi lại model đang nghẽn ở các lượt sau.
// - Model chạy tốt gần nhất được thử trước (xếp theo độ trễ trung bình).
// - Hedging: model đầu chưa trả lời sau HEDGE_DELAY_MS → gọi song song model kế tiếp, ai xong trước dùng.
// - Prompt gọn, giảm suy nghĩ (reasoning effort: low) với model hỗ trợ.
//
// Độ bền:
// - Danh sách model free lấy tự động từ OpenRouter (cache 6 giờ), ưu tiên AI_MODELS trong .env.
// - Key hết quota ngày bị khoá tới 00:00 UTC; model bị gỡ (404) bị bỏ.
// - Hết cách → lời khuyên mẫu (không dùng AI), cùng định dạng.
const OpenAI = require('openai');
const axios = require('axios');
const { renderAdvice, buildRuleBasedAdvice } = require('./adviceRenderer');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const TOTAL_BUDGET_MS = 110 * 1000;
const HEDGE_DELAY_MS = 12 * 1000;
const MODEL_COOLDOWN_BASE_MS = 60 * 1000;      // 1 phút, nhân đôi mỗi lần quá tải liên tiếp
const MODEL_COOLDOWN_MAX_MS = 15 * 60 * 1000;  // tối đa 15 phút

// Thứ tự ưu tiên mặc định (chỉ dùng nếu model còn free). Ghi đè bằng AI_MODELS="a,b,c" trong .env
const DEFAULT_PREFERRED = [
    'google/gemma-4-31b-it:free', // tiếng Việt tốt nhất trong nhóm free
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-super-vl:free',
    'baidu/ernie-5.5-flash-preview:free',
];
const FALLBACK_ROUTER = 'openrouter/free';

/* ================= Keys ================= */

// Lấy mọi biến OPENROUTER_API_KEY, OPENROUTER_API_KEY_1, _2, ... (không giới hạn số lượng)
function getApiKeys() {
    return Object.keys(process.env)
        .filter(k => /^OPENROUTER_API_KEY(_\d+)?$/.test(k))
        .sort((a, b) => (parseInt(a.split('_').pop(), 10) || 0) - (parseInt(b.split('_').pop(), 10) || 0))
        .map(k => (process.env[k] || '').trim())
        .filter(Boolean);
}

const keyBlockedUntil = new Map(); // key -> timestamp
let keyCursor = 0;                 // xoay vòng key để chia đều quota

function nextUtcMidnight() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0); // quota free của OpenRouter reset 00:00 UTC (7h sáng VN)
    return d.getTime();
}

const mask = key => `${key.slice(0, 10)}…${key.slice(-4)}`;

/** Các key còn dùng được, bắt đầu từ vị trí xoay vòng. */
function availableKeys() {
    const keys = getApiKeys().filter(k => (keyBlockedUntil.get(k) || 0) <= Date.now());
    if (!keys.length) return [];
    const start = keyCursor++ % keys.length;
    return [...keys.slice(start), ...keys.slice(0, start)];
}

/* ================= Models ================= */

let modelCache = { at: 0, list: null };
const deadModels = new Set();         // model bị gỡ / không dùng được
const jsonCapableModels = new Set();  // hỗ trợ response_format=json_object
const reasoningModels = new Set();    // hỗ trợ tham số reasoning
const reasoningRequired = new Set();  // model không cho tắt reasoning
// model -> { cooldownUntil, strikes, avgMs, ok }
const modelHealth = new Map();

function health(model) {
    if (!modelHealth.has(model)) modelHealth.set(model, { cooldownUntil: 0, strikes: 0, avgMs: null, ok: 0 });
    return modelHealth.get(model);
}

function markOverloaded(model) {
    const h = health(model);
    h.strikes += 1;
    const ms = Math.min(MODEL_COOLDOWN_BASE_MS * 2 ** (h.strikes - 1), MODEL_COOLDOWN_MAX_MS);
    h.cooldownUntil = Date.now() + ms;
    console.log(`AI: tạm bỏ ${model} ${Math.round(ms / 1000)}s (quá tải lần ${h.strikes})`);
}

function markSuccess(model, ms) {
    const h = health(model);
    h.strikes = 0;
    h.cooldownUntil = 0;
    h.ok += 1;
    h.avgMs = h.avgMs === null ? ms : Math.round(h.avgMs * 0.6 + ms * 0.4);
}

function getPreferred() {
    const fromEnv = (process.env.AI_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    return fromEnv.length ? fromEnv : DEFAULT_PREFERRED;
}

async function fetchFreeTextModels() {
    const { data } = await axios.get(`${OPENROUTER_BASE}/models`, { timeout: 15000 });
    return (data?.data || [])
        .filter(m => {
            const free = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
            const arch = m.architecture || {};
            const textIn = (arch.input_modalities || []).includes('text');
            const textOutOnly = JSON.stringify(arch.output_modalities || []) === '["text"]';
            const notCodeOrTiny = !/code|coder|1\.7b|\b[1-4]b\b/i.test(m.id);
            const ok = free && textIn && textOutOnly && notCodeOrTiny && m.id !== FALLBACK_ROUTER;
            const params = m.supported_parameters || [];
            if (params.includes('response_format')) jsonCapableModels.add(m.id);
            if (params.includes('reasoning')) reasoningModels.add(m.id);
            return ok;
        })
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
        .map(m => m.id);
}

async function getModelList() {
    if (modelCache.list && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.list;

    const preferred = getPreferred();
    let list;
    try {
        const available = await fetchFreeTextModels();
        const availableSet = new Set(available);
        const fromEnv = Boolean(process.env.AI_MODELS);
        // Model trong AI_MODELS luôn được thử (có thể là model trả phí); model mặc định chỉ khi còn free
        const head = preferred.filter(m => fromEnv || availableSet.has(m));
        list = [...new Set([...head, ...available, FALLBACK_ROUTER])];
        deadModels.clear();
    } catch (err) {
        console.error('Không lấy được danh sách model OpenRouter:', err.message);
        list = [...new Set([...preferred, FALLBACK_ROUTER])];
    }
    modelCache = { at: Date.now(), list };
    console.log('AI models:', list.join(', '));
    return list;
}

/**
 * Thứ tự thử cho lượt này: bỏ model chết / đang nghỉ; model từng chạy tốt lên trước (nhanh nhất trước),
 * còn lại giữ thứ tự ưu tiên. openrouter/free luôn ở cuối.
 */
async function rankModels() {
    const list = await getModelList();
    const now = Date.now();
    const usable = list.filter(m => !deadModels.has(m) && health(m).cooldownUntil <= now);
    const proven = usable.filter(m => m !== FALLBACK_ROUTER && health(m).avgMs !== null)
        .sort((a, b) => health(a).avgMs - health(b).avgMs);
    const rest = usable.filter(m => !proven.includes(m) && m !== FALLBACK_ROUTER);
    const ranked = [...proven, ...rest];
    if (usable.includes(FALLBACK_ROUTER)) ranked.push(FALLBACK_ROUTER);
    // Mọi model đều đang nghỉ → vẫn thử model nghỉ sắp hết nhất thay vì bỏ cuộc
    if (!ranked.length) {
        return list.filter(m => !deadModels.has(m)).sort((a, b) => health(a).cooldownUntil - health(b).cooldownUntil);
    }
    return ranked;
}

/* ================= Gọi API ================= */

function classifyError(err) {
    if (err?.name === 'AbortError' || /aborted/i.test(err?.message || '')) return 'aborted';
    const status = err?.status || err?.response?.status;
    const msg = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`.toLowerCase();
    if (status === 429 && /per-day|per day|daily/.test(msg)) return 'key-daily-limit';
    if (status === 429) return 'overloaded';
    if (status === 401 || status === 403) return 'key-invalid';
    if (status === 402) return 'key-no-credit';
    if (status === 404 || (status === 400 && /not a valid model|no endpoints|model/.test(msg))) return 'model-dead';
    if (status === 422) return 'bad-output';
    return 'transient'; // timeout, 5xx, mạng...
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
    try {
        const data = JSON.parse(cleaned.slice(start, end + 1));
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
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

const IDLE_TIMEOUT_MS = 40 * 1000; // không nhận được chữ nào trong 40s → coi như treo

/**
 * Gọi model dạng stream. onText(rawSoFar) được gọi mỗi khi có thêm chữ.
 * Trả về object JSON hoàn chỉnh khi model viết xong.
 */
async function callModel(apiKey, model, messages, signal, onText) {
    const client = new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE,
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 0, // tự xoay vòng, không để SDK retry ngầm
    });
    const params = { model, messages, max_tokens: 4000, temperature: 0.6, stream: true };
    if (jsonCapableModels.has(model)) params.response_format = { type: 'json_object' };
    // Tắt "suy nghĩ": đo thực tế với Nemotron Ultra, chữ đầu tiên 15s → 1s, tổng 35s → 23s.
    // Lời khuyên dạng JSON có cấu trúc không cần suy luận sâu.
    if (reasoningModels.has(model) && !reasoningRequired.has(model)) params.reasoning = { enabled: false };

    // Watchdog: tự huỷ nếu model im lặng quá lâu (cả trước chữ đầu tiên lẫn giữa chừng)
    const local = new AbortController();
    const onOuterAbort = () => local.abort();
    if (signal.aborted) local.abort();
    signal.addEventListener('abort', onOuterAbort);
    let idleTimer;
    let timedOut = false;
    const kick = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { timedOut = true; local.abort(); }, IDLE_TIMEOUT_MS);
    };

    let raw = '';
    let finish = null;
    try {
        kick();
        let stream;
        try {
            stream = await client.chat.completions.create(params, { signal: local.signal });
        } catch (err) {
            // Model bắt buộc phải suy nghĩ → nhớ lại và gọi lại ngay, không kèm tham số reasoning
            if (err?.status === 400 && params.reasoning && /reason/i.test(`${err.message} ${JSON.stringify(err.error || '')}`)) {
                reasoningRequired.add(model);
                delete params.reasoning;
                stream = await client.chat.completions.create(params, { signal: local.signal });
            } else {
                throw err;
            }
        }
        for await (const chunk of stream) {
            kick();
            if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (!delta) continue;
            raw += delta;
            // Lẫn nhiều chữ Trung/Nhật/Hàn ngay từ đầu → dừng sớm, khỏi chờ hết
            if ((raw.match(CJK) || []).length > 6) {
                throw Object.assign(new Error('Output lẫn chữ CJK'), { status: 422 });
            }
            onText?.(raw);
        }
    } catch (err) {
        if (timedOut) throw Object.assign(new Error(`Model im lặng quá ${IDLE_TIMEOUT_MS / 1000}s`), { status: 408 });
        throw err;
    } finally {
        clearTimeout(idleTimer);
        signal.removeEventListener('abort', onOuterAbort);
    }
    // SDK có thể kết thúc vòng lặp stream ÊM khi bị huỷ (không ném lỗi) → phải tự kiểm tra,
    // nếu không sẽ tưởng model trả rỗng và phạt oan model đó
    if (local.signal.aborted) {
        if (timedOut) throw Object.assign(new Error(`Model im lặng quá ${IDLE_TIMEOUT_MS / 1000}s`), { status: 408 });
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

const BLOCKS_REFERENCE = 'Tổ hợp xét tuyển (2025): A00=Toán-Lý-Hóa; A01=Toán-Lý-Anh; A02=Toán-Lý-Sinh; A03=Toán-Lý-Sử; A04=Toán-Lý-Địa; A05=Toán-Hóa-Sử; A06=Toán-Hóa-Địa; A07=Toán-Sử-Địa; A08=Toán-Sử-GDKT&PL; A09=Toán-Địa-GDKT&PL; A10=Toán-Lý-GDKT&PL; A11=Toán-Hóa-GDKT&PL; B00=Toán-Hóa-Sinh; B01=Toán-Sử-Sinh; B02=Toán-Địa-Sinh; B03=Toán-Văn-Sinh; B08=Toán-Anh-Sinh; C00=Văn-Sử-Địa; C01=Văn-Toán-Lý; C02=Văn-Toán-Hóa; C03=Văn-Toán-Sử; C04=Văn-Toán-Địa; C05=Văn-Lý-Hóa; C06=Văn-Lý-Sinh; C07=Văn-Lý-Sử; C08=Văn-Hóa-Sinh; C09=Văn-Lý-Địa; C10=Văn-Hóa-Sử; C12=Văn-Sinh-Sử; C13=Văn-Sinh-Địa; C14=Văn-Toán-GDKT&PL; C16=Văn-Lý-GDKT&PL; C17=Văn-Hóa-GDKT&PL; C19=Văn-Sử-GDKT&PL; D01=Toán-Văn-Anh; D07=Toán-Hóa-Anh; D08=Toán-Sinh-Anh; D09=Toán-Anh-Sử; D10=Toán-Địa-Anh; D12=Văn-Hóa-Anh; D13=Văn-Sinh-Anh; D14=Văn-Sử-Anh; D15=Văn-Địa-Anh; D66=Văn-GDKT&PL-Anh; D84=Toán-GDKT&PL-Anh. (GDKT&PL = Giáo dục kinh tế và pháp luật)\nHolland (RIASEC): R=thực tế, kỹ thuật; I=nghiên cứu, phân tích; A=nghệ thuật, sáng tạo; S=xã hội, giúp đỡ; E=quản lý, kinh doanh; C=nghiệp vụ, quy trình.';

const JSON_SCHEMA = `{
  "hollandCode": "2-3 chữ cái nhóm nổi trội, VD: IEC",
  "summary": "2-3 câu tóm tắt hồ sơ",
  "strengths": ["3 điểm mạnh"],
  "improvements": ["2-3 điều cần cải thiện"],
  "scoreOverview": "1 câu nhận xét điểm (bỏ trống nếu chưa có điểm)",
  "subjectPlan": [{ "subject": "đúng tên môn như dữ liệu", "advice": "cách học cụ thể, 1 câu" }],
  "hollandAnalysis": "2-3 câu về nhóm nổi trội và môi trường làm việc phù hợp",
  "aspiration": { "fit": "Cao | Trung bình | Thấp", "comment": "nhận xét nguyện vọng so với Holland, điểm, khối thi", "alternatives": ["2 phương án dự phòng cụ thể"] },
  "majors": [{ "name": "tên ngành", "reason": "1 câu vì sao phù hợp", "blocks": ["A00"], "universities": ["2 trường ở TP.HCM"] }],
  "admissionMethods": ["2-3 phương thức xét tuyển nên cân nhắc"],
  "skills": ["3-4 kỹ năng/hoạt động nên phát triển"],
  "roadmap": [{ "period": "mốc thời gian", "tasks": ["2-3 việc cụ thể"] }],
  "message": "1 câu động viên"
}`;

function gradeFromClass(cls) {
    const m = String(cls || '').match(/^(\d{1,2})/);
    return m ? Number(m[1]) : null;
}

function buildPrompt({ scores, majorNames, blocks, hollandScores, studentClass, university, major }) {
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

    return `${BLOCKS_REFERENCE}

Hôm nay: ${today}. Kỳ thi tốt nghiệp THPT gần nhất: khoảng tháng 6/${examYear}.

Học sinh:
- Lớp ${studentClass || '?'}${grade ? ` (khối ${grade}${grade === 12 ? ', cuối cấp' : ''})` : ''}
- Điểm (hiện tại → mục tiêu, thang 10): ${scoreLines}
- Khối thi chọn: ${blocks.join(', ') || 'chưa chọn'}
- Holland: ${holland}
- Nguyện vọng: ngành "${major || 'chưa chọn'}" tại "${university || 'chưa chọn'}"
- Ngành gợi ý theo Holland: ${majorNames.slice(0, 15).join(', ') || 'chưa có'}

Yêu cầu: tiếng Việt có dấu, thân thiện, xưng "bạn", cụ thể cho học sinh THPT ở TP.HCM, NGẮN GỌN (mỗi ý ≤ 1-2 câu).
"chưa nhập" = học sinh chưa điền điểm, KHÔNG nhận xét là điểm 0. "majors": đúng 6 ngành phù hợp nhất theo điểm hiện tại, khối thi, Holland. "roadmap": 3 mốc tính từ hôm nay. Được dùng **đậm**, không dùng HTML.
CHỈ trả về MỘT object JSON đúng cấu trúc:
${JSON_SCHEMA}`;
}

/* ================= Hàm chính ================= */

/**
 * Tạo lời khuyên hướng nghiệp.
 * @param {object} [opts]
 * @param {(ev: { type: 'progress', html: string } | { type: 'reset' }) => void} [opts.onProgress]
 *   nhận HTML dựng từ phần AI đã viết (để hiện chữ dần), 'reset' khi model đang viết bị hỏng phải đổi model
 * @returns {Promise<{ html: string, source: 'ai' | 'fallback', model?: string, ms: number }>}
 */
async function generateFullAdvice({
    scores = [],
    topMajors = [],
    selectedBlocks,
    selectedBlock,
    hollandScores = {},
    studentClass = '',
    university = '',
    major = '',
}, { onProgress } = {}) {
    const t0 = Date.now();
    scores = Array.isArray(scores) ? scores : [];
    const blocks = Array.isArray(selectedBlocks) ? selectedBlocks : [selectedBlock].filter(Boolean);
    const majorNames = (Array.isArray(topMajors) ? topMajors : [])
        .map(m => (typeof m === 'string' ? m : m?.name))
        .filter(Boolean);
    const ctx = { scores, hollandScores, university, major };
    const input = { scores, majorNames, blocks, hollandScores, studentClass, university, major };

    const fallback = reason => {
        console.error(`AI: ${reason} → dùng lời khuyên mẫu`);
        return {
            html: renderAdvice(buildRuleBasedAdvice(input), { ...ctx, isFallback: true }),
            source: 'fallback',
            ms: Date.now() - t0,
        };
    };

    if (!getApiKeys().length) return fallback('chưa cấu hình OPENROUTER_API_KEY_*');

    const messages = [
        { role: 'system', content: 'Bạn là chuyên gia tư vấn hướng nghiệp cho học sinh THPT Việt Nam. Luôn trả lời bằng tiếng Việt và CHỈ trả về JSON hợp lệ.' },
        { role: 'user', content: buildPrompt(input) },
    ];

    const queue = await rankModels();
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
            const model = queue.shift();
            if (!model) return null;
            if (deadModels.has(model) || health(model).cooldownUntil > Date.now()) continue;

            for (const key of availableKeys()) {
                if (winner || Date.now() > deadline) return null;
                const ac = new AbortController();
                laneControllers[laneId].add(ac);
                const started = Date.now();
                const onText = raw => {
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
                    const data = await callModel(key, model, messages, ac.signal, onText);
                    laneControllers[laneId].delete(ac);
                    if (winner) return null;
                    winner = { data, model };
                    markSuccess(model, Date.now() - started);
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
                        keyBlockedUntil.set(key, nextUtcMidnight());
                        continue; // thử key khác cùng model
                    }
                    if (kind === 'key-invalid') {
                        keyBlockedUntil.set(key, Date.now() + 24 * 60 * 60 * 1000);
                        continue;
                    }
                    if (kind === 'model-dead') deadModels.add(model);
                    else if (kind === 'overloaded' || kind === 'bad-output') markOverloaded(model); // nghẽn hoặc trả JSON hỏng → tạm nghỉ
                    break; // lỗi do model (quá tải / chết / output kém / timeout) → đổi model
                }
            }
            if (!availableKeys().length) return null; // hết key
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
    const keys = getApiKeys();
    const now = Date.now();
    const models = await getModelList();
    return {
        totalKeys: keys.length,
        availableKeys: keys.filter(k => (keyBlockedUntil.get(k) || 0) <= now).length,
        blockedKeys: keys
            .filter(k => (keyBlockedUntil.get(k) || 0) > now)
            .map(k => ({ key: mask(k), until: new Date(keyBlockedUntil.get(k)).toISOString() })),
        models: models.map(m => {
            const h = health(m);
            return {
                model: m,
                dead: deadModels.has(m),
                coolingDownFor: h.cooldownUntil > now ? Math.round((h.cooldownUntil - now) / 1000) : 0,
                avgMs: h.avgMs,
                successes: h.ok,
            };
        }),
    };
}

module.exports = { generateFullAdvice, getAiStatus, parseAdviceJson, parsePartialJson, buildPrompt }; // buildPrompt: để đo/kiểm thử prompt
