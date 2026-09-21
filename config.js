'use strict';

require('dotenv').config();

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const ADMIN_RAW = (process.env.ADMIN_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error('❌ .env faylida BOT_TOKEN topilmadi.');
  process.exit(1);
}
if (!AI_API_KEY) {
  console.error('❌ .env faylida AI_API_KEY topilmadi.');
  process.exit(1);
}

const ADMIN_IDS = new Set(ADMIN_RAW.filter((v) => /^\d+$/.test(v)));
const ADMIN_USERNAMES = new Set(
  ADMIN_RAW.filter((v) => !/^\d+$/.test(v)).map((v) => v.replace(/^@/, '').toLowerCase())
);

if (ADMIN_IDS.size === 0 && ADMIN_USERNAMES.size === 0) {
  console.warn('⚠️ ADMIN_ID belgilanmagan. Admin panel hech kimga ochilmaydi.');
}

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
  BOT_TOKEN,
  AI_API_KEY,
  ADMIN_IDS,
  ADMIN_USERNAMES,
  AI_MODEL: (process.env.AI_MODEL || 'claude-sonnet-5').trim(),
  AI_MAX_TOKENS: num(process.env.AI_MAX_TOKENS, 1024),
  AI_TIMEOUT_MS: num(process.env.AI_TIMEOUT_MS, 60000),
  HISTORY_LIMIT: Math.max(2, Math.floor(num(process.env.HISTORY_LIMIT, 20) / 2) * 2),
};
