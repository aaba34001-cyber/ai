'use strict';

try {
  require('dotenv').config();
} catch (_) {
  /* dotenv yo‘q bo‘lsa, config.js o‘zi yuklaydi */
}
const config = require('./config');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const API_KEY = config.AI_API_KEY || process.env.AI_API_KEY;
const TIMEOUT_MS = Number(config.AI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS) || 30000;
const MAX_TOKENS = Number(config.AI_MAX_TOKENS || process.env.AI_MAX_TOKENS) || 2048;

const MODELS = [config.AI_MODEL || process.env.AI_MODEL]
  .concat(String(process.env.AI_FALLBACK || '').split(','))
  .map((s) => String(s || '').trim())
  .filter(Boolean)
  .filter((m, i, arr) => arr.indexOf(m) === i);

const SYSTEM_PROMPT =
  'Sen Telegramdagi foydali AI yordamchisan. Foydalanuvchi qaysi tilda yozsa, shu tilda ' +
  '(asosan o‘zbekcha) aniq va qisqa javob ber. Faqat yakuniy javobni yoz, ichki tahlil yoki ' +
  'fikrlaringni yozma. Javobni 3500 belgidan oshirma.';

class AIError extends Error {
  constructor(userMessage, cause, retryable, status) {
    super(userMessage);
    this.name = 'AIError';
    this.userMessage = userMessage;
    this.cause = cause;
    this.retryable = retryable === true;
    this.status = status;
  }
}

function messageForStatus(status) {
  if (status === 400) return '⚙️ AI so‘rovi qabul qilinmadi. Savolni boshqacha yozib ko‘ring.';
  if (status === 401 || status === 403) return '🔑 AI kaliti xato yoki ruxsat yo‘q. Iltimos, admin bilan bog‘laning.';
  if (status === 404) return '⚙️ AI modeli topilmadi. Iltimos, admin bilan bog‘laning.';
  if (status === 413) return '📏 Savol juda uzun. Qisqaroq yozib ko‘ring.';
  if (status === 429) return '🚦 So‘rovlar limiti tugadi. Bir ozdan keyin qayta urinib ko‘ring.';
  if (status >= 500) return '🛠 AI xizmati hozir band. Birozdan keyin urinib ko‘ring.';
  return '⚠️ AI so‘rovini bajarib bo‘lmadi. Keyinroq qayta urinib ko‘ring.';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(model, contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }

    if (res.ok === false) {
      const detail = data && data.error ? `${data.error.status}: ${data.error.message}` : raw;
      console.error(`[ai] ${model} HTTP ${res.status} — ${String(detail).slice(0, 200)}`);
      throw new AIError(messageForStatus(res.status), null, res.status !== 413, res.status);
    }

    const cand = data && data.candidates && data.candidates[0];
    const parts = cand && cand.content && cand.content.parts ? cand.content.parts : [];
    const text = parts
      .filter((p) => p.thought !== true)
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (text === '') {
      throw new AIError('🤔 AI bo‘sh javob qaytardi. Savolni boshqacha yozib ko‘ring.', null, true);
    }
    return text;
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err && err.name === 'AbortError') {
      console.error(`[ai] ${model} vaqt tugadi (${TIMEOUT_MS} ms)`);
      throw new AIError('⌛ AI javob berishga ulgurmadi. Birozdan keyin qayta urinib ko‘ring.', err, true);
    }
    console.error(`[ai] ${model} tarmoq xatosi:`, err && err.message ? err.message : err);
    throw new AIError('🌐 AI xizmatiga ulanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.', err, true);
  } finally {
    clearTimeout(timer);
  }
}

async function askModel(model, contents) {
  try {
    return await callModel(model, contents);
  } catch (err) {
    if (err instanceof AIError && err.status === 503) {
      await sleep(1500);
      return callModel(model, contents);
    }
    throw err;
  }
}

async function askAI(history, userText, onText) {
  const contents = (history || [])
    .concat([{ role: 'user', content: userText }])
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }));

  let lastError = null;

  for (const model of MODELS) {
    try {
      const answer = await askModel(model, contents);
      if (typeof onText === 'function') onText(answer);
      return answer;
    } catch (err) {
      lastError = err;
      if (err instanceof AIError && err.retryable === true) {
        console.error(`[ai] ${model} ishlamadi, keyingi modelga o‘tilmoqda...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new AIError('⚠️ AI so‘rovini bajarib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
}

module.exports = { askAI, AIError };
