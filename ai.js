const config = require('./config');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

class AIError extends Error {
  constructor(userMessage, cause = null, retryable = false) {
    super(userMessage);
    this.name = 'AIError';
    this.userMessage = userMessage;
    this.cause = cause;
    this.retryable = retryable;
  }
}

const SYSTEM_PROMPT = `
Sen Telegramdagi AI yordamchisan.
Foydalanuvchi qaysi tilda yozsa, o‘sha tilda javob ber.
Javobni aniq, foydali va tushunarli ber.
`;

const MODELS = [
  config.AI_MODEL,
  ...(config.AI_FALLBACK || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
].filter(Boolean);

function messageForStatus(status) {
  if (status === 400) return '⚠️ AI so‘rovi noto‘g‘ri.';
  if (status === 401 || status === 403) {
    return '🔑 AI API kaliti noto‘g‘ri yoki ruxsatsiz.';
  }
  if (status === 404) {
    return '⚙️ AI modeli topilmadi. Keyingi model sinab ko‘rilmoqda.';
  }
  if (status === 413) return '📏 Savol juda uzun. Qisqaroq yozib ko‘ring.';
  if (status === 429) return '🚦 AI limiti tugadi.';
  if (status >= 500) return '🛠 AI xizmati vaqtincha band.';
  return '⚠️ AI so‘rovini bajarib bo‘lmadi.';
}

async function request(model, history, userText) {
  const contents = [
    ...history,
    { role: 'user', content: userText }
  ].map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.AI_TIMEOUT_MS || 20000
  );

  try {
    const url =
      `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.AI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: config.AI_MAX_TOKENS || 1024
        }
      }),
      signal: controller.signal
    });

    const raw = await res.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!res.ok) {
      const detail =
        data?.error?.message ||
        raw.slice(0, 300);

      console.error(
        `[ai] ${model} HTTP ${res.status} — ${detail}`
      );

      throw new AIError(
        messageForStatus(res.status),
        new Error(detail),
        [404, 429, 500, 502, 503, 504].includes(res.status)
      );
    }

    const parts =
      data?.candidates?.[0]?.content?.parts || [];

    const text = parts
      .map(p => p.text || '')
      .join('')
      .trim();

    if (!text) {
      console.error(
        `[ai] ${model} bo‘sh javob:`,
        raw.slice(0, 500)
      );

      throw new AIError(
        '🤔 AI bo‘sh javob qaytardi.',
        null,
        true
      );
    }

    console.log(`✅ AI ishladi: ${model}`);

    return text;

  } catch (err) {
    if (err instanceof AIError) {
      throw err;
    }

    if (err?.name === 'AbortError') {
      throw new AIError(
        '⌛ AI javob berishga ulgurmadi.',
        err,
        true
      );
    }

    console.error(
      `[ai] ${model} tarmoq xatosi:`,
      err?.message || err
    );

    throw new AIError(
      '🌐 AI xizmatiga ulanib bo‘lmadi.',
      err,
      true
    );

  } finally {
    clearTimeout(timer);
  }
}

async function askAI(history, userText, onText) {
  let lastError = null;

  for (const model of MODELS) {
    try {
      const answer = await request(
        model,
        history,
        userText
      );

      if (onText) {
        onText(answer);
      }

      return answer;

    } catch (err) {
      lastError = err;

      console.error(
        `[ai] ${model} ishlamadi, keyingi modelga o‘tilmoqda...`
      );

      if (!err.retryable) {
        throw err;
      }
    }
  }

  throw lastError || new AIError(
    '⚠️ AI so‘rovini bajarib bo‘lmadi.'
  );
}

module.exports = {
  askAI,
  AIError
};
