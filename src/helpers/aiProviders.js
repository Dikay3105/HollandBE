// src/helpers/aiProviders.js
// Danh sách nhà cung cấp AI (đều có API chuẩn OpenAI) + tự dò model + quản lý key/quota.
// Thêm key vào .env là dùng được; nhà cung cấp chưa có key tự bị bỏ qua.
//
// Thứ tự thử mặc định (đổi bằng AI_PROVIDERS="gemini,groq,..." trong .env):
//   Gemini → Groq → Cerebras → OpenRouter → Mistral → Cloudflare → custom
// (GitHub Models đã bị GitHub ngừng hoàn toàn từ 30/07/2026 nên không còn trong danh sách)
// Mỗi nhà cung cấp có thể có nhiều key: <TÊN>_API_KEY, <TÊN>_API_KEY_2, ... (tự xoay vòng).
const axios = require('axios');

const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ORDER = ['gemini', 'groq', 'cerebras', 'openrouter', 'mistral', 'cloudflare', 'custom'];

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

/* ================= Danh sách nhà cung cấp ================= */
// prefer: regex theo thứ tự ưu tiên (model khớp regex đứng trước được thử trước)
// dailyScope: quota ngày tính theo 'key' (cả tài khoản) hay theo 'model' (mỗi model một hạn mức riêng)

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
    },
    cerebras: {
        label: 'Cerebras',
        baseURL: () => 'https://api.cerebras.ai/v1',
        keyEnv: 'CEREBRAS_API_KEY',
        defaults: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507'],
        discover: true,
        prefer: [/gpt-oss-120b/, /qwen-3-235b/, /llama-3\.3-70b/, /llama-4/, /qwen-3-32b/],
        exclude: /8b|embed|coder/i,
        maxModels: 3,
        json: true,
        reasoning: { reasoning_effort: 'low' },
        reasoningOnly: /gpt-oss/,
        dailyScope: 'model',
        dailyReset: () => Date.now() + 60 * 60 * 1000,
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
    },
    mistral: {
        label: 'Mistral (La Plateforme)',
        baseURL: () => 'https://api.mistral.ai/v1',
        keyEnv: 'MISTRAL_API_KEY',
        defaults: ['mistral-medium-latest', 'mistral-small-latest'],
        discover: false,
        json: true,
        dailyScope: 'key',
        dailyReset: () => Date.now() + 60 * 60 * 1000,
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
    isBlocked,
    requestParams,
    blockedUntil,
};
