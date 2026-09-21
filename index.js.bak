'use strict';

const config = require('./config');
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');
const { askAI, AIError } = require('./ai');

const bot = new Telegraf(config.BOT_TOKEN, { handlerTimeout: 180000 });
const startedAt = Date.now();

/* ====================== Yordamchi funksiyalar ====================== */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);
const logError = (where, err) =>
  console.error(new Date().toISOString(), `[${where}]`, err && err.message ? err.message : err);

async function safe(fn, where = 'safe') {
  try {
    return await fn();
  } catch (err) {
    logError(where, err);
    return null;
  }
}

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function isAdmin(user) {
  if (!user) return false;
  if (config.ADMIN_IDS.has(String(user.id))) return true;
  return !!user.username && config.ADMIN_USERNAMES.has(user.username.toLowerCase());
}

const isPrivate = (ctx) => !!ctx.chat && ctx.chat.type === 'private';
const isGroupChat = (chat) => !!chat && (chat.type === 'group' || chat.type === 'supergroup');

const chatKeyOf = (ctx) =>
  isPrivate(ctx) ? String(ctx.from.id) : `${ctx.chat.id}:${ctx.from.id}`;

function replyExtra(ctx) {
  if (isGroupChat(ctx.chat) && ctx.message) {
    return {
      reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
    };
  }
  return {};
}

function formatDate(iso) {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—';
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d} kun ${h} soat ${m} daqiqa`;
}

function splitText(text, max = 4000) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendLong(ctx, text, extra = {}) {
  const chunks = splitText(text);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i], i === 0 ? extra : {});
  }
}

/* ====================== Matnlar va tugmalar ====================== */

const START_TEXT = '🤖 AI BOT\n\nSalom! Men AI yordamchiman.\nSavolingizni yuboring va javob beraman.';

const HELP_TEXT =
  'ℹ️ Yordam\n\n' +
  '👤 Private chatda:\n' +
  '1) 🤖 AI tugmasini bosing\n' +
  '2) Savolingizni oddiy matn qilib yozing\n' +
  '3) Chiqish uchun ❌ Chiqish tugmasini bosing\n\n' +
  '👥 Guruhda:\n' +
  'AI Python nima?\n' +
  'yoki\n' +
  '/ai Python nima?\n\n' +
  '📋 Buyruqlar:\n' +
  '/start — botni ishga tushirish\n' +
  '/help — yordam\n' +
  '/ai — AI rejimini ochish\n' +
  '/id — ID ni ko‘rsatish\n' +
  '/clear — suhbat kontekstini tozalash';

const mainKeyboard = Markup.keyboard([['🤖 AI', 'ℹ️ Help']]).resize();
const aiKeyboard = Markup.keyboard([['❌ Chiqish']]).resize();

const BTN_AI = '🤖 AI';
const BTN_HELP = 'ℹ️ Help';
const BTN_EXIT = '❌ Chiqish';

// "AI savol", "AI, savol", "ai: savol"
const TRIGGER = /^\s*ai[\s,.:;!?\-–]+([\s\S]+)$/i;

/* ====================== Middleware ====================== */

bot.use(async (ctx, next) => {
  try {
    if (ctx.from && !ctx.from.is_bot) db.upsertUser(ctx.from, isPrivate(ctx));
    if (ctx.chat && isGroupChat(ctx.chat)) db.upsertGroup(ctx.chat);
  } catch (err) {
    logError('middleware', err);
  }
  return next();
});

/* ====================== AI so‘rovi ====================== */

const busy = new Set();

async function handleAsk(ctx, question) {
  question = (question || '').trim();
  if (!question) return;

  if (db.getSetting('ai_enabled', '1') !== '1' && !isAdmin(ctx.from)) {
    return ctx.reply('⏸ AI vaqtincha o‘chirilgan. Keyinroq urinib ko‘ring.', replyExtra(ctx));
  }

  const key = chatKeyOf(ctx);
  if (busy.has(key)) {
    return ctx.reply('⏳ Oldingi savolingizga javob tayyorlanmoqda, biroz kuting.', replyExtra(ctx));
  }
  busy.add(key);

  let waitMsg = null;
  let typingTimer = null;

  try {
    waitMsg = await ctx.reply('⏳ Javob tayyorlanmoqda...', replyExtra(ctx));
    safe(() => ctx.sendChatAction('typing'), 'typing');
    typingTimer = setInterval(() => safe(() => ctx.sendChatAction('typing'), 'typing'), 4000);

    db.incrementMessages(ctx.from.id);
    const history = db.getHistory(key, config.HISTORY_LIMIT);
    const answer = await askAI(history, question);
    db.addExchange(key, question, answer);

    await sendLong(ctx, answer, replyExtra(ctx));
  } catch (err) {
    logError('handleAsk', err);
    const msg =
      err instanceof AIError
        ? err.userMessage
        : '⚠️ Kutilmagan xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.';
    await safe(() => ctx.reply(msg, replyExtra(ctx)), 'handleAsk-reply');
  } finally {
    if (typingTimer) clearInterval(typingTimer);
    busy.delete(key);
    if (waitMsg) {
      await safe(() => ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id), 'delete-wait');
    }
  }
}

async function enableAiMode(ctx) {
  db.setAiMode(ctx.from.id, true);
  return ctx.reply('🤖 AI rejimi yoqildi.\nSavolingizni yozing.', aiKeyboard);
}

async function disableAiMode(ctx) {
  db.setAiMode(ctx.from.id, false);
  return ctx.reply('👋 AI rejimidan chiqdingiz.', mainKeyboard);
}

/* ====================== User commandlari ====================== */

bot.start(async (ctx) => {
  if (isPrivate(ctx)) {
    db.setAiMode(ctx.from.id, false);
    return ctx.reply(START_TEXT, mainKeyboard);
  }
  return ctx.reply(
    '🤖 Salom! Guruhda menga savol berish uchun:\nAI savolingiz\nyoki\n/ai savolingiz',
    replyExtra(ctx)
  );
});

bot.help((ctx) => ctx.reply(HELP_TEXT, isPrivate(ctx) ? mainKeyboard : replyExtra(ctx)));

bot.command('id', (ctx) => {
  const lines = [`🆔 Sizning ID: <code>${ctx.from.id}</code>`];
  if (!isPrivate(ctx)) lines.push(`💬 Chat ID: <code>${ctx.chat.id}</code>`);
  return ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...replyExtra(ctx) });
});

bot.command('clear', (ctx) => {
  db.clearHistory(chatKeyOf(ctx));
  return ctx.reply('🧹 Suhbat konteksti tozalandi.', replyExtra(ctx));
});

bot.command('ai', async (ctx) => {
  const question = ctx.message.text.replace(/^\/ai(@\w+)?/i, '').trim();
  if (isPrivate(ctx)) {
    if (!question) return enableAiMode(ctx);
    return handleAsk(ctx, question);
  }
  if (!question) {
    return ctx.reply('ℹ️ Foydalanish:\n/ai savolingiz\nyoki\nAI savolingiz', replyExtra(ctx));
  }
  return handleAsk(ctx, question);
});

/* ====================== Reply tugmalar (private) ====================== */

bot.hears(BTN_AI, (ctx, next) => (isPrivate(ctx) ? enableAiMode(ctx) : next()));
bot.hears(BTN_HELP, (ctx, next) => (isPrivate(ctx) ? ctx.reply(HELP_TEXT, mainKeyboard) : next()));
bot.hears(BTN_EXIT, (ctx, next) => (isPrivate(ctx) ? disableAiMode(ctx) : next()));

/* ====================== Admin: umumiy ====================== */

const adminState = new Map(); // adminId -> 'await_broadcast'
const pendingBroadcast = new Map(); // adminId -> matn
let broadcastRunning = false;

const NOT_ADMIN = '❌ Siz admin emassiz.';

const backButton = () => [Markup.button.callback('⬅️ Orqaga', 'adm:home')];

function panelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 Users', 'adm:users'), Markup.button.callback('👥 Groups', 'adm:groups')],
    [
      Markup.button.callback('📊 Statistics', 'adm:stats'),
      Markup.button.callback('📢 Broadcast', 'adm:broadcast'),
    ],
    [Markup.button.callback('➕ Add Group', 'adm:addgroup'), Markup.button.callback('⚙️ Settings', 'adm:settings')],
  ]);
}

const PANEL_TEXT = '🛠 <b>Admin panel</b>\n\nKerakli bo‘limni tanlang:';

function statsText() {
  const s = db.getStats();
  const aiOn = db.getSetting('ai_enabled', '1') === '1';
  return (
    '📊 <b>Statistika</b>\n\n' +
    `👤 Foydalanuvchilar: <b>${s.users}</b>\n` +
    `🆕 Bugun qo‘shilgan: <b>${s.newToday}</b>\n` +
    `👥 Guruhlar: <b>${s.groups}</b>\n` +
    `💬 AI so‘rovlari: <b>${s.messages}</b>\n` +
    `🧠 Saqlangan suhbat xabarlari: <b>${s.historyRows}</b>\n` +
    `🤖 AI holati: ${aiOn ? '✅ yoqilgan' : '⏸ o‘chirilgan'}\n` +
    `🔧 Model: <code>${escapeHtml(config.AI_MODEL)}</code>\n` +
    `⏱ Ish vaqti: ${formatUptime(Date.now() - startedAt)}`
  );
}

function usersText() {
  const total = db.getStats().users;
  const rows = db.getRecentUsers(15);
  if (!rows.length) return '👥 <b>Foydalanuvchilar</b>\n\nHozircha hech kim yo‘q.';
  const lines = rows.map((u, i) => {
    const uname = u.username ? ` @${escapeHtml(u.username)}` : '';
    return (
      `${i + 1}. ${escapeHtml(u.firstName || '—')}${uname}\n` +
      `   🆔 <code>${u.id}</code> | 💬 ${u.messageCount} | 📅 ${formatDate(u.joinedAt)}`
    );
  });
  return `👥 <b>Foydalanuvchilar</b> (jami: ${total}, oxirgi 15 ta)\n\n${lines.join('\n')}`;
}

function groupsText() {
  const total = db.getStats().groups;
  const rows = db.getRecentGroups(15);
  if (!rows.length) return '👥 <b>Guruhlar</b>\n\nBot hali hech qaysi guruhga qo‘shilmagan.';
  const lines = rows.map((g, i) => {
    const uname = g.username ? ` @${escapeHtml(g.username)}` : '';
    return (
      `${i + 1}. ${escapeHtml(g.title || '—')}${uname}\n` +
      `   🆔 <code>${g.id}</code> | 📅 ${formatDate(g.addedAt)}`
    );
  });
  return `👥 <b>Guruhlar</b> (jami: ${total}, oxirgi 15 ta)\n\n${lines.join('\n')}`;
}

function addGroupText() {
  const username = (bot.botInfo && bot.botInfo.username) || 'BOT_USERNAME';
  return (
    '➕ <b>Botni guruhga qo‘shish</b>\n\n' +
    '1️⃣ Shu havola orqali guruhni tanlang:\n' +
    `https://t.me/${username}?startgroup=true\n\n` +
    '2️⃣ Bot oddiy xabarlarni ko‘rishi uchun: @BotFather → /mybots → botingiz → Bot Settings → Group Privacy → Turn off. ' +
    'Shundan keyin botni guruhdan chiqarib, qayta qo‘shing. (Yoki botni guruhda admin qiling.)\n\n' +
    '3️⃣ Guruhda savol berish:\n' +
    '<code>AI Python nima?</code>\n' +
    'yoki\n' +
    '<code>/ai Python nima?</code>\n\n' +
    'Bot guruhga qo‘shilishi bilan guruh avtomatik bazaga saqlanadi (👥 Groups bo‘limida ko‘rinadi).'
  );
}

function settingsView() {
  const aiOn = db.getSetting('ai_enabled', '1') === '1';
  const text =
    '⚙️ <b>Sozlamalar</b>\n\n' +
    `🤖 AI: ${aiOn ? '✅ yoqilgan' : '⏸ o‘chirilgan'}\n` +
    `🔧 Model: <code>${escapeHtml(config.AI_MODEL)}</code>\n` +
    `🧠 Kontekst: oxirgi ${config.HISTORY_LIMIT} ta xabar\n` +
    `📏 Maksimal javob: ${config.AI_MAX_TOKENS} token`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(aiOn ? '⏸ AI ni o‘chirish' : '▶️ AI ni yoqish', 'adm:toggle_ai')],
    [Markup.button.callback('🧹 Barcha tarixni tozalash', 'adm:clear_hist')],
    backButton(),
  ]);
  return { text, keyboard };
}

async function show(ctx, text, keyboard) {
  const extra = { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(keyboard || {}) };
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    const desc = (err && (err.description || err.message)) || '';
    if (/message is not modified/i.test(desc)) return;
    await safe(() => ctx.reply(text, extra), 'show-fallback');
  }
}

/* ====================== Admin commandlari ====================== */

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from)) return ctx.reply(NOT_ADMIN);
  if (!isPrivate(ctx)) return ctx.reply('🔒 Admin panelni faqat shaxsiy chatda oching.');
  return ctx.reply(PANEL_TEXT, { parse_mode: 'HTML', ...panelKeyboard() });
});

bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx.from)) return ctx.reply(NOT_ADMIN);
  return ctx.reply(statsText(), { parse_mode: 'HTML' });
});

bot.command('addgroup', async (ctx) => {
  if (!isAdmin(ctx.from)) return ctx.reply(NOT_ADMIN);
  return ctx.reply(addGroupText(), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
});

bot.command('cancel', async (ctx) => {
  if (!isAdmin(ctx.from)) return;
  adminState.delete(ctx.from.id);
  pendingBroadcast.delete(ctx.from.id);
  return ctx.reply('✅ Bekor qilindi.');
});

/* ====================== Admin: inline tugmalar ====================== */

async function runBroadcast(adminId, text) {
  const ids = db.getBroadcastTargets();
  let ok = 0;
  let blocked = 0;
  let failed = 0;

  for (const id of ids) {
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        await bot.telegram.sendMessage(id, text, { link_preview_options: { is_disabled: true } });
        ok++;
        break;
      } catch (err) {
        const code = (err.response && err.response.error_code) || err.code;
        if (code === 429 && attempts < 2) {
          const wait = (err.response && err.response.parameters && err.response.parameters.retry_after) || 5;
          await sleep((wait + 1) * 1000);
          continue;
        }
        if (code === 403 || code === 400) blocked++;
        else failed++;
        break;
      }
    }
    await sleep(50);
  }

  await safe(
    () =>
      bot.telegram.sendMessage(
        adminId,
        '✅ Broadcast tugadi.\n\n' +
          `📬 Yetkazildi: ${ok}\n` +
          `🚫 Bloklagan/yopiq: ${blocked}\n` +
          `⚠️ Xato: ${failed}\n` +
          `👤 Jami: ${ids.length}`
      ),
    'broadcast-report'
  );
}

bot.action(/^adm:(\w+)$/, async (ctx) => {
  if (!isAdmin(ctx.from)) {
    return safe(() => ctx.answerCbQuery(NOT_ADMIN, { show_alert: true }), 'cb-deny');
  }
  await safe(() => ctx.answerCbQuery(), 'cb-answer');

  const adminId = ctx.from.id;
  const action = ctx.match[1];

  switch (action) {
    case 'home':
    case 'cancel':
      adminState.delete(adminId);
      pendingBroadcast.delete(adminId);
      return show(ctx, PANEL_TEXT, panelKeyboard());

    case 'users':
      return show(ctx, usersText(), Markup.inlineKeyboard([backButton()]));

    case 'groups':
      return show(ctx, groupsText(), Markup.inlineKeyboard([backButton()]));

    case 'stats':
      return show(ctx, statsText(), Markup.inlineKeyboard([backButton()]));

    case 'addgroup':
      return show(ctx, addGroupText(), Markup.inlineKeyboard([backButton()]));

    case 'broadcast':
      adminState.set(adminId, 'await_broadcast');
      return show(
        ctx,
        '📢 <b>Broadcast</b>\n\nBarcha foydalanuvchilarga yuboriladigan xabar matnini yozib yuboring.\n' +
          'Bekor qilish uchun pastdagi tugmani bosing.',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'adm:cancel')]])
      );

    case 'bc_yes': {
      const text = pendingBroadcast.get(adminId);
      if (!text) return show(ctx, '⚠️ Yuboriladigan xabar topilmadi.', Markup.inlineKeyboard([backButton()]));
      if (broadcastRunning) {
        return safe(() => ctx.answerCbQuery('⏳ Boshqa broadcast hozir ishlayapti.', { show_alert: true }));
      }
      pendingBroadcast.delete(adminId);
      broadcastRunning = true;
      await show(
        ctx,
        '📤 Yuborish boshlandi. Tugagach hisobot keladi.',
        Markup.inlineKeyboard([backButton()])
      );
      runBroadcast(adminId, text)
        .catch((err) => logError('broadcast', err))
        .finally(() => {
          broadcastRunning = false;
        });
      return;
    }

    case 'settings': {
      const view = settingsView();
      return show(ctx, view.text, view.keyboard);
    }

    case 'toggle_ai': {
      const on = db.getSetting('ai_enabled', '1') === '1';
      db.setSetting('ai_enabled', on ? '0' : '1');
      const view = settingsView();
      return show(ctx, view.text, view.keyboard);
    }

    case 'clear_hist': {
      db.clearAllHistory();
      await safe(() => ctx.answerCbQuery('🧹 Barcha suhbat tarixi tozalandi.', { show_alert: true }));
      const view = settingsView();
      return show(ctx, view.text, view.keyboard);
    }

    default:
      return undefined;
  }
});

/* ====================== Guruhga qo‘shilish/chiqish ====================== */

bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  const chat = update.chat;
  if (!isGroupChat(chat)) return;

  const status = update.new_chat_member.status;

  if (status === 'member' || status === 'administrator') {
    db.upsertGroup(chat);
    log(`Guruhga qo‘shildi: ${chat.title} (${chat.id})`);

    await safe(
      () =>
        bot.telegram.sendMessage(
          chat.id,
          '👋 Salom! Men AI yordamchiman.\nSavol berish uchun:\nAI savolingiz\nyoki\n/ai savolingiz'
        ),
      'group-greeting'
    );

    for (const adminId of config.ADMIN_IDS) {
      await safe(
        () =>
          bot.telegram.sendMessage(
            Number(adminId),
            `➕ Bot yangi guruhga qo‘shildi:\n${chat.title || '—'}\nID: ${chat.id}`
          ),
        'notify-admin'
      );
    }
  } else if (status === 'left' || status === 'kicked') {
    db.removeGroup(chat.id);
    log(`Guruhdan chiqarildi: ${chat.title} (${chat.id})`);
  }
});

/* ====================== Matn xabarlari ====================== */

// Admin broadcast matnini qabul qilish
bot.on('text', async (ctx, next) => {
  if (!isPrivate(ctx) || !isAdmin(ctx.from) || adminState.get(ctx.from.id) !== 'await_broadcast') {
    return next();
  }
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();

  if (text.length > 3500) {
    return ctx.reply('❌ Xabar juda uzun (maksimum 3500 belgi). Qisqaroq yuboring.');
  }

  adminState.delete(ctx.from.id);
  pendingBroadcast.set(ctx.from.id, text);
  const total = db.getBroadcastTargets().length;

  return ctx.reply(
    `📢 Quyidagi xabar ${total} ta foydalanuvchiga yuboriladi:\n\n${text}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Yuborish', 'adm:bc_yes'), Markup.button.callback('❌ Bekor qilish', 'adm:cancel')],
    ])
  );
});

// AI savollari
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return undefined; // noma'lum commandlarga javob bermaymiz

  const match = text.match(TRIGGER);

  if (isPrivate(ctx)) {
    if (match) return handleAsk(ctx, match[1]);
    if (db.getAiMode(ctx.from.id)) return handleAsk(ctx, text);
    return ctx.reply('🤖 Savol berish uchun avval "🤖 AI" tugmasini bosing.', mainKeyboard);
  }

  if (isGroupChat(ctx.chat)) {
    if (match) return handleAsk(ctx, match[1]);
    return undefined; // guruhda oddiy xabarlarga javob bermaymiz
  }

  return undefined;
});

/* ====================== Xatolarni ushlash ====================== */

bot.catch((err, ctx) => {
  logError(`update:${ctx && ctx.updateType}`, err);
});

process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
process.on('uncaughtException', (err) => logError('uncaughtException', err));

/* ====================== Ishga tushirish ====================== */

async function setupCommands() {
  const userCommands = [
    { command: 'start', description: 'Botni ishga tushirish' },
    { command: 'help', description: 'Yordam' },
    { command: 'ai', description: 'AI rejimini ochish' },
    { command: 'id', description: 'ID ni ko‘rsatish' },
    { command: 'clear', description: 'Suhbat kontekstini tozalash' },
  ];
  const adminCommands = [
    ...userCommands,
    { command: 'admin', description: 'Admin panel' },
    { command: 'addgroup', description: 'Botni guruhga qo‘shish' },
    { command: 'stats', description: 'Bot statistikasi' },
  ];

  await safe(() => bot.telegram.setMyCommands(userCommands), 'setMyCommands');
  for (const id of config.ADMIN_IDS) {
    await safe(
      () => bot.telegram.setMyCommands(adminCommands, { scope: { type: 'chat', chat_id: Number(id) } }),
      'setMyCommands-admin'
    );
  }
}

function shutdown(signal) {
  log(`${signal} qabul qilindi, bot to‘xtatilmoqda...`);
  try {
    bot.stop(signal);
  } catch (_) {
    /* bot hali ishga tushmagan bo‘lishi mumkin */
  }
  try {
    db.close();
  } catch (_) {
    /* ignore */
  }
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  try {
    const me = await bot.telegram.getMe();
    bot.botInfo = me;
    log(`✅ Bot ishga tushdi: @${me.username}`);
  } catch (err) {
    logError('getMe', err);
    console.error('❌ Telegramga ulanib bo‘lmadi. BOT_TOKEN va internetni tekshiring.');
    process.exit(1);
  }

  await setupCommands();

  bot
    .launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query', 'my_chat_member'],
    })
    .catch((err) => {
      logError('launch', err);
      process.exit(1);
    });
})();
