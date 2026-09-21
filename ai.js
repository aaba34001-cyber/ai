'use strict';

const config = require('./config');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT =
  'Sen Telegram botidagi foydalanuvchilarga yordam beradigan aqlli AI yordamchisan. ' +
  'Foydalanuvchi qaysi tilda yozsa, shu tilda javob ber (asosan o‘zbek tilida). ' +
  'Javoblarni aniq, foydali va qisqa yoz. ' +
  'Telegram matn ko‘rinishida chiqadi, shuning uchun Markdown belgilaridan (**, #, ``` ) foydalanma, oddiy matn yoz. ' +
  'Kod yozsang ham oddiy matn sifatida, tushunarli qilib yoz.';

class AIError extends Error {
  constructor(userMessage, cause, retryable = false) {
    super(userMessage);
    this.name = 'AIError';
    this.userMessage = userMessage;
    this.cause = cause;
    this.retryable = retryable;
  }
}

class ThinkingUnsupported extends Error {}

const MODELS = [
  ...new Set(
    [config.AI_MODEL, ...(process.env.AI_FALLBACK || '').split(',')].map((s) => s.trim()).filter(Boolean)
  ),
];

// Tezlik uchun "o‘ylash"ni o‘chirish variantlari. Har model qabul qilganini eslab qoladi.
const THINKING_OPTIONS = [{ thinkingLevel: 'minimal' }, { thinkingBudget: 0 }, null];
const thinkingIdx = new Map();

function messageForStatus(status, detail) {
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(detail))) {
    return '🔑 AI kaliti noto‘g‘ri yoki ruxsat yo‘q. Iltimos, admin bilan bog‘laning.';
  }
  if (status === 404) return '⚙️ AI modeli topilmadi. Iltimos, admin bilan bog‘laning.';
  if (status === 413) return '📏 Savol juda uzun. Qisqaroq yozib ko‘ring.';
  if (status === 429) return '🚦 So‘rovlar limiti tugadi. Bir ozdan keyin qayta urinib ko‘ring.';
  if (status >= 500) return '🛠 AI xizmati hozir band yoki ishlamayapti. Birozdan keyin urinib ko‘ring.';
  return '⚠️ AI so‘rovini bajarib bo‘lmadi. Keyinroq qayta urinib ko‘ring.';
}

async function request(model, history, userText, thinking, onText) {
  const contents = [...history, { role: 'user', content: userText }].map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const generationConfig = { maxOutputTokens: config.AI_MAX_TOKENS };
  if (thinking) generationConfig.thinkingConfig = thinking;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.AI_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.AI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig,
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = null;
      }
      const detail = data && data.error ? `${data.error.status}: ${data.error.message}` : raw.slice(0, 300);
      if (res.status === 400 && thinking && /think/i.test(detail)) throw new ThinkingUnsupported();
      console.error(`[ai] ${model} HTTP ${res.status} — ${detail.slice(0, 200)}`);
      const retryable = [404, 429, 500, 502, 503, 504].includes(res.status);
      throw new AIError(messageForStatus(res.status, detail), null, retryable);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
          const add = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
          if (add) {
            full += add;
            if (onText) onText(full);
          }
        } catch (_) {
          /* to‘liq bo‘lmagan qator, o‘tkazib yuboramiz */
        }
      }
    }

    const text = full.trim();
    if (!text) throw new AIError('🤔 AI bo‘sh javob qaytardi. Savolni boshqacha yozib ko‘ring.', null, true);
    return text;
  } catch (err) {
    if (err instanceof AIError || err instanceof ThinkingUnsupported) throw err;
    if (err && err.name === 'AbortError') {
      throw new AIError('⌛ AI javob berishga ulgurmadi. Birozdan keyin qayta urinib ko‘ring.', err, true);
    }
    console.error(`[ai] ${model} tarmoq xatosi:`, err && err.message ? err.message : err);
    throw new AIError('🌐 AI xizmatiga ulanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.', err, true);
  } finally {
    clearTimeout(timer);
  }
}

async function askModel(model, history, userText, onText) {
  for (let i = thinkingIdx.get(model) || 0; i < THINKING_OPTIONS.length; i++) {
    try {
      const text = await request(model, history, userText, THINKING_OPTIONS[i], onText);
      thinkingIdx.set(model, i);
      return text;
    } catch (err) {
      if (err instanceof ThinkingUnsupported) continue;
      throw err;
    }
  }
  throw new AIError('⚠️ AI so‘rovini bajarib bo‘lmadi. Keyinroq qayta urinib ko‘ring.', null, true);
}

async function askAI(history, userText, onText) {
  let lastErr = null;
  for (const model of MODELS) {
    try {
      return await askModel(model, history, userText, onText);
    } catch (err) {
      lastErr = err;
      if (err instanceof AIError && err.retryable) {
        console.error(`[ai] ${model} ishlamadi, keyingi modelga o‘tilmoqda...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new AIError('⚠️ AI so‘rovini bajarib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
}

module.exports = { askAI, AIError };
