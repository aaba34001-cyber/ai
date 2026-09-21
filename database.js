'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'bot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    firstName TEXT,
    joinedAt TEXT NOT NULL,
    messageCount INTEGER NOT NULL DEFAULT 0,
    aiMode INTEGER NOT NULL DEFAULT 0,
    hasPrivate INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tg_groups (
    id INTEGER PRIMARY KEY,
    title TEXT,
    username TEXT,
    addedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatKey TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_chatKey ON history(chatKey, id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const MAX_KEEP_PER_CHAT = 60;
const nowIso = () => new Date().toISOString();

/* ---------------- Users ---------------- */
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (id, username, firstName, joinedAt, hasPrivate)
  VALUES (@id, @username, @firstName, @joinedAt, @hasPrivate)
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    firstName = excluded.firstName,
    hasPrivate = MAX(users.hasPrivate, excluded.hasPrivate)
`);

function upsertUser(from, isPrivate) {
  stmtUpsertUser.run({
    id: from.id,
    username: from.username || null,
    firstName: from.first_name || null,
    joinedAt: nowIso(),
    hasPrivate: isPrivate ? 1 : 0,
  });
}

const stmtIncMessages = db.prepare('UPDATE users SET messageCount = messageCount + 1 WHERE id = ?');
const stmtSetAiMode = db.prepare('UPDATE users SET aiMode = ? WHERE id = ?');
const stmtGetAiMode = db.prepare('SELECT aiMode FROM users WHERE id = ?');

const incrementMessages = (id) => stmtIncMessages.run(id);
const setAiMode = (id, on) => stmtSetAiMode.run(on ? 1 : 0, id);
const getAiMode = (id) => {
  const row = stmtGetAiMode.get(id);
  return !!(row && row.aiMode);
};

const stmtRecentUsers = db.prepare(
  'SELECT id, username, firstName, joinedAt, messageCount FROM users ORDER BY joinedAt DESC LIMIT ?'
);
const stmtBroadcastTargets = db.prepare('SELECT id FROM users WHERE hasPrivate = 1');

const getRecentUsers = (limit) => stmtRecentUsers.all(limit);
const getBroadcastTargets = () => stmtBroadcastTargets.all().map((r) => r.id);

/* ---------------- Groups ---------------- */
const stmtUpsertGroup = db.prepare(`
  INSERT INTO tg_groups (id, title, username, addedAt)
  VALUES (@id, @title, @username, @addedAt)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    username = excluded.username
`);
const stmtRemoveGroup = db.prepare('DELETE FROM tg_groups WHERE id = ?');
const stmtRecentGroups = db.prepare(
  'SELECT id, title, username, addedAt FROM tg_groups ORDER BY addedAt DESC LIMIT ?'
);

function upsertGroup(chat) {
  stmtUpsertGroup.run({
    id: chat.id,
    title: chat.title || null,
    username: chat.username || null,
    addedAt: nowIso(),
  });
}
const removeGroup = (id) => stmtRemoveGroup.run(id);
const getRecentGroups = (limit) => stmtRecentGroups.all(limit);

/* ---------------- History ---------------- */
const stmtHistory = db.prepare(
  'SELECT role, content FROM history WHERE chatKey = ? ORDER BY id DESC LIMIT ?'
);
const stmtInsertHistory = db.prepare(
  'INSERT INTO history (chatKey, role, content, createdAt) VALUES (?, ?, ?, ?)'
);
const stmtTrimHistory = db.prepare(`
  DELETE FROM history
  WHERE chatKey = ?
    AND id NOT IN (SELECT id FROM history WHERE chatKey = ? ORDER BY id DESC LIMIT ?)
`);
const stmtClearHistory = db.prepare('DELETE FROM history WHERE chatKey = ?');
const stmtClearAllHistory = db.prepare('DELETE FROM history');

function getHistory(chatKey, limit) {
  const rows = stmtHistory.all(chatKey, limit).reverse();
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows;
}

const addExchange = db.transaction((chatKey, userText, assistantText) => {
  const ts = nowIso();
  stmtInsertHistory.run(chatKey, 'user', userText, ts);
  stmtInsertHistory.run(chatKey, 'assistant', assistantText, ts);
  stmtTrimHistory.run(chatKey, chatKey, MAX_KEEP_PER_CHAT);
});

const clearHistory = (chatKey) => stmtClearHistory.run(chatKey);
const clearAllHistory = () => stmtClearAllHistory.run();

/* ---------------- Settings ---------------- */
const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function getSetting(key, fallback) {
  const row = stmtGetSetting.get(key);
  return row ? row.value : fallback;
}
const setSetting = (key, value) => stmtSetSetting.run(key, String(value));

/* ---------------- Stats ---------------- */
function getStats() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    newToday: db.prepare('SELECT COUNT(*) AS c FROM users WHERE joinedAt >= ?').get(today).c,
    groups: db.prepare('SELECT COUNT(*) AS c FROM tg_groups').get().c,
    messages: db.prepare('SELECT COALESCE(SUM(messageCount), 0) AS c FROM users').get().c,
    historyRows: db.prepare('SELECT COUNT(*) AS c FROM history').get().c,
  };
}

const close = () => db.close();

module.exports = {
  upsertUser,
  incrementMessages,
  setAiMode,
  getAiMode,
  getRecentUsers,
  getBroadcastTargets,
  upsertGroup,
  removeGroup,
  getRecentGroups,
  getHistory,
  addExchange,
  clearHistory,
  clearAllHistory,
  getSetting,
  setSetting,
  getStats,
  close,
};
