// src/helpers/aiProviders.js
// Danh sách nhà cung cấp AI (đều có API chuẩn OpenAI) + tự dò model + quản lý key/quota.
// Thêm key vào .env là dùng được; nhà cung cấp chưa có key tự bị bỏ qua.
//
// Thứ tự thử mặc định = chất lượng tiếng Việt từ tốt → kém (đổi bằng AI_PROVIDERS="gemini,alibaba,..." trong .env):
//   Gemini → Groq → OpenRouter → Z.ai (GLM) → LongCat → Vercel AI Gateway → Cloudflare → Alibaba Qwen → custom
// Mỗi nơi có giới hạn lượt/phút (rpm) + số request song song (maxInFlight): nơi tốt kín lượt thì
// request kế tiếp tự chảy sang nơi kế tiếp thay vì bị 429 (xem tryAcquire / slotInfo).
// (GitHub Models đã bị GitHub ngừng hoàn toàn từ 30/07/2026 nên không còn trong danh sách)
// Mỗi nhà cung cấp có thể có nhiều key: <TÊN>_API_KEY, <TÊN>_API_KEY_2, ... (tự xoay vòng).
const axios = require('axios');

const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;
// Nguyên tắc: quota THEO NGÀY dùng trước (không dùng là mất), xếp theo chất lượng tiếng Việt;
// rồi tới credit THEO THÁNG (Vercel); quota MỘT LẦN (Alibaba) để dành cuối cùng.
// Cloudflare reset theo ngày nhưng Llama viết tiếng Việt kém → chỉ đứng trên Alibaba.
const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'zai', 'longcat', 'vercel', 'cloudflare', 'alibaba', 'custom'];

/* ================= Thời điểm reset quota ================= */

function nextUtcMidnight() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
}

/** Nửa đêm giờ Thái Bình Dương (Google reset quota free theo giờ PT ≈ 14–15h giờ VN) */
function nextPacificMidnight() {
    const now = new Date();
    const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const next = new Date(pt);
    next.setHours(24, 0, 0, 0);
    return now.getTime() + (next.getTime() - pt.getTime());
}

/** Nửa đêm giờ Bắc Kinh (UTC+8 = 23h giờ VN) */
function nextBeijingMidnight() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime() - 8 * 60 * 60 * 1000;
}

/* ================= Danh sách nhà cung cấp ================= */
// prefer: regex theo thứ tự ưu tiên (model khớp regex đứng trước được thử trước)
// dailyScope: quota ngày tính theo 'key' (cả tài khoản) hay theo 'model' (mỗi model một hạn mức riêng)
// rpm / rpmScope: số request/phút cho phép, tính theo 'key' hay từng 'model' (ghi đè bằng <TÊN>_RPM trong .env)
// maxInFlight: số request chạy cùng lúc tối đa trên 1 key (0 = không giới hạn)

const PROVIDERS = {
    gemini: {
        label: 'Google Gemini (AI Studio)',
        baseURL: () => 'https://generativelanguage.googleapis.com/v1beta/openai/',
        keyEnv: 'GEMINI_API_KEY',
        defaults: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        discover: true,
        prefer: [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash-latest$/, /^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash/],
        exclude: /image|tts|audio|live|embed|vision|aqa|gemma|learnlm|robotics|computer-use|native|thinking-exp|pro/i,
        maxModels: 3,
        json: true,
        reasoning: { reasoning_effort: 'none' }, // tắt "suy nghĩ" → ra chữ nhanh (model không cho tắt thì tự gọi lại không kèm)
        dailyScope: 'model',
        dailyReset: nextPacificMidnight,
        rpm: 5, rpmScope: 'model', // free: 5 lượt/phút, 20 lượt/ngày mỗi model (AI Studio → Rate limits)
    },
    alibaba: {
        // Alibaba Cloud Model Studio (vùng Singapore): ~1 triệu token free cho MỖI model, dùng trong 90 ngày.
        // NHỚ bật "Free quota only" trong console để hết quota không bị tính tiền.
        label: 'Alibaba Qwen (Model Studio)',
        baseURL: () => 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        keyEnv: 'DASHSCOPE_API_KEY',
        defaults: ['qwen-plus', 'qwen-flash', 'qwen-turbo'],
        discover: true,
        prefer: [/^qwen3[\d.]*-plus$/, /^qwen-plus$/, /^qwen3[\d.]*-flash$/, /^qwen-flash$/, /^qwen-turbo$/, /^qwen3[\d.]*-max$/, /^qwen-max$/],
        exclude: /vl|audio|omni|coder|math|embed|tts|asr|mt-|image|ocr|realtime|research|long|character|translate|\d{4}-\d{2}-\d{2}|latest|preview|thinking|instruct|-\d+b/i,
        maxModels: 5, // mỗi model có quota free riêng → nhiều model = nhiều lượt
        json: true,
        reasoning: { enable_thinking: false }, // Qwen3 mặc định có thể "suy nghĩ" → tắt cho nhanh
        dailyScope: 'model',
        dailyReset: () => Date.now() + 60 * 60 * 1000,
        rpm: 60, rpmScope: 'model',
    },
    longcat: {
        // LongCat (Meituan) – quota token free mỗi ngày (khoảng 500k token ≈ 100 bài), reset theo giờ Bắc Kinh
        label: 'LongCat (Meituan)',
        baseURL: () => 'https://api.longcat.chat/openai/v1',
        keyEnv: 'LONGCAT_API_KEY',
        defaults: ['LongCat-Flash-Chat', 'LongCat-2.0'],
        discover: true,
        prefer: [/flash-chat/i, /^longcat-2\.\d+$/i, /^longcat-2/i, /flash/i],
        exclude: /thinking|omni|audio|image|video|lite/i,
        maxModels: 3,
        json: true,
        reasoning: { thinking: { type: 'disabled' } },
        dailyScope: 'key',
        dailyReset: nextBeijingMidnight,
        rpm: 20, rpmScope: 'key',
        maxInFlight: 3,
    },
    vercel: {
        // Vercel AI Gateway – $5 credit free mỗi 30 ngày (KHÔNG mua credit / gắn thẻ, nếu không sẽ mất gói free).
        // Gói free chỉ mở 1 phần model (DeepSeek, GLM bị chặn). Đo thực tế 23/11/2026:
        //   gemini-2.5-flash-lite: chữ đầu 1s, xong 5s, ≈ $0.0007/bài → $5 ≈ 5.000–7.000 bài/tháng
        //   gpt-oss-120b: chữ đầu 7s, xong 13s, ≈ $0.0015/bài
        //   (qwen3.7-flash chạy được nhưng "suy nghĩ" lâu ~60s → không dùng)
        label: 'Vercel AI Gateway',
        baseURL: () => 'https://ai-gateway.vercel.sh/v1',
        keyEnv: 'AI_GATEWAY_API_KEY',
        defaults: ['google/gemini-2.5-flash-lite', 'openai/gpt-oss-120b'],
        discover: false,
        json: true,
        reasoning: { reasoning_effort: 'low' },
        reasoningOnly: /gpt-oss/,
        dailyScope: 'key', // hết credit tháng → 402 → nghỉ tới hôm sau thử lại
        dailyReset: nextUtcMidnight,
        rpm: 30, rpmScope: 'key',
    },
    groq: {
        label: 'Groq',
        baseURL: () => 'https://api.groq.com/openai/v1',
        keyEnv: 'GROQ_API_KEY',
        defaults: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'],
        discover: true,
        prefer: [/gpt-oss-120b/, /kimi-k2/, /llama-3\.3-70b/, /llama-4-maverick/, /qwen3?-32b/, /gpt-oss-20b/],
        exclude: /whisper|tts|guard|compound|embed|playai|distil|8b|safeguard|orpheus|prompt/i,
        maxModels: 4,
        json: true,
        reasoning: { reasoning_effort: 'low' }, // chỉ áp dụng cho model hỗ trợ (gpt-oss), model khác tự bỏ
        reasoningOnly: /gpt-oss|qwen3/,
        dailyScope: 'model',
        dailyReset: () => Date.now() + 60 * 60 * 1000, // Groq tính cửa sổ trượt → thử lại sau 1 giờ
        rpm: 30, rpmScope: 'model',
    },
    openrouter: {
        label: 'OpenRouter',
        baseURL: () => 'https://openrouter.ai/api/v1',
        keyEnv: 'OPENROUTER_API_KEY',
        defaults: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free'],
        discover: true, // dò riêng: chỉ lấy model miễn phí (xem discoverOpenRouter)
        prefer: [/gemma-4-31b/, /gemma-4-26b/, /nemotron-3-ultra/, /nemotron/, /./],
        maxModels: 8,
        json: true,
        reasoning: { reasoning: { enabled: false } },
        dailyScope: 'key', // free-models-per-day tính theo tài khoản
        dailyReset: nextUtcMidnight,
        rpm: 20, rpmScope: 'key', // 20 lượt/phút cho model :free (kể cả sau khi nạp 10 credits)
    },
    zai: {
        label: 'Z.ai (GLM)',
        baseURL: () => 'https://api.z.ai/api/paas/v4',
        keyEnv: 'ZAI_API_KEY',
        defaults: ['glm-4.5-flash', 'glm-4.7-flash'], // model "flash" miễn phí; 4.5 ra chữ ngay, 4.7 hay chậm >12s (đo thực tế)
        discover: false,
        json: true,
        reasoning: { thinking: { type: 'disabled' } }, // GLM mặc định bật suy nghĩ → tắt để ra chữ nhanh
        dailyScope: 'key',
        dailyReset: () => Date.now() + 60 * 60 * 1000,
        rpm: 30, rpmScope: 'key',
        maxInFlight: 2, // model flash free chỉ cho vài request song song
    },
    cloudflare: {
        label: 'Cloudflare Workers AI',
        baseURL: () => (process.env.CLOUDFLARE_ACCOUNT_ID
            ? `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID.trim()}/ai/v1`
            : null),
        keyEnv: 'CLOUDFLARE_API_TOKEN',
        defaults: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
        discover: false,
        json: true, // JSON mode chạy được cả khi stream (đo thực tế); không bật thì Llama hay viết sai tên trường
        dailyScope: 'key', // 10.000 neurons/ngày cho cả tài khoản
        dailyReset: nextUtcMidnight,
        rpm: 60, rpmScope: 'key',
        maxInFlight: 4,
    },
    custom: {
        // Bất kỳ API chuẩn OpenAI nào khác (VD Ollama tự host): AI_CUSTOM_BASE_URL, AI_CUSTOM_API_KEY, AI_CUSTOM_MODELS
        label: 'Tuỳ chỉnh (OpenAI-compatible)',
        baseURL: () => (process.env.AI_CUSTOM_BASE_URL || '').trim() || null,
        keyEnv: 'AI_CUSTOM_API_KEY',
        defaults: [],
        discover: false,
        json: false,
        dailyScope: 'key',
        dailyReset: () => Date.now() + 60 * 60 * 1000,
    },
};

/* ================= Key ================= */

/** Mọi biến <KEY_ENV>, <KEY_ENV>_1, _2, ... (OpenRouter dùng OPENROUTER_API_KEY_1.. như cũ) */
function providerKeys(id) {
    const p = PROVIDERS[id];
    if (!p) return [];
    const re = new RegExp(`^${p.keyEnv}(_\\d+)?$`);
    return Object.keys(process.env)
        .filter(k => re.test(k))
        .sort((a, b) => (parseInt(a.split('_').pop(), 10) || 0) - (parseInt(b.split('_').pop(), 10) || 0))
        .map(k => (process.env[k] || '').trim())
        .filter(Boolean);
}

/** Nhà cung cấp đã cấu hình (có key + có địa chỉ), theo thứ tự ưu tiên */
function activeProviders() {
    const order = (process.env.AI_PROVIDERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return (order.length ? order : DEFAULT_ORDER).filter(id => PROVIDERS[id] && PROVIDERS[id].baseURL() && providerKeys(id).length);
}

// Khoá key/model đã hết quota: key (phạm vi tài khoản) hoặc `${key}|${model}` (phạm vi từng model)
const blockedUntil = new Map();
const cursors = new Map();

function blockForDay(providerId, key, model) {
    const p = PROVIDERS[providerId];
    const until = (p.dailyReset || nextUtcMidnight)();
    blockedUntil.set(p.dailyScope === 'model' ? `${key}|${model}` : key, until);
}

function blockKey(key, ms) {
    blockedUntil.set(key, Date.now() + ms);
}

const isBlocked = name => (blockedUntil.get(name) || 0) > Date.now();

/** Key còn dùng được cho (nhà cung cấp, model), xoay vòng để chia đều quota */
function availableKeysFor(providerId, model) {
    const keys = providerKeys(providerId).filter(k => !isBlocked(k) && !isBlocked(`${k}|${model}`));
    if (!keys.length) return [];
    const c = (cursors.get(providerId) || 0);
    cursors.set(providerId, c + 1);
    const start = c % keys.length;
    return [...keys.slice(start), ...keys.slice(0, start)];
}

/** Khoá riêng 1 model trên 1 key (VD Alibaba: model đó đã dùng hết quota free) */
function blockModelForKey(key, model, ms) {
    blockedUntil.set(`${key}|${model}`, Date.now() + ms);
}

/* ================= Giới hạn lượt/phút + song song ================= */
// Cửa sổ trượt 60s: bucket -> [thời điểm gửi]. Đếm cả request lỗi (nhà cung cấp cũng đếm).

const RPM_WINDOW_MS = 61 * 1000; // dư 1s so với cửa sổ của nhà cung cấp (đồng hồ hai bên lệch nhau vài ms)
const sentAt = new Map();
const inFlight = new Map();

function limitsOf(providerId) {
    const p = PROVIDERS[providerId];
    const fromEnv = Number(process.env[`${providerId.toUpperCase()}_RPM`]);
    return { rpm: fromEnv > 0 ? fromEnv : (p.rpm || 0), maxInFlight: p.maxInFlight || 0 };
}

const rpmBucket = (providerId, key, model) =>
    (PROVIDERS[providerId].rpmScope === 'model' ? `${providerId}|${key}|${model}` : `${providerId}|${key}`);

/** { bucket, free: số lượt gửi được ngay, waitMs: còn bao lâu thì có lượt (0 nếu đang có) } */
function slotInfo(providerId, key, model) {
    const { rpm, maxInFlight } = limitsOf(providerId);
    const bucket = rpmBucket(providerId, key, model);
    const now = Date.now();
    let free = Infinity;
    let waitMs = 0;
    if (rpm) {
        const list = (sentAt.get(bucket) || []).filter(t => now - t < RPM_WINDOW_MS);
        sentAt.set(bucket, list);
        free = rpm - list.length;
        if (free <= 0) waitMs = list[0] + RPM_WINDOW_MS - now;
    }
    if (maxInFlight) {
        const busy = inFlight.get(`${providerId}|${key}`) || 0;
        free = Math.min(free, maxInFlight - busy);
        if (busy >= maxInFlight) waitMs = Math.max(waitMs, 1000);
    }
    free = Math.max(0, free);
    return { bucket, free, waitMs: free > 0 ? 0 : Math.max(waitMs, 250) };
}

/** Giữ 1 lượt nếu còn → trả về release() (gọi khi request xong), hoặc null nếu đang kín lượt */
function tryAcquire(providerId, key, model) {
    const info = slotInfo(providerId, key, model);
    if (info.free <= 0) return null;
    if (limitsOf(providerId).rpm) sentAt.get(info.bucket).push(Date.now());
    const k = `${providerId}|${key}`;
    inFlight.set(k, (inFlight.get(k) || 0) + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        inFlight.set(k, Math.max(0, (inFlight.get(k) || 1) - 1));
    };
}

/* ================= Dò model ================= */

const modelCache = new Map(); // providerId -> { at, list }
// Khả năng riêng từng model OpenRouter (lấy từ danh sách model của họ)
const openRouterCaps = { json: new Set(), reasoning: new Set() };

function versionOf(id) {
    const m = String(id).match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : 0;
}

function rankByPreference(ids, prefer = []) {
    const rank = id => {
        const i = prefer.findIndex(re => re.test(id));
        return i < 0 ? prefer.length : i;
    };
    return [...ids].sort((a, b) => rank(a) - rank(b) || versionOf(b) - versionOf(a) || a.localeCompare(b));
}

async function discoverOpenRouter() {
    const { data } = await axios.get('https://openrouter.ai/api/v1/models', { timeout: 15000 });
    return (data?.data || [])
        .filter(m => {
            const free = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
            const arch = m.architecture || {};
            const textIn = (arch.input_modalities || []).includes('text');
            const textOutOnly = JSON.stringify(arch.output_modalities || []) === '["text"]';
            const notCodeOrTiny = !/code|coder|1\.7b|\b[1-4]b\b/i.test(m.id);
            const params = m.supported_parameters || [];
            if (params.includes('response_format')) openRouterCaps.json.add(m.id);
            if (params.includes('reasoning')) openRouterCaps.reasoning.add(m.id);
            return free && textIn && textOutOnly && notCodeOrTiny;
        })
        .map(m => m.id);
}

/**
 * Dò model bằng GET /models. Đồng thời kiểm tra từng key: key bị từ chối (400/401/403) bị đánh dấu sai
 * và bỏ qua 24 giờ (Google trả 400 không kèm lý do khi stream bằng key sai → phải phát hiện ở đây).
 */
async function discoverOpenAICompatible(providerId) {
    const p = PROVIDERS[providerId];
    let lastErr = null;
    for (const key of providerKeys(providerId)) {
        if (isBlocked(key)) continue;
        try {
            const { data } = await axios.get(`${p.baseURL().replace(/\/$/, '')}/models`, {
                timeout: 15000,
                headers: { Authorization: `Bearer ${key}` },
            });
            return (data?.data || [])
                .map(m => String(m.id || '').replace(/^models\//, ''))
                .filter(id => id && !(p.exclude && p.exclude.test(id)));
        } catch (err) {
            lastErr = err;
            const status = err.response?.status;
            if ([400, 401, 403].includes(status)) {
                blockKey(key, 24 * 60 * 60 * 1000);
                console.error(`AI: key ${p.label} ${key.slice(0, 8)}…${key.slice(-4)} bị từ chối (${status}) – kiểm tra lại key trong .env`);
            }
        }
    }
    throw lastErr || new Error('không có key dùng được');
}

/** Model sẽ thử của 1 nhà cung cấp (cache 6 giờ). <TÊN>_MODELS="a,b" trong .env để chỉ định cố định. */
async function providerModels(providerId) {
    const p = PROVIDERS[providerId];
    const envName = providerId === 'custom' ? 'AI_CUSTOM_MODELS' : providerId === 'openrouter' ? 'AI_MODELS' : `${providerId.toUpperCase()}_MODELS`;
    const fromEnv = (process.env[envName] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;

    const cached = modelCache.get(providerId);
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.list;

    let list = p.defaults;
    if (p.discover) {
        try {
            const found = providerId === 'openrouter' ? await discoverOpenRouter() : await discoverOpenAICompatible(providerId);
            if (found.length) {
                const ranked = rankByPreference(found, p.prefer);
                // OpenRouter: model mặc định chỉ giữ nếu còn miễn phí; luôn có openrouter/free ở cuối
                list = providerId === 'openrouter'
                    ? [...new Set([...p.defaults.filter(m => found.includes(m) && m !== 'openrouter/free'), ...ranked.filter(m => m !== 'openrouter/free')])]
                        .slice(0, p.maxModels).concat('openrouter/free')
                    : ranked.slice(0, p.maxModels || 3);
            }
        } catch (err) {
            console.error(`AI: không dò được model ${p.label}: ${err.response?.status || ''} ${err.message}`);
        }
    }
    modelCache.set(providerId, { at: Date.now(), list });
    console.log(`AI models [${providerId}]:`, list.join(', '));
    return list;
}

/** Tham số riêng của nhà cung cấp cho 1 lần gọi */
function requestParams(providerId, model) {
    const p = PROVIDERS[providerId];
    const extra = {};
    const jsonOk = providerId === 'openrouter' ? openRouterCaps.json.has(model) : p.json;
    if (jsonOk) extra.response_format = { type: 'json_object' };
    const reasoningOk = providerId === 'openrouter'
        ? openRouterCaps.reasoning.has(model)
        : p.reasoning && (!p.reasoningOnly || p.reasoningOnly.test(model));
    if (reasoningOk && p.reasoning) Object.assign(extra, p.reasoning);
    return extra;
}

module.exports = {
    PROVIDERS,
    activeProviders,
    providerKeys,
    providerModels,
    availableKeysFor,
    blockForDay,
    blockKey,
    blockModelForKey,
    isBlocked,
    slotInfo,
    tryAcquire,
    requestParams,
    blockedUntil,
};
