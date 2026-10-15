const fs = require('fs');
const mysql = require('mysql2/promise');

let pool;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uname_hash CHAR(64) NOT NULL UNIQUE,
    uname_canon CHAR(64) NULL UNIQUE,
    uname_enc TEXT NOT NULL,
    pass_hash VARCHAR(255) NULL,
    email_enc TEXT NULL,
    birth_enc TEXT NULL,
    name_enc TEXT NOT NULL,
    bio_enc TEXT NULL,
    avatar_enc MEDIUMTEXT NULL,
    avatar_v BIGINT NOT NULL DEFAULT 0,
    settings_enc TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen DATETIME(3) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    ua_enc TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_used DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('direct','group') NOT NULL,
    direct_key CHAR(64) NULL UNIQUE,
    title_enc TEXT NULL,
    avatar_enc MEDIUMTEXT NULL,
    avatar_v BIGINT NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NOT NULL,
    disappear_secs INT NOT NULL DEFAULT 0,
    extra_enc TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_msg_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_members (
    chat_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role ENUM('admin','member') NOT NULL DEFAULT 'member',
    joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    active TINYINT NOT NULL DEFAULT 1,
    last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_delivered_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    cleared_before_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    muted_until BIGINT NOT NULL DEFAULT 0,
    pinned TINYINT NOT NULL DEFAULT 0,
    archived TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    chat_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    kind ENUM('text','image','video','audio','file','location','poll','call','system','ping','letter') NOT NULL,
    body_enc MEDIUMTEXT NOT NULL,
    reply_to BIGINT UNSIGNED NULL,
    attachment_id BIGINT UNSIGNED NULL,
    effect VARCHAR(20) NULL,
    forwarded TINYINT NOT NULL DEFAULT 0,
    silent TINYINT NOT NULL DEFAULT 0,
    pinned TINYINT NOT NULL DEFAULT 0,
    deleted TINYINT NOT NULL DEFAULT 0,
    read_ttl INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    edited_at DATETIME(3) NULL,
    expires_at DATETIME(3) NULL,
    INDEX chat_msgs (chat_id, id),
    INDEX (expires_at)
  )`,
  `CREATE TABLE IF NOT EXISTS message_hidden (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (message_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    emoji_enc TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (message_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS poll_votes (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    option_idx INT NOT NULL,
    PRIMARY KEY (message_id, user_id, option_idx)
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    chat_id BIGINT UNSIGNED NOT NULL,
    uploader_id BIGINT UNSIGNED NOT NULL,
    meta_enc TEXT NOT NULL,
    size INT UNSIGNED NOT NULL,
    data LONGBLOB NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (chat_id)
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    chat_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    payload_enc MEDIUMTEXT NOT NULL,
    send_at DATETIME(3) NOT NULL,
    INDEX (send_at),
    INDEX (chat_id, sender_id)
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    user_id BIGINT UNSIGNED NOT NULL,
    blocked_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, blocked_id)
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider VARCHAR(16) NOT NULL,
    subject_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    email_enc TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (provider, subject_hash),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    chat_id BIGINT UNSIGNED NULL,
    message_id BIGINT UNSIGNED NULL,
    text_enc TEXT NOT NULL,
    remind_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (remind_at),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS checkins (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    chat_id BIGINT UNSIGNED NOT NULL,
    payload_enc TEXT NOT NULL,
    due_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (due_at),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS device_keys (
    key_id CHAR(64) PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    jwk_enc TEXT NOT NULL,
    label_enc TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash CHAR(64) PRIMARY KEY,
    code_enc TEXT NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    used_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    used_at DATETIME(3) NULL,
    INDEX (created_by)
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    secret_hash CHAR(64) NOT NULL,
    data_enc TEXT NOT NULL,
    status ENUM('pending','approved','completed','cancelled','expired') NOT NULL DEFAULT 'pending',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    approved_at DATETIME(3) NULL,
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS guest_links (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    msg_enc TEXT NULL,
    uses INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS push_subs (
    endpoint_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    sub_enc TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (user_id)
  )`,
];

async function init() {
  const ssl = process.env.DB_CA_PATH
    ? { ca: fs.readFileSync(process.env.DB_CA_PATH, 'utf8') }
    : { rejectUnauthorized: false };
  const base = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
  const dbName = process.env.DB_NAME || 'meetme';

  const boot = await mysql.createConnection(base);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await boot.end();

  pool = mysql.createPool({ ...base, database: dbName, connectionLimit: 10, waitForConnections: true, enableKeepAlive: true });
  for (const sql of SCHEMA) await pool.query(sql);
  await migrate(dbName);
  return pool;
}

// Idempotent upgrades for databases created by earlier versions.
async function migrate(dbName) {
  const cols = async (table) => new Set((await pool.query(
    'SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [dbName, table]
  ))[0].map((r) => r.c));
  const users = await cols('users');
  if (!users.has('uname_canon')) await pool.query('ALTER TABLE users ADD COLUMN uname_canon CHAR(64) NULL UNIQUE AFTER uname_hash');
  if (!users.has('email_enc')) await pool.query('ALTER TABLE users ADD COLUMN email_enc TEXT NULL AFTER pass_hash');
  if (!users.has('birth_enc')) await pool.query('ALTER TABLE users ADD COLUMN birth_enc TEXT NULL AFTER email_enc');
  const messages = await cols('messages');
  if (!messages.has('read_ttl')) await pool.query('ALTER TABLE messages ADD COLUMN read_ttl INT NULL AFTER deleted');
  // New message kinds: the Ping and open-when letters.
  const [[kindCol]] = await pool.query("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='messages' AND COLUMN_NAME='kind'", [dbName]);
  if (!kindCol.t.includes("'letter'")) {
    await pool.query("ALTER TABLE messages MODIFY kind ENUM('text','image','video','audio','file','location','poll','call','system','ping','letter') NOT NULL");
  }
  const chats = await cols('chats');
  if (!chats.has('extra_enc')) await pool.query('ALTER TABLE chats ADD COLUMN extra_enc TEXT NULL AFTER disappear_secs');
  await pool.query('ALTER TABLE users MODIFY pass_hash VARCHAR(255) NULL');
}

const q = (sql, params) => pool.query(sql, params).then(([rows]) => rows);
const one = async (sql, params) => (await q(sql, params))[0] || null;

module.exports = { init, q, one, get pool() { return pool; } };
