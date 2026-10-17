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
    device_hash CHAR(64) NULL,
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
    removed TINYINT NOT NULL DEFAULT 0,
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
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    sid CHAR(16) NULL,
    type VARCHAR(24) NOT NULL,
    screen VARCHAR(24) NULL,
    item VARCHAR(40) NULL,
    value INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (created_at), INDEX (type, created_at), INDEX (user_id, created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS user_days (
    user_id BIGINT UNSIGNED NOT NULL,
    day DATE NOT NULL,
    secs INT NOT NULL DEFAULT 0,
    buzz TINYINT NOT NULL DEFAULT 0,
    buzz_secs INT NOT NULL DEFAULT 0,
    opens INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day), INDEX (day)
  )`,
  `CREATE TABLE IF NOT EXISTS user_interests (
    user_id BIGINT UNSIGNED PRIMARY KEY,
    data_enc MEDIUMTEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`,
  // Buzz impressions: each story a person has seen (so it never comes back) and which part of the
  // algorithm served it (p personal · m section mix · t trending · x explore · r more-like-this ·
  // g no profile yet) — the admin portal measures each part against the others.
  `CREATE TABLE IF NOT EXISTS feed_seen (
    user_id BIGINT UNSIGNED NOT NULL,
    item_id CHAR(24) NOT NULL,
    slot CHAR(1) NOT NULL DEFAULT 'g',
    topic VARCHAR(20) NULL,
    source_id VARCHAR(40) NULL,
    seq INT UNSIGNED NOT NULL DEFAULT 0,
    seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, item_id), INDEX (seen_at), INDEX (user_id, seen_at)
  )`,
  // App crash reports (what broke and where; never message text), kept 30 days.
  `CREATE TABLE IF NOT EXISTS client_errors (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    where_at VARCHAR(60) NOT NULL,
    msg VARCHAR(300) NOT NULL,
    stack TEXT NULL,
    screen VARCHAR(24) NULL,
    platform VARCHAR(12) NULL,
    ua VARCHAR(300) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS user_devices (
    user_id BIGINT UNSIGNED PRIMARY KEY,
    platform VARCHAR(16) NOT NULL,
    standalone TINYINT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`,
  `CREATE TABLE IF NOT EXISTS feed_sources (
    id VARCHAR(40) PRIMARY KEY,
    etag VARCHAR(255) NULL,
    last_modified VARCHAR(100) NULL,
    last_ok DATETIME(3) NULL,
    last_attempt DATETIME(3) NULL,
    next_try DATETIME(3) NULL,
    fails INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error VARCHAR(300) NULL,
    items INT NOT NULL DEFAULT 0,
    logo MEDIUMBLOB NULL,
    logo_type VARCHAR(60) NULL,
    logo_at DATETIME(3) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feed_items (
    id CHAR(24) PRIMARY KEY,
    source_id VARCHAR(40) NOT NULL,
    region VARCHAR(20) NOT NULL,
    topic VARCHAR(20) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    title VARCHAR(600) NOT NULL,
    summary TEXT NULL,
    image_url VARCHAR(1024) NULL,
    video_url VARCHAR(1024) NULL,
    via VARCHAR(160) NULL,
    discuss_url VARCHAR(300) NULL,
    engagement TEXT NULL,
    src_rank INT NULL,
    published_at DATETIME(3) NULL,
    fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    enriched TINYINT NOT NULL DEFAULT 0,
    ai_summary TEXT NULL,
    ai_model VARCHAR(60) NULL,
    ai_tries TINYINT NOT NULL DEFAULT 0,
    INDEX (region, fetched_at),
    INDEX (published_at)
  )`,
  `CREATE TABLE IF NOT EXISTS feed_likes (
    item_id CHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (item_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS feed_reposts (
    item_id CHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (item_id, user_id), INDEX (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS feed_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, item_id CHAR(24) NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
    body_enc TEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_pets (
    chat_id BIGINT UNSIGNED PRIMARY KEY,
    caged TINYINT NOT NULL DEFAULT 0,
    caged_by BIGINT UNSIGNED NULL,
    fed_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`,
  `CREATE TABLE IF NOT EXISTS attachment_chunks (
    att_id BIGINT UNSIGNED NOT NULL,
    idx INT UNSIGNED NOT NULL,
    data LONGBLOB NOT NULL,
    PRIMARY KEY (att_id, idx)
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
  // Incognito chat: messages from an incognito session are deleted for everyone when it ends.
  if (!messages.has('incognito')) await pool.query('ALTER TABLE messages ADD COLUMN incognito TINYINT NOT NULL DEFAULT 0 AFTER read_ttl');
  // New message kinds: the Ping and open-when letters.
  const [[kindCol]] = await pool.query("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='messages' AND COLUMN_NAME='kind'", [dbName]);
  if (!kindCol.t.includes("'letter'")) {
    await pool.query("ALTER TABLE messages MODIFY kind ENUM('text','image','video','audio','file','location','poll','call','system','ping','letter') NOT NULL");
  }
  const atts = await cols('attachments');
  if (!atts.has('chunks')) {
    // Large files are stored in encrypted 8 MiB pieces (see media.js); 0 = whole file in `data`.
    await pool.query("ALTER TABLE attachments ADD COLUMN chunks INT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN store VARCHAR(8) NOT NULL DEFAULT 'db', ADD COLUMN complete TINYINT NOT NULL DEFAULT 1, MODIFY data LONGBLOB NULL");
  }
  const sessions = await cols('sessions');
  if (!sessions.has('device_hash')) await pool.query('ALTER TABLE sessions ADD COLUMN device_hash CHAR(64) NULL AFTER ua_enc');
  const fitems = await cols('feed_items');
  if (fitems.size && !fitems.has('ai_summary')) await pool.query('ALTER TABLE feed_items ADD COLUMN ai_summary TEXT NULL, ADD COLUMN ai_model VARCHAR(60) NULL, ADD COLUMN ai_tries TINYINT NOT NULL DEFAULT 0');
  const fsrc = await cols('feed_sources');
  if (fsrc.size && !fsrc.has('logo')) await pool.query('ALTER TABLE feed_sources ADD COLUMN logo MEDIUMBLOB NULL, ADD COLUMN logo_type VARCHAR(60) NULL, ADD COLUMN logo_at DATETIME(3) NULL');
  const members = await cols('chat_members');
  if (!members.has('removed')) {
    // "Deleted" conversations used to be parked in Archived; give them their own hidden state.
    await pool.query('ALTER TABLE chat_members ADD COLUMN removed TINYINT NOT NULL DEFAULT 0 AFTER archived');
    await pool.query(`UPDATE chat_members cm SET removed=1, archived=0
      WHERE cm.archived=1 AND cm.cleared_before_id>0
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.chat_id=cm.chat_id AND m.id>cm.cleared_before_id AND m.kind<>'system')`);
  }
  const chats = await cols('chats');
  if (!chats.has('extra_enc')) await pool.query('ALTER TABLE chats ADD COLUMN extra_enc TEXT NULL AFTER disappear_secs');
  if (!chats.has('incognito_since')) {
    await pool.query('ALTER TABLE chats ADD COLUMN incognito_since DATETIME(3) NULL, ADD COLUMN incognito_by BIGINT UNSIGNED NULL, ADD COLUMN incognito_last DATETIME(3) NULL, ADD INDEX (incognito_since)');
  }
  await pool.query('ALTER TABLE users MODIFY pass_hash VARCHAR(255) NULL');
}

const q = (sql, params) => pool.query(sql, params).then(([rows]) => rows);
const one = async (sql, params) => (await q(sql, params))[0] || null;

module.exports = { init, q, one, get pool() { return pool; } };
