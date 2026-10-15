require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const db = require('./db');
const C = require('./crypto');
const push = require('./push');
const oauth = require('./oauth');
const U = require('./usernames');

const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD = 45 * 1024 * 1024; // DB max_allowed_packet is 64MB
const COOKIE = 'mm_sess';
// Identifies this running copy of the server (changes on every deploy).
const INSTANCE_ID = (process.env.K_REVISION || 'local') + '-' + require('crypto').randomBytes(4).toString('hex');
const REACTION_MAX = 16;
const DEFAULT_SETTINGS = { readReceipts: true, typing: true, lastSeen: true, previews: true };
// Advanced features each person can switch on/off (first-run setup + Settings → Features).
const FEATURES = {
  scamRadar: true, promiseTracker: true, intentTags: true, secureMessages: true, eyesOnly: true,
  vanishAfterRead: true, checkIn: true, verifiedDevices: true, reasonToCall: true, whisperMode: true,
  callRewind: true, spatialAudio: true, sos: true, groupPets: true, wrapped: true, whosRight: true, verifiedCamera: true,
  ping: true, usSpace: true,
};
const MIN_AGE = 13;

C.init(process.env.PINGME_KEY || process.env.MEETME_KEY); // MEETME_KEY: name used by earlier versions
push.init();

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingInterval: 20000,
  pingTimeout: 25000,
  allowRequest: (req, cb) => {
    // Block cross-site WebSocket hijacking: origin must match host.
    const origin = req.headers.origin;
    if (!origin) return cb(null, true);
    try { cb(null, new URL(origin).host === req.headers.host); } catch { cb(null, false); }
  },
});

// ───────────────────────────── helpers ─────────────────────────────

const now = () => new Date();
const ms = (d) => (d ? new Date(d).getTime() : null);
const toInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const clampStr = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// In-memory caches (single instance deployment).
const userCache = new Map();   // id -> decrypted user
const online = new Map();      // userId -> Set<socket>

async function getUser(id) {
  if (userCache.has(id)) return userCache.get(id);
  const r = await db.one('SELECT * FROM users WHERE id=?', [id]);
  if (!r) return null;
  const u = {
    id: Number(r.id),
    username: C.dec(r.uname_enc),
    name: C.dec(r.name_enc) || 'User',
    bio: C.dec(r.bio_enc) || '',
    avatarV: Number(r.avatar_v) || 0,
    settings: (() => {
      const s = C.decJson(r.settings_enc, {}) || {};
      return { ...DEFAULT_SETTINGS, ...s, features: { ...FEATURES, ...(s.features || {}) }, trusted: Array.isArray(s.trusted) ? s.trusted : [], onboarded: !!s.onboarded, guest: !!s.guest };
    })(),
    birth: C.dec(r.birth_enc),
    lastSeen: ms(r.last_seen),
    createdAt: ms(r.created_at),
  };
  userCache.set(u.id, u);
  return u;
}

async function publicUser(id) {
  const u = await getUser(id);
  if (!u) return { id, username: null, name: 'Deleted account', bio: '', avatarV: 0, online: false, lastSeen: null, deleted: true };
  const showPresence = u.settings.lastSeen;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    bio: u.bio,
    avatarV: u.avatarV,
    online: showPresence ? online.has(u.id) : false,
    lastSeen: showPresence ? u.lastSeen : null,
    // Only "is it their birthday today" is shared — never the date itself.
    birthdayToday: isBirthdayToday(u.birth),
  };
}

function isBirthdayToday(birth) {
  if (!birth) return false;
  const [, m, d] = birth.split('-').map(Number);
  const t = new Date();
  return t.getMonth() + 1 === m && t.getDate() === d;
}

// Validates YYYY-MM-DD, a real calendar date, and the minimum age.
function parseBirth(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input || ''));
  if (!m) throw bad('Please enter your date of birth');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw bad('That date doesn’t exist');
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  if (age < MIN_AGE) throw bad(`You must be at least ${MIN_AGE} to use Ping Me`);
  if (age > 120) throw bad('Please check your date of birth');
  return m[0];
}

async function membership(chatId, userId) {
  return db.one('SELECT * FROM chat_members WHERE chat_id=? AND user_id=? AND active=1', [chatId, userId]);
}

async function requireMember(chatId, userId) {
  const m = await membership(chatId, userId);
  if (!m) throw forbidden('You are not in this conversation');
  return m;
}

async function activeMemberIds(chatId) {
  const rows = await db.q('SELECT user_id FROM chat_members WHERE chat_id=? AND active=1', [chatId]);
  return rows.map((r) => Number(r.user_id));
}

async function isBlockedBetween(a, b) {
  const r = await db.one('SELECT 1 x FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1', [a, b, b, a]);
  return !!r;
}

function emitToUser(userId, event, data) {
  io.to('u:' + userId).emit(event, data);
}

function joinUserToChat(userId, chatId) {
  for (const s of online.get(userId) || []) s.join('c:' + chatId);
}

function leaveUserFromChat(userId, chatId) {
  for (const s of online.get(userId) || []) s.leave('c:' + chatId);
}

// ───────────────────────── serialization ─────────────────────────

async function membersOf(chatIds, viewerId) {
  if (!chatIds.length) return new Map();
  const rows = await db.q(
    'SELECT chat_id, user_id, role, last_read_id, last_delivered_id FROM chat_members WHERE chat_id IN (?) AND active=1',
    [chatIds]
  );
  const map = new Map();
  for (const r of rows) {
    const uid = Number(r.user_id);
    const u = await getUser(uid);
    // Respect "read receipts off": others only see delivered.
    const hideRead = uid !== viewerId && u && !u.settings.readReceipts;
    const entry = {
      id: uid,
      role: r.role,
      lastRead: hideRead ? 0 : Number(r.last_read_id),
      lastDelivered: Number(r.last_delivered_id),
    };
    const cid = Number(r.chat_id);
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(entry);
  }
  return map;
}

async function serializeChats(viewerId, chatId = null) {
  const rows = await db.q(
    `SELECT c.*, cm.role, cm.last_read_id, cm.cleared_before_id, cm.muted_until, cm.pinned, cm.archived, cm.removed
       FROM chat_members cm JOIN chats c ON c.id = cm.chat_id
      WHERE cm.user_id=? AND cm.active=1 ${chatId ? 'AND c.id=?' : ''}
      ORDER BY c.last_msg_at DESC`,
    chatId ? [viewerId, chatId] : [viewerId]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const members = await membersOf(ids, viewerId);

  const lastRows = await db.q(
    `SELECT m.* FROM messages m
       JOIN (SELECT mm.chat_id, MAX(mm.id) mid FROM messages mm
               JOIN chat_members cm ON cm.chat_id = mm.chat_id AND cm.user_id = ?
              WHERE mm.chat_id IN (?) AND mm.id > cm.cleared_before_id
                AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = mm.id AND h.user_id = ?)
              GROUP BY mm.chat_id) t ON t.mid = m.id`,
    [viewerId, ids, viewerId]
  );
  const lastMsgs = new Map();
  for (const m of await serializeMessages(lastRows, viewerId, { light: true })) lastMsgs.set(m.chatId, m);

  const unreadRows = await db.q(
    `SELECT m.chat_id, COUNT(*) n FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
      WHERE m.chat_id IN (?) AND m.id > cm.last_read_id AND m.id > cm.cleared_before_id
        AND m.sender_id <> ? AND m.deleted = 0 AND m.kind <> 'system'
      GROUP BY m.chat_id`,
    [viewerId, ids, viewerId]
  );
  const unread = new Map(unreadRows.map((r) => [Number(r.chat_id), Number(r.n)]));
  const streaks = await streaksFor(rows.filter((r) => r.type === 'direct').map((r) => Number(r.id)));

  return rows.map((r) => {
    const id = Number(r.id);
    return {
      id,
      type: r.type,
      title: C.dec(r.title_enc) || '',
      avatarV: Number(r.avatar_v) || 0,
      createdBy: Number(r.created_by),
      disappearSecs: Number(r.disappear_secs) || 0,
      lastMsgAt: ms(r.last_msg_at),
      role: r.role,
      mutedUntil: Number(r.muted_until) || 0,
      pinned: !!r.pinned,
      archived: !!r.archived,
      removed: !!r.removed,
      clearedBefore: Number(r.cleared_before_id),
      members: members.get(id) || [],
      lastMessage: lastMsgs.get(id) || null,
      unread: unread.get(id) || 0,
      streak: streaks.get(id) || 0,
    };
  });
}

// Streak = consecutive days (India time) on which BOTH people sent something, ending today or yesterday.
const istDay = (t) => new Date(t + 5.5 * 3600000).toISOString().slice(0, 10);
async function streaksFor(chatIds) {
  const out = new Map();
  if (!chatIds.length) return out;
  const rows = await db.q(
    `SELECT chat_id, DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) d, COUNT(DISTINCT sender_id) n FROM messages
      WHERE chat_id IN (?) AND created_at > ? AND deleted=0 AND kind NOT IN ('system','call')
      GROUP BY chat_id, d`, [chatIds, new Date(Date.now() - 400 * 86400000)]);
  const days = new Map();
  for (const r of rows) if (Number(r.n) >= 2) {
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    if (!days.has(Number(r.chat_id))) days.set(Number(r.chat_id), new Set());
    days.get(Number(r.chat_id)).add(d);
  }
  const today = istDay(Date.now()), yesterday = istDay(Date.now() - 86400000);
  for (const [cid, set] of days) {
    let cur = set.has(today) ? today : set.has(yesterday) ? yesterday : null, n = 0;
    while (cur && set.has(cur)) { n++; cur = new Date(new Date(cur + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10); }
    out.set(cid, n);
  }
  return out;
}

function preview(m) {
  if (!m) return '';
  if (m.deleted) return 'Message unsent';
  if (m.eyes) return 'Eyes-only message';
  if (m.secure) return 'Private message';
  switch (m.kind) {
    case 'text': return m.text || '';
    case 'image': return 'Photo' + (m.text ? ' · ' + m.text : '');
    case 'video': return 'Video' + (m.text ? ' · ' + m.text : '');
    case 'audio': return 'Voice message';
    case 'file': return m.att?.name || 'File';
    case 'location': return m.loc?.label || 'Location';
    case 'poll': return m.poll?.q || 'Poll';
    case 'call': return (m.call?.missed ? 'Missed ' : '') + (m.call?.video ? 'video call' : 'audio call');
    case 'ping': return 'Pinged you — thinking of you';
    case 'letter': return 'Letter: ' + (m.letter?.title || 'Open when…');
    default: return m.text || '';
  }
}

async function serializeMessages(rows, viewerId, { light = false } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const reactions = new Map();
  const votes = new Map();
  const replies = new Map();

  if (!light) {
    for (const r of await db.q('SELECT message_id, user_id, emoji_enc FROM reactions WHERE message_id IN (?)', [ids])) {
      const mid = Number(r.message_id);
      if (!reactions.has(mid)) reactions.set(mid, []);
      reactions.get(mid).push({ userId: Number(r.user_id), emoji: C.dec(r.emoji_enc) });
    }
    const pollIds = rows.filter((r) => r.kind === 'poll').map((r) => Number(r.id));
    if (pollIds.length) {
      for (const v of await db.q('SELECT * FROM poll_votes WHERE message_id IN (?)', [pollIds])) {
        const mid = Number(v.message_id);
        if (!votes.has(mid)) votes.set(mid, {});
        const bucket = votes.get(mid);
        (bucket[v.option_idx] ||= []).push(Number(v.user_id));
      }
    }
    const replyIds = [...new Set(rows.map((r) => r.reply_to).filter(Boolean).map(Number))];
    if (replyIds.length) {
      for (const r of await db.q('SELECT id, sender_id, kind, body_enc, deleted FROM messages WHERE id IN (?)', [replyIds])) {
        const b = C.decJson(r.body_enc, {}) || {};
        const pm = { kind: r.kind, deleted: !!r.deleted, text: b.text, att: b.att, poll: b.poll, call: b.call, secure: b.secure, eyes: b.eyes };
        replies.set(Number(r.id), {
          id: Number(r.id),
          senderId: Number(r.sender_id),
          kind: r.kind,
          preview: clampStr(preview(pm), 140),
          attId: !r.deleted && !b.secure && !b.eyes && b.att && (r.kind === 'image' || r.kind === 'video') ? b.att.id : null,
        });
      }
    }
  }

  return rows.map((r) => {
    const id = Number(r.id);
    const base = {
      id,
      chatId: Number(r.chat_id),
      senderId: Number(r.sender_id),
      kind: r.kind,
      createdAt: ms(r.created_at),
      expiresAt: ms(r.expires_at),
      deleted: !!r.deleted,
    };
    if (r.deleted) return base;
    const b = C.decJson(r.body_enc, {}) || {};
    const msg = {
      ...base,
      text: b.text || '',
      att: b.att || null,
      loc: b.loc || null,
      poll: b.poll ? { ...b.poll, votes: votes.get(id) || {} } : null,
      call: b.call || null,
      sys: b.sys || null,
      editedAt: ms(r.edited_at),
      edits: Array.isArray(b.hist) ? b.hist.length : 0,
      history: light ? undefined : b.hist || [],
      effect: r.effect || null,
      forwarded: !!r.forwarded,
      silent: !!r.silent,
      pinned: !!r.pinned,
      replyTo: r.reply_to ? replies.get(Number(r.reply_to)) || { id: Number(r.reply_to), missing: true } : null,
      reactions: reactions.get(id) || [],
      ping: b.ping || null,
      letter: b.letter ? letterView(b.letter, Number(r.sender_id) === viewerId) : null,
      intent: b.intent || null,
      secure: !!b.secure,
      eyes: !!b.eyes,
      vr: b.vr || null,
      sos: !!b.sos,
      whosRight: !!b.poll?.whosRight,
      readTtl: r.read_ttl ? Number(r.read_ttl) : null,
    };
    msg.preview = clampStr(preview(msg), 160);
    return msg;
  });
}

// Open-when letters: the recipient only receives the text once it's unlocked AND they open it.
function letterView(l, isSender) {
  const locked = !!l.unlockAt && l.unlockAt > Date.now();
  const v = { title: l.title, unlockAt: l.unlockAt || null, openedAt: l.openedAt || null, locked };
  if (isSender || l.openedAt) v.text = l.text;
  return v;
}

async function loadMessage(id, viewerId) {
  const row = await db.one('SELECT * FROM messages WHERE id=?', [id]);
  if (!row) return null;
  return (await serializeMessages([row], viewerId))[0];
}

// ─────────────────────────── messaging core ───────────────────────────

const VALID_KINDS = new Set(['text', 'image', 'video', 'audio', 'file', 'location', 'poll', 'ping', 'letter']);
const VALID_EFFECTS = new Set(['slam', 'loud', 'gentle', 'ink', 'confetti', 'balloons', 'hearts', 'fireworks', 'lasers', 'celebrate']);

async function buildBody(chatId, senderId, input) {
  const kind = input.kind || 'text';
  if (!VALID_KINDS.has(kind)) throw bad('Unknown message type');
  const body = {};
  const text = clampStr(input.text || '', 10000).trim();
  if (text) body.text = text;

  let attachmentId = null;
  if (['image', 'video', 'audio', 'file'].includes(kind)) {
    attachmentId = toInt(input.attachmentId);
    if (!attachmentId) throw bad('Missing attachment');
    const a = await db.one('SELECT id, chat_id, uploader_id, meta_enc, size FROM attachments WHERE id=?', [attachmentId]);
    if (!a) throw bad('Attachment not found');
    // Forwarding re-uses an attachment from another chat the sender can see.
    if (Number(a.chat_id) !== chatId || Number(a.uploader_id) !== senderId) {
      await requireMember(Number(a.chat_id), senderId);
    }
    const meta = C.decJson(a.meta_enc, {});
    const extra = input.media || {};
    body.att = {
      id: attachmentId,
      name: meta.name,
      mime: meta.mime,
      size: Number(a.size),
      w: toInt(extra.w) || meta.w || undefined,
      h: toInt(extra.h) || meta.h || undefined,
      dur: Number(extra.dur) > 0 ? Math.round(Number(extra.dur) * 10) / 10 : meta.dur || undefined,
      wave: Array.isArray(extra.wave) ? extra.wave.slice(0, 64).map((x) => Math.max(0, Math.min(1, Number(x) || 0))) : undefined,
    };
  } else if (kind === 'location') {
    const lat = Number(input.loc?.lat), lng = Number(input.loc?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Bad location');
    body.loc = { lat, lng, acc: Number(input.loc?.acc) || undefined, label: clampStr(input.loc?.label || '', 120) || undefined };
  } else if (kind === 'ping') {
    body.ping = { long: !!input.ping?.long };
  } else if (kind === 'letter') {
    const title = clampStr(input.letter?.title || '', 80).trim();
    const ltext = clampStr(input.letter?.text || '', 5000).trim();
    if (!title || !ltext) throw bad('A letter needs a title and a message');
    const unlockAt = Number(input.letter?.unlockAt) || null;
    if (unlockAt && (unlockAt < Date.now() + 60000 || unlockAt > Date.now() + 5 * 365 * 86400000)) throw bad('Pick an unlock date in the future');
    body.letter = { title, text: ltext, unlockAt };
  } else if (kind === 'poll') {
    const q = clampStr(input.poll?.q || '', 300).trim();
    const opts = (Array.isArray(input.poll?.opts) ? input.poll.opts : [])
      .map((o) => clampStr(String(o), 100).trim()).filter(Boolean).slice(0, 12);
    if (!q || opts.length < 2) throw bad('A poll needs a question and at least 2 options');
    body.poll = { q, opts, multi: !!input.poll?.multi };
  } else if (!text) {
    throw bad('Message is empty');
  }
  if (INTENTS.has(input.intent)) body.intent = input.intent;
  if (kind === 'ping' || kind === 'letter') return { kind, body, attachmentId: null, vanish: false };
  if (input.secure && (kind === 'text' || kind === 'image')) body.secure = true;
  if (input.eyes && ['text', 'image', 'video'].includes(kind)) body.eyes = true;
  if (kind === 'poll' && input.poll?.whosRight) body.poll.whosRight = true;
  // "Verified Real" photo: signature by the sender's registered device key over the image bytes.
  if (kind === 'image' && input.vr && typeof input.vr.sig === 'string' && typeof input.vr.keyId === 'string') {
    const key = await db.one('SELECT user_id FROM device_keys WHERE key_id=?', [clampStr(input.vr.keyId, 64)]);
    if (key && Number(key.user_id) === senderId) body.vr = { keyId: input.vr.keyId, sig: clampStr(input.vr.sig, 400), at: Number(input.vr.at) || Date.now() };
  }
  return { kind, body, attachmentId, vanish: !!input.vanish };
}

const INTENTS = new Set(['vent', 'advice', 'urgent', 'fyi', 'news']);

// How long a "vanish after read" message stays once everyone has read it — longer messages get more time.
function readTtlFor(kind, body) {
  if (kind === 'text') {
    const words = (body.text || '').split(/\s+/).filter(Boolean).length;
    return Math.round(Math.min(90, Math.max(6, 4 + words * 0.45)));
  }
  if (kind === 'audio' || kind === 'video') return Math.round(Math.min(600, (body.att?.dur || 20) + 15));
  return 20;
}

async function insertMessage({ chatId, senderId, kind, body, replyTo = null, attachmentId = null, effect = null, forwarded = false, silent = false, clientId = null, vanish = false }) {
  const chat = await db.one('SELECT id, disappear_secs FROM chats WHERE id=?', [chatId]);
  if (!chat) throw notFound('Conversation not found');
  const created = now();
  const expires = chat.disappear_secs > 0 && kind !== 'system' ? new Date(created.getTime() + chat.disappear_secs * 1000) : null;
  const readTtl = (vanish || chat.disappear_secs === -1) && !['system', 'call', 'poll'].includes(kind) ? readTtlFor(kind, body) : null;
  if (replyTo) {
    const parent = await db.one('SELECT chat_id FROM messages WHERE id=?', [replyTo]);
    if (!parent || Number(parent.chat_id) !== chatId) replyTo = null;
  }
  const res = await db.q(
    `INSERT INTO messages (chat_id, sender_id, kind, body_enc, reply_to, attachment_id, effect, forwarded, silent, read_ttl, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [chatId, senderId, kind, C.enc(body), replyTo, attachmentId, effect, forwarded ? 1 : 0, silent ? 1 : 0, readTtl, created, expires]
  );
  const id = Number(res.insertId);
  await db.q('UPDATE chats SET last_msg_at=? WHERE id=?', [created, chatId]);
  // New activity brings archived and deleted chats back, like iMessage.
  if (kind !== 'system') await db.q('UPDATE chat_members SET archived=0, removed=0 WHERE chat_id=? AND (archived=1 OR removed=1) AND active=1', [chatId]);
  await db.q('UPDATE chat_members SET last_read_id=GREATEST(last_read_id,?), last_delivered_id=GREATEST(last_delivered_id,?) WHERE chat_id=? AND user_id=?', [id, id, chatId, senderId]);

  const members = await activeMemberIds(chatId);
  // Everyone currently online has it delivered right now.
  const onlineOthers = members.filter((u) => u !== senderId && online.has(u));
  if (onlineOthers.length) {
    await db.q('UPDATE chat_members SET last_delivered_id=GREATEST(last_delivered_id,?) WHERE chat_id=? AND user_id IN (?)', [id, chatId, onlineOthers]);
  }

  const msg = await loadMessage(id, senderId);
  if (kind === 'letter') {
    // Sender gets the full letter; everyone else gets it sealed.
    const sealed = { ...msg, letter: letterView(body.letter, false), preview: msg.preview };
    emitToUser(senderId, 'msg:new', { ...msg, clientId });
    for (const s of online.get(senderId) || []) s.join('c:' + chatId);
    io.to('c:' + chatId).except('u:' + senderId).emit('msg:new', sealed);
  } else {
    io.to('c:' + chatId).emit('msg:new', { ...msg, clientId });
  }
  for (const u of onlineOthers) {
    io.to('c:' + chatId).emit('receipt', { chatId, userId: u, lastDelivered: id });
  }

  if (kind !== 'system') notifyMembers(chatId, senderId, msg, members).catch(() => {});
  return msg;
}

async function notifyMembers(chatId, senderId, msg, members) {
  if (!push.enabled || msg.silent) return;
  const sender = await publicUser(senderId);
  const chat = await db.one('SELECT type, title_enc FROM chats WHERE id=?', [chatId]);
  const mutes = await db.q('SELECT user_id, muted_until FROM chat_members WHERE chat_id=? AND active=1', [chatId]);
  const muted = new Map(mutes.map((m) => [Number(m.user_id), Number(m.muted_until)]));
  const blockedBy = new Set((await db.q('SELECT user_id FROM blocks WHERE blocked_id=?', [senderId])).map((r) => Number(r.user_id)));
  const t = Date.now();
  for (const uid of members) {
    if (uid === senderId || blockedBy.has(uid)) continue;
    const mu = muted.get(uid) || 0;
    if (mu === -1 || mu > t) continue;
    const u = await getUser(uid);
    if (!u) continue;
    const group = chat.type === 'group' ? C.dec(chat.title_enc) || 'Group' : null;
    const previews = u.settings.previews;
    const urgent = msg.intent === 'urgent' || msg.sos;
    let body = previews ? (msg.effect === 'ink' ? 'Sent with Invisible Ink' : msg.preview) : 'New message';
    if (msg.sos) body = 'SOS — needs help now. Tap to see their live location.';
    else if (msg.kind === 'ping') body = msg.ping?.long ? 'Pinged you — really missing you' : 'Pinged you — thinking of you';
    else if (msg.kind === 'letter') body = 'Sent you a letter: ' + (msg.letter?.title || '');
    else if (urgent && previews) body = 'Urgent · ' + body;
    push.send(uid, {
      type: 'msg', title: previews || msg.sos ? (group || sender.name) : 'Ping Me', sender: previews && group ? sender.name : null,
      body, tag: 'chat-' + chatId, url: '/?chat=' + chatId, chatId, msgId: msg.id, ts: msg.createdAt, urgent, ping: msg.kind === 'ping',
    }, { urgency: 'high', ttl: 24 * 3600 }).catch(() => {}); // high = delivered right away even when the phone is idle (Doze)
  }
}

// Broadcast a message update. Letters are rendered per viewer so sealed text never leaks.
async function emitUpdate(chatId, id, actorId) {
  const row = await db.one('SELECT kind FROM messages WHERE id=?', [id]);
  if (row?.kind !== 'letter') return io.to('c:' + chatId).emit('msg:update', await loadMessage(id, actorId));
  for (const uid of await activeMemberIds(chatId)) emitToUser(uid, 'msg:update', await loadMessage(id, uid));
}

async function systemMessage(chatId, actorId, sys) {
  return insertMessage({ chatId, senderId: actorId, kind: 'system', body: { sys } });
}

async function emitChatChanged(chatId) {
  io.to('c:' + chatId).emit('chat:changed', { chatId });
}

async function deleteAttachmentIfUnused(attId) {
  if (!attId) return;
  const used = await db.one('SELECT 1 x FROM messages WHERE attachment_id=? AND deleted=0 LIMIT 1', [attId]);
  if (!used) {
    await db.q('DELETE FROM attachments WHERE id=?', [attId]);
    fileCache.delete(attId);
  }
}

// ─────────────────────────── HTTP: auth ───────────────────────────

const jsonBody = express.json({ limit: '2mb' });
const formBody = express.urlencoded({ extended: false, limit: '64kb' });
// Google redirect sign-in returns as a cross-site form POST. Those two endpoints are
// protected by one-time nonce cookies instead of the custom-header CSRF check.
const OAUTH_CALLBACKS = new Set(['/oauth/google/callback']);
app.use('/api', (req, res, next) => {
  if (req.path === '/upload') return next();
  if (OAUTH_CALLBACKS.has(req.path)) return formBody(req, res, next);
  return jsonBody(req, res, next);
});

// CSRF guard: every mutating API call must carry our custom header
// (browsers will not send it cross-site without a CORS preflight we never grant).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !OAUTH_CALLBACKS.has(req.path) && req.get('x-pingme') !== '1') {
    return res.status(403).json({ error: 'Bad request origin' });
  }
  next();
});

const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  attempts.set(key, arr);
  if (arr.length > max) throw new HttpError(429, 'Too many attempts. Please wait a minute.');
}
setInterval(() => { const t = Date.now(); for (const [k, v] of attempts) if (!v.some((x) => t - x < 600000)) attempts.delete(k); }, 600000).unref();

async function sessionUser(tokenStr) {
  if (!tokenStr) return null;
  const s = await db.one('SELECT user_id, last_used FROM sessions WHERE token_hash=?', [C.sha256(tokenStr)]);
  if (!s) return null;
  if (Date.now() - ms(s.last_used) > 3600 * 1000) {
    db.q('UPDATE sessions SET last_used=? WHERE token_hash=?', [now(), C.sha256(tokenStr)]).catch(() => {});
  }
  return Number(s.user_id);
}

const auth = wrap(async (req, res, next) => {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  const uid = await sessionUser(t);
  if (!uid) return res.status(401).json({ error: 'Please sign in' });
  req.uid = uid;
  req.token = t;
  next();
});

function addCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), cookie]);
}

function setSessionCookie(req, res, t) {
  const secure = req.secure ? '; Secure' : '';
  addCookie(res, `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure}`);
}

const clearSessionCookie = (res) => addCookie(res, `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

// Each phone / browser gets a permanent device id, so we know which device a session lives on.
const DEVICE_COOKIE = 'mm_dev';
function deviceHash(req) {
  if (!req.deviceHash) {
    let d = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
    if (!/^[\w-]{20,64}$/.test(d || '')) {
      d = C.token();
      req.newDeviceCookie = `${DEVICE_COOKIE}=${d}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365 * 5}${req.secure ? '; Secure' : ''}`;
    }
    req.deviceHash = C.hmac('dev:' + d);
  }
  return req.deviceHash;
}

async function createSession(req, res, userId) {
  const t = C.token();
  const dev = deviceHash(req);
  await db.q('DELETE FROM sessions WHERE user_id=? AND device_hash=?', [userId, dev]);
  await db.q('INSERT INTO sessions (token_hash, user_id, ua_enc, device_hash) VALUES (?,?,?,?)', [C.sha256(t), userId, C.enc(clampStr(req.get('user-agent') || '', 300)), dev]);
  setSessionCookie(req, res, t);
  if (req.newDeviceCookie) addCookie(res, req.newDeviceCookie);
}

function deviceLabel(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux computer' : 'another device';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} (${br})` : os;
}

// Strict rule: one account is signed in on one device at a time. Signing in somewhere new first asks
// "log out there and continue here?" — the answer comes back to /api/login/takeover with this ticket.
async function signInOrAsk(req, res, uid) {
  const other = await db.one(
    'SELECT ua_enc, last_used FROM sessions WHERE user_id=? AND (device_hash IS NULL OR device_hash<>?) AND last_used > ? ORDER BY last_used DESC LIMIT 1',
    [uid, deviceHash(req), new Date(Date.now() - 90 * 86400000)]
  );
  if (!other) { await createSession(req, res, uid); return null; }
  return { device: deviceLabel(C.dec(other.ua_enc) || ''), lastUsed: ms(other.last_used), ticket: C.enc({ takeover: uid, exp: Date.now() + 5 * 60000 }) };
}

async function signOutEverywhere(uid) {
  emitToUser(uid, 'session:ended', {});
  await db.q('DELETE FROM sessions WHERE user_id=?', [uid]);
  await db.q('DELETE FROM push_subs WHERE user_id=?', [uid]); // the old phone stops getting notifications too
  // Only the connections that exist right now (the old device) — never the new device's fresh one.
  const old = [...(online.get(uid) || [])];
  setTimeout(() => { for (const s of old) s.disconnect(true); }, 300);
}

// ───── usernames ─────

const unameHash = (u) => C.hmac('user:' + u);
const unameCanon = (u) => C.hmac('ucanon:' + U.canonical(u));

async function usernameProblem(username, exceptUid = null) {
  const reason = U.validate(username);
  if (reason) return reason;
  const row = await db.one('SELECT id FROM users WHERE uname_hash=? OR uname_canon=? LIMIT 1', [unameHash(username), unameCanon(username)]);
  if (row && Number(row.id) !== exceptUid) return 'That username is taken or too similar to an existing one';
  return null;
}

async function suggestUsernames(seed, n = 4) {
  const out = [];
  for (const s of U.suggestionsFor(seed)) {
    if (out.length >= n) break;
    if (!out.includes(s) && !(await usernameProblem(s))) out.push(s);
  }
  return out;
}

// Exact username first, then its look-alike skeleton (so "john.doe" finds "johndoe").
async function findUserIdByUsername(input) {
  const u = U.normalize(input);
  if (!u) return null;
  const row = (await db.one('SELECT id FROM users WHERE uname_hash=?', [unameHash(u)]))
    || (await db.one('SELECT id FROM users WHERE uname_canon=?', [unameCanon(u)]));
  return row ? Number(row.id) : null;
}

const inviteOnly = () => String(process.env.INVITE_ONLY || '').toLowerCase() === 'true';
const INVITES_PER_USER = 3;
const inviteHash = (code) => C.hmac('invite:' + String(code || '').trim().toUpperCase());

// Invite-only launch: a valid unused code is required — except for the very first account.
async function checkInvite(code) {
  if (!inviteOnly()) return null;
  const anyUser = await db.one('SELECT id FROM users LIMIT 1');
  if (!anyUser) return null;
  const row = await db.one('SELECT code_hash FROM invites WHERE code_hash=? AND used_by IS NULL', [inviteHash(code)]);
  if (!row) throw bad('Ping Me is invite-only right now — enter a valid invite code (ask a friend for one of their Golden Keys)');
  return row.code_hash;
}

async function createUser({ username, name, password = null, email = null, birth, invite, guest = false }) {
  const problem = await usernameProblem(username);
  if (problem) throw bad(problem);
  const birthDate = guest ? null : parseBirth(birth);
  const inviteRow = guest ? null : await checkInvite(invite);
  try {
    const r = await db.q(
      `INSERT INTO users (uname_hash, uname_canon, uname_enc, pass_hash, email_enc, birth_enc, name_enc, settings_enc, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [unameHash(username), unameCanon(username), C.enc(username), password ? await C.hashPassword(password) : null,
        email ? C.enc(email) : null, birthDate ? C.enc(birthDate) : null, C.enc(name || username), C.enc({ ...DEFAULT_SETTINGS, features: FEATURES, onboarded: guest, guest }), now()]
    );
    const uid = Number(r.insertId);
    if (inviteRow) {
      const used = await db.q('UPDATE invites SET used_by=?, used_at=? WHERE code_hash=? AND used_by IS NULL', [uid, now(), inviteRow]);
      if (!used.affectedRows) { await db.q('DELETE FROM users WHERE id=?', [uid]); throw bad('That invite code was just used — ask for another'); }
    }
    return uid;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bad('That username was just taken — try another');
    throw e;
  }
}

app.get('/api/username/check', wrap(async (req, res) => {
  rateLimit('ucheck:' + req.ip, 90, 60000);
  const username = U.normalize(clampStr(req.query.u, 40));
  const uid = await sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
  const problem = await usernameProblem(username, uid);
  const seed = clampStr(req.query.name, 60) || username;
  res.json({ username, ok: !problem, reason: problem, suggestions: problem ? await suggestUsernames(seed) : [] });
}));

app.post('/api/register', wrap(async (req, res) => {
  rateLimit('reg:' + req.ip, 10, 60000);
  const username = U.normalize(clampStr(req.body.username, 40));
  const password = String(req.body.password || '');
  const name = clampStr(req.body.name, 60).trim();
  if (!name) throw bad('Please enter your name');
  if (password.length < 8) throw bad('Password must be at least 8 characters');
  if (password.length > 200) throw bad('Password is too long');
  const uid = await createUser({ username, name, password, birth: req.body.birth, invite: req.body.invite });
  await createSession(req, res, uid);
  res.json({ user: await meView(uid) });
}));

app.post('/api/login', wrap(async (req, res) => {
  rateLimit('login:' + req.ip, 10, 60000);
  const username = U.normalize(clampStr(req.body.username, 40));
  rateLimit('login-u:' + username, 10, 60000);
  const uid = await findUserIdByUsername(username);
  const row = uid ? await db.one('SELECT pass_hash FROM users WHERE id=?', [uid]) : null;
  const ok = row?.pass_hash && (await C.verifyPassword(String(req.body.password || ''), row.pass_hash));
  if (!ok) throw new HttpError(401, row && !row.pass_hash ? 'This account signs in with Google' : 'Wrong username or password');
  const conflict = await signInOrAsk(req, res, uid);
  if (conflict) return res.json({ conflict });
  res.json({ user: await meView(uid) });
}));

// "Log out on the other device and sign in here."
app.post('/api/login/takeover', wrap(async (req, res) => {
  rateLimit('takeover:' + req.ip, 10, 60000);
  const t = C.decJson(String(req.body.ticket || ''));
  if (!t || !t.takeover || t.exp < Date.now()) throw bad('That took too long — please sign in again');
  const uid = Number(t.takeover);
  if (!(await getUser(uid))) throw notFound('Account not found');
  await signOutEverywhere(uid);
  await createSession(req, res, uid);
  res.json({ user: await meView(uid) });
}));

app.post('/api/logout', auth, wrap(async (req, res) => {
  await db.q('DELETE FROM sessions WHERE token_hash=?', [C.sha256(req.token)]);
  if (req.body?.endpoint) await push.unsubscribe(req.body.endpoint);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

// ───── Sign in with Google ─────

const PROVIDER_LABEL = { google: 'Google' };
const NONCE_COOKIE = 'mm_nonce';
const LINK_COOKIE = 'mm_link';
// SameSite=None so the cookies survive the provider's cross-site redirect back to us.
const oauthCookie = (name, value, maxAge) => `${name}=${value}; Path=/api/oauth; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`;
const publicOrigin = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function clearOauthCookies(res) {
  addCookie(res, oauthCookie(NONCE_COOKIE, '', 0));
  addCookie(res, oauthCookie(LINK_COOKIE, '', 0));
}

app.get('/api/oauth/start', wrap(async (req, res) => {
  rateLimit('ostart:' + req.ip, 30, 60000);
  const nonce = C.token();
  addCookie(res, oauthCookie(NONCE_COOKIE, nonce, 900));
  if (req.query.link) {
    const uid = await sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
    if (!uid) throw new HttpError(401, 'Please sign in');
    addCookie(res, oauthCookie(LINK_COOKIE, encodeURIComponent(C.enc({ uid, exp: Date.now() + 900000 })), 900));
  }
  const origin = publicOrigin(req);
  res.json({ nonce, redirect: { google: origin + '/api/oauth/google/callback' } });
}));

function linkUidFrom(req) {
  const raw = parseCookies(req.headers.cookie)[LINK_COOKIE];
  const v = raw && C.decJson(raw);
  return v && v.exp > Date.now() ? Number(v.uid) : null;
}

// Shared by popup + redirect flows. Returns what the client should do next.
async function completeOauth(req, res, identity, linkUid) {
  const subHash = C.hmac(`oauth:${identity.provider}:${identity.sub}`);
  const row = await db.one('SELECT user_id FROM oauth_accounts WHERE provider=? AND subject_hash=?', [identity.provider, subHash]);
  const label = PROVIDER_LABEL[identity.provider];
  if (linkUid) {
    if (row && Number(row.user_id) !== linkUid) throw bad(`That ${label} account is already used by another Ping Me account`);
    if (!row) {
      await db.q('DELETE FROM oauth_accounts WHERE user_id=? AND provider=?', [linkUid, identity.provider]);
      await db.q('INSERT INTO oauth_accounts (provider, subject_hash, user_id, email_enc) VALUES (?,?,?,?)', [identity.provider, subHash, linkUid, identity.email ? C.enc(identity.email) : null]);
    }
    return { kind: 'linked', provider: identity.provider };
  }
  if (row) {
    const uid = Number(row.user_id);
    if (await getUser(uid)) {
      const conflict = await signInOrAsk(req, res, uid);
      if (conflict) return { kind: 'conflict', conflict };
      return { kind: 'login', user: await meView(uid) };
    }
    await db.q('DELETE FROM oauth_accounts WHERE provider=? AND subject_hash=?', [identity.provider, subHash]);
  }
  // New person: they pick a username next. The ticket is encrypted + expires in 15 minutes.
  const name = identity.name || (identity.email ? identity.email.split('@')[0] : '');
  const ticket = C.enc({ p: identity.provider, sub: identity.sub, email: identity.email, name, exp: Date.now() + 900000 });
  return { kind: 'signup', ticket, provider: identity.provider, name, suggestions: await suggestUsernames(name || 'user') };
}

app.post('/api/oauth/complete', wrap(async (req, res) => {
  rateLimit('ocomplete:' + req.ip, 20, 60000);
  const t = C.decJson(String(req.body.ticket || ''));
  if (!t || !t.sub || !PROVIDER_LABEL[t.p] || t.exp < Date.now()) throw bad('Sign-in expired — please start again');
  const subHash = C.hmac(`oauth:${t.p}:${t.sub}`);
  if (await db.one('SELECT 1 x FROM oauth_accounts WHERE provider=? AND subject_hash=?', [t.p, subHash])) throw bad('This account is already registered — sign in instead');
  const name = clampStr(req.body.name, 60).trim() || t.name;
  if (!name) throw bad('Please enter your name');
  const uid = await createUser({ username: U.normalize(clampStr(req.body.username, 40)), name, email: t.email, birth: req.body.birth, invite: req.body.invite });
  await db.q('INSERT INTO oauth_accounts (provider, subject_hash, user_id, email_enc) VALUES (?,?,?,?)', [t.p, subHash, uid, t.email ? C.enc(t.email) : null]);
  await createSession(req, res, uid);
  res.json({ user: await meView(uid) });
}));

// Popup flow: the browser hands us the ID token directly.
app.post('/api/oauth/:provider(google)', wrap(async (req, res) => {
  rateLimit('oauth:' + req.ip, 20, 60000);
  const provider = req.params.provider;
  const nonce = parseCookies(req.headers.cookie)[NONCE_COOKIE];
  const identity = await oauth.verifyIdToken(provider, req.body.idToken, { nonce: nonce || '' }).catch((e) => { throw bad(e.message); });
  const linkUid = req.body.link ? await sessionUser(parseCookies(req.headers.cookie)[COOKIE]) : null;
  if (req.body.link && !linkUid) throw new HttpError(401, 'Please sign in');
  clearOauthCookies(res);
  res.json(await completeOauth(req, res, identity, linkUid));
}));

// Redirect flow (used by the installed app, where popups are unreliable).
async function oauthRedirect(req, res, provider, idToken, name) {
  const back = (path) => res.redirect(303, path);
  try {
    rateLimit('oauth:' + req.ip, 20, 60000);
    const nonce = parseCookies(req.headers.cookie)[NONCE_COOKIE];
    const identity = await oauth.verifyIdToken(provider, idToken, { nonce: nonce || '' });
    if (!identity.name && name) identity.name = clampStr(name, 60).trim();
    const linkUid = linkUidFrom(req);
    clearOauthCookies(res);
    const r = await completeOauth(req, res, identity, linkUid);
    if (r.kind === 'login') return back('/');
    if (r.kind === 'conflict') return back(`/#takeover=${encodeURIComponent(Buffer.from(JSON.stringify(r.conflict)).toString('base64url'))}`);
    if (r.kind === 'linked') return back(`/?linked=${provider}`);
    return back(`/#signup=${encodeURIComponent(Buffer.from(JSON.stringify(r)).toString('base64url'))}`);
  } catch (e) {
    clearOauthCookies(res);
    return back(`/?authError=${encodeURIComponent(e.message || 'Sign-in failed')}`);
  }
}

app.post('/api/oauth/google/callback', wrap(async (req, res) => {
  // Google's double-submit CSRF token: cookie must match the posted value.
  const cookieTok = parseCookies(req.headers.cookie).g_csrf_token;
  if (!cookieTok || cookieTok !== req.body.g_csrf_token) return res.redirect(303, '/?authError=' + encodeURIComponent('Google sign-in was interrupted — please try again'));
  return oauthRedirect(req, res, 'google', req.body.credential);
}));

// ───── me ─────

async function meView(uid) {
  const u = await getUser(uid);
  const row = await db.one('SELECT pass_hash FROM users WHERE id=?', [uid]);
  const links = await db.q('SELECT provider, email_enc FROM oauth_accounts WHERE user_id=?', [uid]);
  return {
    id: u.id, username: u.username, name: u.name, bio: u.bio, avatarV: u.avatarV, settings: u.settings, createdAt: u.createdAt,
    hasPassword: !!row?.pass_hash,
    links: links.map((l) => ({ provider: l.provider, email: C.dec(l.email_enc) })),
    birth: u.birth,
  };
}

function broadcastUser(uid) {
  return publicUser(uid).then((pu) => {
    for (const s of online.get(uid) || []) for (const room of s.rooms) if (room.startsWith('c:')) io.to(room).emit('user:update', pu);
    emitToUser(uid, 'user:update', pu);
  });
}

app.get('/api/me', auth, wrap(async (req, res) => res.json({ user: await meView(req.uid) })));

// Startup check: "who am I?" without a 401 for signed-out visitors.
app.get('/api/session', wrap(async (req, res) => {
  const uid = await sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
  res.json({ user: uid && (await getUser(uid)) ? await meView(uid) : null });
}));

app.patch('/api/me', auth, wrap(async (req, res) => {
  const u = await getUser(req.uid);
  const sets = [], vals = [];
  if (typeof req.body.name === 'string') {
    const name = clampStr(req.body.name, 60).trim();
    if (!name) throw bad('Name cannot be empty');
    sets.push('name_enc=?'); vals.push(C.enc(name));
  }
  if (typeof req.body.bio === 'string') { sets.push('bio_enc=?'); vals.push(C.enc(clampStr(req.body.bio, 200))); }
  if (req.body.avatar !== undefined) {
    const a = req.body.avatar;
    if (a === null) { sets.push('avatar_enc=NULL', 'avatar_v=?'); vals.push(Date.now()); }
    else {
      if (typeof a !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(a) || a.length > 600000) throw bad('Avatar must be a PNG/JPEG/WebP under 400KB');
      sets.push('avatar_enc=?', 'avatar_v=?'); vals.push(C.enc(a), Date.now());
    }
  }
  if (req.body.settings && typeof req.body.settings === 'object') {
    const inSet = req.body.settings;
    const s = { ...u.settings, features: { ...u.settings.features } };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof inSet[k] === 'boolean') s[k] = inSet[k];
    if (inSet.features && typeof inSet.features === 'object') {
      for (const k of Object.keys(FEATURES)) if (typeof inSet.features[k] === 'boolean') s.features[k] = inSet.features[k];
    }
    if (typeof inSet.onboarded === 'boolean') s.onboarded = inSet.onboarded;
    if (Array.isArray(inSet.trusted)) {
      // Trusted contacts (SOS + friend recovery): up to 5 people you share a conversation with.
      const ids = [...new Set(inSet.trusted.map(toInt).filter((x) => x && x !== req.uid))].slice(0, 5);
      for (const id of ids) {
        const shared = await db.one('SELECT 1 x FROM chat_members a JOIN chat_members b ON a.chat_id=b.chat_id WHERE a.user_id=? AND b.user_id=? LIMIT 1', [req.uid, id]);
        if (!shared) throw bad('Trusted contacts must be people you already chat with');
      }
      s.trusted = ids;
    }
    sets.push('settings_enc=?'); vals.push(C.enc(s));
  }
  if (req.body.birth !== undefined) { sets.push('birth_enc=?'); vals.push(C.enc(parseBirth(req.body.birth))); }
  if (sets.length) {
    await db.q(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, [...vals, req.uid]);
    userCache.delete(req.uid);
    await broadcastUser(req.uid);
  }
  res.json({ user: await meView(req.uid) });
}));

app.post('/api/me/username', auth, wrap(async (req, res) => {
  rateLimit('uname:' + req.uid, 5, 3600000);
  const username = U.normalize(clampStr(req.body.username, 40));
  const problem = await usernameProblem(username, req.uid);
  if (problem) throw bad(problem);
  try {
    await db.q('UPDATE users SET uname_hash=?, uname_canon=?, uname_enc=? WHERE id=?', [unameHash(username), unameCanon(username), C.enc(username), req.uid]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bad('That username was just taken — try another');
    throw e;
  }
  userCache.delete(req.uid);
  await broadcastUser(req.uid);
  res.json({ user: await meView(req.uid) });
}));

app.post('/api/me/password', auth, wrap(async (req, res) => {
  rateLimit('pw:' + req.uid, 5, 60000);
  const row = await db.one('SELECT pass_hash FROM users WHERE id=?', [req.uid]);
  // Accounts created with Google can set a first password without a current one.
  if (row.pass_hash && !(await C.verifyPassword(String(req.body.current || ''), row.pass_hash))) throw bad('Current password is wrong');
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('New password must be at least 8 characters');
  if (next.length > 200) throw bad('Password is too long');
  await db.q('UPDATE users SET pass_hash=? WHERE id=?', [await C.hashPassword(next), req.uid]);
  // Sign out every other device.
  await db.q('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [req.uid, C.sha256(req.token)]);
  res.json({ ok: true, user: await meView(req.uid) });
}));

app.delete('/api/me/links/:provider(google)', auth, wrap(async (req, res) => {
  const me = await meView(req.uid);
  if (!me.hasPassword && me.links.filter((l) => l.provider !== req.params.provider).length === 0) {
    throw bad('Set a password or link another sign-in method first, so you don’t get locked out');
  }
  await db.q('DELETE FROM oauth_accounts WHERE user_id=? AND provider=?', [req.uid, req.params.provider]);
  res.json({ user: await meView(req.uid) });
}));

app.get('/api/me/sessions', auth, wrap(async (req, res) => {
  const rows = await db.q('SELECT token_hash, ua_enc, created_at, last_used FROM sessions WHERE user_id=? ORDER BY last_used DESC', [req.uid]);
  const cur = C.sha256(req.token);
  res.json({ sessions: rows.map((r) => ({ id: r.token_hash.slice(0, 16), ua: C.dec(r.ua_enc), createdAt: ms(r.created_at), lastUsed: ms(r.last_used), current: r.token_hash === cur })) });
}));

app.post('/api/me/sessions/logout-others', auth, wrap(async (req, res) => {
  await db.q('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [req.uid, C.sha256(req.token)]);
  res.json({ ok: true });
}));

app.delete('/api/me', auth, wrap(async (req, res) => {
  rateLimit('del:' + req.uid, 5, 60000);
  const row = await db.one('SELECT pass_hash FROM users WHERE id=?', [req.uid]);
  const u = await getUser(req.uid);
  if (row.pass_hash) {
    if (!(await C.verifyPassword(String(req.body.password || ''), row.pass_hash))) throw bad('Password is wrong');
  } else if (U.normalize(req.body.confirm) !== u.username) {
    throw bad('Type your username exactly to confirm');
  }
  const chats = await db.q('SELECT chat_id FROM chat_members WHERE user_id=? AND active=1', [req.uid]);
  await db.q('UPDATE chat_members SET active=0 WHERE user_id=?', [req.uid]);
  for (const t of ['sessions', 'push_subs', 'oauth_accounts']) await db.q(`DELETE FROM ${t} WHERE user_id=?`, [req.uid]);
  await db.q('DELETE FROM blocks WHERE user_id=? OR blocked_id=?', [req.uid, req.uid]);
  await db.q('DELETE FROM scheduled_messages WHERE sender_id=?', [req.uid]);
  await db.q('DELETE FROM users WHERE id=?', [req.uid]);
  userCache.delete(req.uid);
  for (const c of chats) emitChatChanged(Number(c.chat_id));
  for (const s of online.get(req.uid) || []) s.disconnect(true);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

// ─────────────────────────── HTTP: users ───────────────────────────

app.get('/api/users/lookup', auth, wrap(async (req, res) => {
  rateLimit('lookup:' + req.uid, 60, 60000);
  const id = await findUserIdByUsername(clampStr(req.query.u, 40));
  if (!id) throw notFound('No one has that username');
  res.json({ user: await publicUser(id) });
}));

app.get('/api/users/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  // Only users you share a conversation with.
  const shared = await db.one(
    'SELECT 1 x FROM chat_members a JOIN chat_members b ON a.chat_id=b.chat_id WHERE a.user_id=? AND b.user_id=? LIMIT 1',
    [req.uid, id]
  );
  if (!shared && id !== req.uid) throw notFound();
  res.json({ user: await publicUser(id) });
}));

app.get('/api/blocks', auth, wrap(async (req, res) => {
  const rows = await db.q('SELECT blocked_id FROM blocks WHERE user_id=?', [req.uid]);
  res.json({ users: await Promise.all(rows.map((r) => publicUser(Number(r.blocked_id)))) });
}));

app.post('/api/blocks/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id || id === req.uid) throw bad('Invalid user');
  await db.q('INSERT IGNORE INTO blocks (user_id, blocked_id) VALUES (?,?)', [req.uid, id]);
  res.json({ ok: true });
}));

app.delete('/api/blocks/:id', auth, wrap(async (req, res) => {
  await db.q('DELETE FROM blocks WHERE user_id=? AND blocked_id=?', [req.uid, toInt(req.params.id)]);
  res.json({ ok: true });
}));

async function sendAvatar(res, enc) {
  const dataUrl = C.dec(enc);
  const m = dataUrl && /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(m[2], 'base64'));
}

app.get('/api/avatar/u/:id', auth, wrap(async (req, res) => {
  const r = await db.one('SELECT avatar_enc FROM users WHERE id=?', [toInt(req.params.id)]);
  if (!r || !r.avatar_enc) return res.status(404).end();
  sendAvatar(res, r.avatar_enc);
}));

app.get('/api/avatar/c/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const r = await db.one('SELECT avatar_enc FROM chats WHERE id=?', [id]);
  if (!r || !r.avatar_enc) return res.status(404).end();
  sendAvatar(res, r.avatar_enc);
}));

// ─────────────────────────── HTTP: chats ───────────────────────────

// ICE servers for calls. STUN alone only works when both phones can reach each other directly —
// mobile networks (Jio/Airtel/Vi carrier NAT) usually can't, so calls need a TURN relay.
// Cloudflare TURN (CF_TURN_KEY_ID + CF_TURN_API_TOKEN) hands out short-lived credentials;
// a fixed TURN server (TURN_URLS/USERNAME/CREDENTIAL) works too.
const CF_TTL = 24 * 3600;
let cfIce = { at: 0, list: null, pending: null };
async function cloudflareIce() {
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return [];
  if (cfIce.list && Date.now() - cfIce.at < (CF_TTL / 2) * 1000) return cfIce.list;
  if (!cfIce.pending) {
    cfIce.pending = (async () => {
      try {
        const r = await fetch(`${process.env.CF_TURN_API || 'https://rtc.live.cloudflare.com'}/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: CF_TTL }), signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw new Error('Cloudflare TURN ' + r.status + ' ' + (await r.text()).slice(0, 200));
        const d = await r.json();
        const list = (Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers]).filter(Boolean)
          // Port 53 entries make browsers stall — Cloudflare's own docs say to drop them.
          .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
          .filter((s) => s.urls.length);
        cfIce = { at: Date.now(), list, pending: null };
        return list;
      } catch (e) {
        console.error('TURN credentials failed:', e.message);
        cfIce.pending = null;
        return cfIce.list || [];
      }
    })();
  }
  return cfIce.pending;
}

async function iceServers() {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URLS) {
    ice.push({
      urls: process.env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  ice.push(...(await cloudflareIce()));
  return ice;
}
const hasRelay = (ice) => ice.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));

app.get('/api/ice', auth, wrap(async (req, res) => {
  const ice = await iceServers();
  res.json({ iceServers: ice, relay: hasRelay(ice) });
}));

// Public: STUN only. Relay credentials come from /api/ice, signed-in people only.
app.get('/api/config', (req, res) => {
  res.json({
    instance: INSTANCE_ID,
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    relay: !!(process.env.TURN_URLS || (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN)),
    vapidPublicKey: push.enabled ? process.env.VAPID_PUBLIC_KEY : null,
    maxUpload: MAX_UPLOAD,
    googleClientId: oauth.enabled('google') ? process.env.GOOGLE_CLIENT_ID.split(',')[0].trim() : null,
    inviteOnly: inviteOnly(),
    features: FEATURES,
  });
});

app.get('/api/chats', auth, wrap(async (req, res) => {
  const chats = await serializeChats(req.uid);
  const userIds = new Set();
  for (const c of chats) for (const m of c.members) userIds.add(m.id);
  const users = await Promise.all([...userIds].map((id) => publicUser(id)));
  const blocks = await db.q('SELECT blocked_id FROM blocks WHERE user_id=?', [req.uid]);
  res.json({ chats, users, blocked: blocks.map((b) => Number(b.blocked_id)) });
}));

app.get('/api/chats/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const [chat] = await serializeChats(req.uid, id);
  const users = await Promise.all(chat.members.map((m) => publicUser(m.id)));
  res.json({ chat, users });
}));

app.post('/api/chats', auth, wrap(async (req, res) => {
  const type = req.body.type === 'group' ? 'group' : 'direct';
  if (type === 'direct') {
    const other = toInt(req.body.userId);
    if (!other || other === req.uid) throw bad('Pick someone to message');
    if (!(await getUser(other))) throw notFound('User not found');
    const key = C.sha256(`direct:${Math.min(req.uid, other)}:${Math.max(req.uid, other)}`);
    let chat = await db.one('SELECT id FROM chats WHERE direct_key=?', [key]);
    let chatId;
    if (chat) {
      chatId = Number(chat.id);
      await db.q('UPDATE chat_members SET active=1, removed=0 WHERE chat_id=? AND user_id=?', [chatId, req.uid]);
    } else {
      const r = await db.q('INSERT INTO chats (type, direct_key, created_by) VALUES (?,?,?)', ['direct', key, req.uid]);
      chatId = Number(r.insertId);
      await db.q('INSERT INTO chat_members (chat_id, user_id, role) VALUES (?,?,?), (?,?,?)', [chatId, req.uid, 'admin', chatId, other, 'admin']);
      joinUserToChat(other, chatId);
      emitToUser(other, 'chat:changed', { chatId });
    }
    joinUserToChat(req.uid, chatId);
    const [c] = await serializeChats(req.uid, chatId);
    return res.json({ chat: c, users: await Promise.all(c.members.map((m) => publicUser(m.id))) });
  }

  const title = clampStr(req.body.title, 80).trim();
  const ids = [...new Set((Array.isArray(req.body.memberIds) ? req.body.memberIds : []).map(toInt).filter((x) => x && x !== req.uid))].slice(0, 255);
  if (!ids.length) throw bad('Add at least one person');
  for (const id of ids) if (!(await getUser(id))) throw bad('One of those users no longer exists');
  const r = await db.q('INSERT INTO chats (type, title_enc, created_by) VALUES (?,?,?)', ['group', C.enc(title || 'Group'), req.uid]);
  const chatId = Number(r.insertId);
  const rows = [[chatId, req.uid, 'admin'], ...ids.map((id) => [chatId, id, 'member'])];
  await db.q('INSERT INTO chat_members (chat_id, user_id, role) VALUES ?', [rows]);
  for (const [, uid] of rows) joinUserToChat(uid, chatId);
  await systemMessage(chatId, req.uid, { type: 'created', title: title || 'Group' });
  for (const id of ids) emitToUser(id, 'chat:changed', { chatId });
  const [c] = await serializeChats(req.uid, chatId);
  res.json({ chat: c, users: await Promise.all(c.members.map((m) => publicUser(m.id))) });
}));

app.patch('/api/chats/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const chat = await db.one('SELECT * FROM chats WHERE id=?', [id]);
  // Like iMessage, any member may rename the group or change its photo.
  if (typeof req.body.title === 'string' && chat.type === 'group') {
    const title = clampStr(req.body.title, 80).trim() || 'Group';
    await db.q('UPDATE chats SET title_enc=? WHERE id=?', [C.enc(title), id]);
    await systemMessage(id, req.uid, { type: 'renamed', title });
  }
  if (req.body.avatar !== undefined && chat.type === 'group') {
    const a = req.body.avatar;
    if (a !== null && (typeof a !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(a) || a.length > 600000)) throw bad('Photo must be under 400KB');
    await db.q('UPDATE chats SET avatar_enc=?, avatar_v=? WHERE id=?', [a ? C.enc(a) : null, Date.now(), id]);
    await systemMessage(id, req.uid, { type: 'photo' });
  }
  if (req.body.disappearSecs !== undefined) {
    const secs = [-1, 0, 30, 300, 3600, 86400, 604800, 7776000].includes(Number(req.body.disappearSecs)) ? Number(req.body.disappearSecs) : 0;
    await db.q('UPDATE chats SET disappear_secs=? WHERE id=?', [secs, id]);
    await systemMessage(id, req.uid, { type: 'disappear', secs });
  }
  emitChatChanged(id);
  const [c] = await serializeChats(req.uid, id);
  res.json({ chat: c });
}));

// Per-user conversation preferences.
app.patch('/api/chats/:id/prefs', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const sets = [], vals = [];
  if (req.body.mutedUntil !== undefined) { sets.push('muted_until=?'); vals.push(Number(req.body.mutedUntil) || 0); }
  if (req.body.pinned !== undefined) { sets.push('pinned=?'); vals.push(req.body.pinned ? 1 : 0); }
  if (req.body.archived !== undefined) { sets.push('archived=?'); vals.push(req.body.archived ? 1 : 0); }
  if (sets.length) await db.q(`UPDATE chat_members SET ${sets.join(', ')} WHERE chat_id=? AND user_id=?`, [...vals, id, req.uid]);
  emitToUser(req.uid, 'chat:changed', { chatId: id });
  res.json({ ok: true });
}));

app.post('/api/chats/:id/unread', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const last = await db.one('SELECT MAX(id) mid FROM messages WHERE chat_id=? AND sender_id<>?', [id, req.uid]);
  if (last?.mid) await db.q('UPDATE chat_members SET last_read_id=? WHERE chat_id=? AND user_id=?', [Number(last.mid) - 1, id, req.uid]);
  emitToUser(req.uid, 'chat:changed', { chatId: id });
  res.json({ ok: true });
}));

app.post('/api/chats/:id/read', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const last = await db.one('SELECT MAX(id) mid FROM messages WHERE chat_id=?', [id]);
  if (last?.mid) await markChatRead(id, req.uid, Number(last.mid));
  res.json({ ok: true });
}));

app.post('/api/calls/:id/decline', auth, wrap(async (req, res) => {
  await declineCall(req.uid, { callId: req.params.id });
  res.json({ ok: true });
}));

app.post('/api/chats/:id/clear', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const last = await db.one('SELECT MAX(id) mid FROM messages WHERE chat_id=?', [id]);
  await db.q('UPDATE chat_members SET cleared_before_id=? WHERE chat_id=? AND user_id=?', [Number(last?.mid || 0), id, req.uid]);
  emitToUser(req.uid, 'chat:changed', { chatId: id });
  res.json({ ok: true });
}));

// "Delete conversation" for me: clears history and hides it until a new message arrives.
app.delete('/api/chats/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const chat = await db.one('SELECT type FROM chats WHERE id=?', [id]);
  const last = await db.one('SELECT MAX(id) mid FROM messages WHERE chat_id=?', [id]);
  await db.q('UPDATE chat_members SET cleared_before_id=?, removed=1, archived=0, pinned=0 WHERE chat_id=? AND user_id=?', [Number(last?.mid || 0), id, req.uid]);
  if (chat.type === 'group') await leaveGroup(id, req.uid, req.uid);
  res.json({ ok: true });
}));

async function leaveGroup(chatId, userId, actorId) {
  await db.q('UPDATE chat_members SET active=0 WHERE chat_id=? AND user_id=?', [chatId, userId]);
  // Make sure the group always has an admin.
  const admins = await db.one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND active=1 AND role='admin'", [chatId]);
  if (!Number(admins.n)) {
    await db.q("UPDATE chat_members SET role='admin' WHERE chat_id=? AND active=1 ORDER BY joined_at LIMIT 1", [chatId]);
  }
  await systemMessage(chatId, actorId, actorId === userId ? { type: 'left', user: userId } : { type: 'removed', user: userId });
  leaveUserFromChat(userId, chatId);
  emitToUser(userId, 'chat:changed', { chatId });
  emitChatChanged(chatId);
}

app.post('/api/chats/:id/members', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const chat = await db.one('SELECT type FROM chats WHERE id=?', [id]);
  if (chat.type !== 'group') throw bad('Create a group to add more people');
  const ids = [...new Set((req.body.userIds || []).map(toInt).filter(Boolean))].slice(0, 100);
  const added = [];
  for (const uid of ids) {
    if (!(await getUser(uid))) continue;
    await db.q('INSERT INTO chat_members (chat_id, user_id, role, active) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE active=1', [id, uid, 'member']);
    joinUserToChat(uid, id);
    emitToUser(uid, 'chat:changed', { chatId: id });
    added.push(uid);
  }
  if (added.length) await systemMessage(id, req.uid, { type: 'added', users: added });
  emitChatChanged(id);
  res.json({ ok: true });
}));

app.delete('/api/chats/:id/members/:uid', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id), uid = toInt(req.params.uid);
  const me = await requireMember(id, req.uid);
  const chat = await db.one('SELECT type FROM chats WHERE id=?', [id]);
  if (chat.type !== 'group') throw bad('Not a group');
  if (uid !== req.uid && me.role !== 'admin') throw forbidden('Only admins can remove people');
  await leaveGroup(id, uid, req.uid);
  res.json({ ok: true });
}));

app.post('/api/chats/:id/admins/:uid', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id), uid = toInt(req.params.uid);
  const me = await requireMember(id, req.uid);
  if (me.role !== 'admin') throw forbidden('Only admins can do that');
  const role = req.body.admin ? 'admin' : 'member';
  await db.q('UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=? AND active=1', [role, id, uid]);
  emitChatChanged(id);
  res.json({ ok: true });
}));

app.get('/api/chats/:id/messages', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const me = await requireMember(id, req.uid);
  const limit = Math.min(100, toInt(req.query.limit) || 50);
  const floor = Number(me.cleared_before_id);
  const hidden = 'AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id=m.id AND h.user_id=?)';
  let rows;
  if (toInt(req.query.around)) {
    const a = toInt(req.query.around);
    const older = await db.q(`SELECT m.* FROM messages m WHERE chat_id=? AND id>? AND id<=? ${hidden} ORDER BY id DESC LIMIT ?`, [id, floor, a, req.uid, Math.ceil(limit / 2)]);
    const newer = await db.q(`SELECT m.* FROM messages m WHERE chat_id=? AND id>? ${hidden} ORDER BY id ASC LIMIT ?`, [id, a, req.uid, Math.floor(limit / 2)]);
    rows = [...older.reverse(), ...newer];
  } else if (toInt(req.query.after)) {
    rows = await db.q(`SELECT m.* FROM messages m WHERE chat_id=? AND id>? AND id>? ${hidden} ORDER BY id ASC LIMIT ?`, [id, floor, toInt(req.query.after), req.uid, limit]);
  } else {
    const before = toInt(req.query.before) || Number.MAX_SAFE_INTEGER;
    rows = (await db.q(`SELECT m.* FROM messages m WHERE chat_id=? AND id>? AND id<? ${hidden} ORDER BY id DESC LIMIT ?`, [id, floor, before, req.uid, limit])).reverse();
  }
  res.json({ messages: await serializeMessages(rows, req.uid), hasMore: rows.length >= limit });
}));

app.get('/api/chats/:id/media', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const me = await requireMember(id, req.uid);
  const rows = await db.q(
    `SELECT m.* FROM messages m WHERE chat_id=? AND id>? AND deleted=0 AND kind IN ('image','video','file','audio','location','text')
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id=m.id AND h.user_id=?) ORDER BY id DESC LIMIT 1500`,
    [id, Number(me.cleared_before_id), req.uid]
  );
  const msgs = await serializeMessages(rows, req.uid, { light: true });
  const urlRe = /https?:\/\/[^\s<>"']+/g;
  const out = { media: [], files: [], links: [], locations: [], voice: [] };
  for (const m of msgs) {
    if (m.secure || m.eyes) continue; // private messages stay out of the shared-media gallery
    if (m.kind === 'image' || m.kind === 'video') out.media.push(m);
    else if (m.kind === 'file') out.files.push(m);
    else if (m.kind === 'audio') out.voice.push(m);
    else if (m.kind === 'location') out.locations.push(m);
    if (m.text) for (const u of m.text.match(urlRe) || []) out.links.push({ id: m.id, url: u, createdAt: m.createdAt, senderId: m.senderId });
  }
  res.json(out);
}));

app.get('/api/chats/:id/pinned', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const rows = await db.q('SELECT * FROM messages WHERE chat_id=? AND pinned=1 AND deleted=0 ORDER BY id DESC LIMIT 50', [id]);
  res.json({ messages: await serializeMessages(rows, req.uid) });
}));

app.get('/api/chats/:id/scheduled', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  await requireMember(id, req.uid);
  const rows = await db.q('SELECT id, payload_enc, send_at FROM scheduled_messages WHERE chat_id=? AND sender_id=? ORDER BY send_at', [id, req.uid]);
  res.json({ scheduled: rows.map((r) => { const p = C.decJson(r.payload_enc, {}); return { id: Number(r.id), sendAt: ms(r.send_at), kind: p.kind, text: p.body?.text || '', preview: preview({ kind: p.kind, ...p.body }) }; }) });
}));

app.delete('/api/scheduled/:id', auth, wrap(async (req, res) => {
  await db.q('DELETE FROM scheduled_messages WHERE id=? AND sender_id=?', [toInt(req.params.id), req.uid]);
  res.json({ ok: true });
}));

app.get('/api/search', auth, wrap(async (req, res) => {
  rateLimit('search:' + req.uid, 30, 60000);
  const q = clampStr(req.query.q, 100).trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const chatFilter = toInt(req.query.chatId);
  const rows = await db.q(
    `SELECT m.* FROM messages m JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=? AND cm.active=1
      WHERE m.deleted=0 AND m.kind IN ('text','image','video','file','location','poll') AND m.id>cm.cleared_before_id
        ${chatFilter ? 'AND m.chat_id=?' : ''}
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id=m.id AND h.user_id=?)
      ORDER BY m.id DESC LIMIT 5000`,
    chatFilter ? [req.uid, chatFilter, req.uid] : [req.uid, req.uid]
  );
  const msgs = await serializeMessages(rows, req.uid, { light: true });
  const results = [];
  for (const m of msgs) {
    if (m.secure || m.eyes) continue; // private messages are never searchable
    const hay = [m.text, m.att?.name, m.loc?.label, m.poll?.q, ...(m.poll?.opts || [])].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) results.push({ id: m.id, chatId: m.chatId, senderId: m.senderId, createdAt: m.createdAt, preview: m.preview, kind: m.kind });
    if (results.length >= 80) break;
  }
  res.json({ results });
}));

// ─────────────────────────── HTTP: files ───────────────────────────

app.post('/api/upload', auth, express.raw({ type: () => true, limit: MAX_UPLOAD }), wrap(async (req, res) => {
  rateLimit('upload:' + req.uid, 60, 60000);
  const chatId = toInt(req.get('x-chat-id'));
  await requireMember(chatId, req.uid);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Empty file');
  const name = clampStr(decodeURIComponent(req.get('x-file-name') || 'file'), 200).replace(/[\\/\r\n]/g, '_');
  const mime = clampStr(req.get('content-type') || 'application/octet-stream', 100).split(';')[0];
  const meta = { name, mime };
  const r = await db.q('INSERT INTO attachments (chat_id, uploader_id, meta_enc, size, data) VALUES (?,?,?,?,?)', [chatId, req.uid, C.enc(meta), req.body.length, C.encBuf(req.body)]);
  res.json({ id: Number(r.insertId), name, mime, size: req.body.length });
}));

// Small LRU of decrypted files so video seeking (Range requests) stays fast.
const fileCache = new Map();
let fileCacheBytes = 0;
const FILE_CACHE_MAX = 256 * 1024 * 1024;
function cachePut(id, entry) {
  fileCache.set(id, entry);
  fileCacheBytes += entry.data.length;
  for (const [k, v] of fileCache) {
    if (fileCacheBytes <= FILE_CACHE_MAX) break;
    fileCache.delete(k);
    fileCacheBytes -= v.data.length;
  }
}

app.get('/api/files/:id', auth, wrap(async (req, res) => {
  const id = toInt(req.params.id);
  let entry = fileCache.get(id);
  if (entry) { fileCache.delete(id); fileCache.set(id, entry); }
  else {
    const a = await db.one('SELECT chat_id, meta_enc, data FROM attachments WHERE id=?', [id]);
    if (!a) throw notFound();
    entry = { chatId: Number(a.chat_id), meta: C.decJson(a.meta_enc, {}), data: C.decBuf(a.data) };
    cachePut(id, entry);
  }
  // Must be a member of the chat it was uploaded to, or of any chat it was forwarded into.
  if (!(await membership(entry.chatId, req.uid))) {
    const fwd = await db.one(
      'SELECT 1 x FROM messages m JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=? AND cm.active=1 WHERE m.attachment_id=? AND m.deleted=0 LIMIT 1',
      [req.uid, id]
    );
    if (!fwd) throw forbidden();
  }
  const { data, meta } = entry;
  const safeMime = /^(image\/(png|jpeg|gif|webp|heic|heif|avif)|video\/|audio\/)/.test(meta.mime) && meta.mime !== 'image/svg+xml' ? meta.mime : 'application/octet-stream';
  res.setHeader('Content-Type', safeMime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  const disp = req.query.dl ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(meta.name || 'file')}`);

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] === '' ? data.length - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? data.length - 1 : Number(range[2]);
    start = Math.max(0, start); end = Math.min(end, data.length - 1);
    if (start > end) { res.status(416).setHeader('Content-Range', `bytes */${data.length}`); return res.end(); }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
    res.setHeader('Content-Length', end - start + 1);
    return res.end(data.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', data.length);
  res.end(data);
}));

app.post('/api/push/subscribe', auth, wrap(async (req, res) => {
  await push.subscribe(req.uid, req.body.subscription);
  res.json({ ok: true });
}));

// "Send test notification" in Settings — confirms notifications reach this phone.
app.post('/api/push/test', auth, wrap(async (req, res) => {
  rateLimit('ptest:' + req.uid, 5, 60000);
  const n = (await db.one('SELECT COUNT(*) n FROM push_subs WHERE user_id=?', [req.uid])).n;
  if (!Number(n)) throw bad('Notifications aren’t turned on for this device yet');
  await push.send(req.uid, { type: 'msg', title: 'Ping Me', body: 'Notifications are working 🎉', tag: 'test', url: '/' }, { urgency: 'high' });
  res.json({ ok: true, devices: Number(n) });
}));

app.post('/api/push/unsubscribe', auth, wrap(async (req, res) => {
  if (req.body.endpoint) await push.unsubscribe(req.body.endpoint);
  res.json({ ok: true });
}));

const advanced = require('./features')({
  app, io, db, C, push, auth, wrap, bad, forbidden, notFound, HttpError, toInt, clampStr, now, ms,
  requireMember, getUser, publicUser, insertMessage, loadMessage, emitToUser, joinUserToChat, rateLimit,
  createSession, findUserIdByUsername, meView, inviteHash, INVITES_PER_USER, userCache,
  createUser, usernameProblem, unameHash, unameCanon, U, sessionUser, parseCookies, COOKIE, parseBirth, emitUpdate, streaksFor,
  serializeMessagesFor: serializeMessages,
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ─────────────────────────── static app ───────────────────────────

const pub = path.join(__dirname, '..', 'public');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(self)');
  next();
});
app.use(express.static(pub, {
  setHeaders(res, file) {
    if (/(\.html|sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

// ─────────────────────────── realtime ───────────────────────────

async function markChatRead(chatId, uid, upTo) {
  await db.q('UPDATE chat_members SET last_read_id=GREATEST(last_read_id,?), last_delivered_id=GREATEST(last_delivered_id,?) WHERE chat_id=? AND user_id=?', [upTo, upTo, chatId, uid]);
  const u = await getUser(uid);
  const full = { chatId, userId: uid, lastRead: upTo, lastDelivered: upTo };
  // My own devices always get the real value (clears badges); others respect "read receipts off".
  const others = u?.settings.readReceipts ? full : { chatId, userId: uid, lastDelivered: upTo };
  const mine = new Set([...(online.get(uid) || [])].map((s) => s.id));
  emitToUser(uid, 'receipt', full);
  io.to('c:' + chatId).except([...mine]).emit('receipt', others);
  await startReadTimers(chatId, upTo);
}

async function startReadTimers(chatId, upTo) {
  const pending = await db.q('SELECT id, sender_id, read_ttl FROM messages WHERE chat_id=? AND read_ttl IS NOT NULL AND expires_at IS NULL AND deleted=0 AND id<=?', [chatId, upTo]);
  if (!pending.length) return;
  const members = await db.q('SELECT user_id, last_read_id FROM chat_members WHERE chat_id=? AND active=1', [chatId]);
  for (const m of pending) {
    const readers = members.filter((x) => Number(x.user_id) !== Number(m.sender_id));
    if (!readers.length || readers.some((x) => Number(x.last_read_id) < Number(m.id))) continue;
    const expiresAt = new Date(Date.now() + Number(m.read_ttl) * 1000);
    await db.q('UPDATE messages SET expires_at=? WHERE id=?', [expiresAt, m.id]);
    io.to('c:' + chatId).emit('msg:expiry', { chatId, id: Number(m.id), expiresAt: expiresAt.getTime() });
  }
}

io.use(async (socket, next) => {
  try {
    const uid = await sessionUser(parseCookies(socket.handshake.headers.cookie)[COOKIE]);
    if (!uid) return next(new Error('unauthorized'));
    socket.uid = uid;
    next();
  } catch (e) { next(e); }
});

async function broadcastPresence(uid, isOnline) {
  const u = await getUser(uid);
  if (!u) return;
  const lastSeen = Date.now();
  u.lastSeen = lastSeen;
  db.q('UPDATE users SET last_seen=? WHERE id=?', [new Date(lastSeen), uid]).catch(() => {});
  if (!u.settings.lastSeen) return;
  const chats = await db.q('SELECT chat_id FROM chat_members WHERE user_id=? AND active=1', [uid]);
  const payload = { userId: uid, online: isOnline, lastSeen };
  for (const c of chats) io.to('c:' + c.chat_id).emit('presence', payload);
}

const sockHandler = (socket, fn) => async (data, ack) => {
  try {
    const out = await fn(data || {});
    if (typeof ack === 'function') ack({ ok: true, ...(out || {}) });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (typeof ack === 'function') ack({ ok: false, error: e instanceof HttpError ? e.message : 'Something went wrong' });
  }
};

io.on('connection', (socket) => {
  const uid = socket.uid;
  socket.join('u:' + uid);
  socket.emit('hello', { instance: INSTANCE_ID });
  const first = !online.has(uid);
  if (first) online.set(uid, new Set());
  online.get(uid).add(socket);

  // Handlers below are registered synchronously so nothing sent right after connecting is lost;
  // the slower setup (rooms, delivery receipts, ringing calls) runs alongside.
  (async () => {
    const chats = await db.q('SELECT chat_id FROM chat_members WHERE user_id=? AND active=1', [uid]);
    for (const c of chats) socket.join('c:' + c.chat_id);
    if (first) broadcastPresence(uid, true);

    // Everything waiting for this user is now delivered.
    const pending = await db.q(
      `SELECT cm.chat_id, MAX(m.id) mid FROM chat_members cm JOIN messages m ON m.chat_id=cm.chat_id
        WHERE cm.user_id=? AND cm.active=1 AND m.id>cm.last_delivered_id GROUP BY cm.chat_id`,
      [uid]
    );
    for (const p of pending) {
      await db.q('UPDATE chat_members SET last_delivered_id=GREATEST(last_delivered_id,?) WHERE chat_id=? AND user_id=?', [p.mid, p.chat_id, uid]);
      io.to('c:' + p.chat_id).emit('receipt', { chatId: Number(p.chat_id), userId: uid, lastDelivered: Number(p.mid) });
    }

    // Re-ring any call still waiting for this user (e.g. app opened from a push).
    for (const call of calls.values()) {
      if (call.ringing.has(uid)) socket.emit('call:incoming', callInvite(call));
    }
  })().catch((e) => console.error('connect setup failed', e.message));

  socket.on('msg:send', sockHandler(socket, async (d) => {
    const chatId = toInt(d.chatId);
    await requireMember(chatId, uid);
    if (d.kind === 'ping') rateLimit(`ping:${uid}:${chatId}`, 3, 30000);
    const chat = await db.one('SELECT type FROM chats WHERE id=?', [chatId]);
    if (chat.type === 'direct') {
      const others = (await activeMemberIds(chatId)).filter((x) => x !== uid);
      const otherAll = await db.one('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?', [chatId, uid]);
      const other = others[0] || (otherAll && Number(otherAll.user_id));
      if (other && (await isBlockedBetween(uid, other))) throw forbidden('You can’t message this person');
      // Re-activate the other side if they had deleted the conversation.
      if (other) {
        await db.q('UPDATE chat_members SET active=1 WHERE chat_id=? AND user_id=?', [chatId, other]);
        if (!others.length) { joinUserToChat(other, chatId); emitToUser(other, 'chat:changed', { chatId }); }
      }
    }
    const { kind, body, attachmentId, vanish } = await buildBody(chatId, uid, d);
    const effect = VALID_EFFECTS.has(d.effect) ? d.effect : null;
    const replyTo = toInt(d.replyTo);
    if (d.sendAt) {
      const sendAt = new Date(Number(d.sendAt));
      if (!(sendAt.getTime() > Date.now() + 5000)) throw bad('Pick a time in the future');
      if (sendAt.getTime() > Date.now() + 365 * 86400000) throw bad('That is too far ahead');
      await db.q('INSERT INTO scheduled_messages (chat_id, sender_id, payload_enc, send_at) VALUES (?,?,?,?)', [
        chatId, uid, C.enc({ kind, body, attachmentId, replyTo, effect, silent: !!d.silent, vanish }), sendAt,
      ]);
      return { scheduled: true };
    }
    const msg = await insertMessage({ chatId, senderId: uid, kind, body, attachmentId, replyTo, effect, forwarded: !!d.forwarded, silent: !!d.silent, vanish, clientId: clampStr(d.clientId || '', 64) || null });
    return { message: msg };
  }));

  socket.on('msg:edit', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one('SELECT * FROM messages WHERE id=?', [id]);
    if (!row || Number(row.sender_id) !== uid || row.deleted) throw forbidden('You can only edit your own messages');
    if (!['text', 'image', 'video', 'file'].includes(row.kind)) throw bad('This message can’t be edited');
    const text = clampStr(d.text || '', 10000).trim();
    if (!text && row.kind === 'text') throw bad('Message is empty');
    const body = C.decJson(row.body_enc, {});
    if ((body.text || '') === text) return {};
    body.hist = [...(body.hist || []), { text: body.text || '', at: Date.now() }].slice(-20);
    body.text = text;
    await db.q('UPDATE messages SET body_enc=?, edited_at=? WHERE id=?', [C.enc(body), now(), id]);
    io.to('c:' + row.chat_id).emit('msg:update', await loadMessage(id, uid));
  }));

  socket.on('msg:unsend', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one('SELECT * FROM messages WHERE id=?', [id]);
    if (!row || Number(row.sender_id) !== uid) throw forbidden('You can only unsend your own messages');
    await db.q('UPDATE messages SET deleted=1, pinned=0, body_enc=?, attachment_id=NULL WHERE id=?', [C.enc({}), id]);
    await db.q('DELETE FROM reactions WHERE message_id=?', [id]);
    await db.q('DELETE FROM poll_votes WHERE message_id=?', [id]);
    await deleteAttachmentIfUnused(row.attachment_id && Number(row.attachment_id));
    io.to('c:' + row.chat_id).emit('msg:update', await loadMessage(id, uid));
  }));

  socket.on('msg:hide', sockHandler(socket, async (d) => {
    const ids = (Array.isArray(d.ids) ? d.ids : [d.id]).map(toInt).filter(Boolean).slice(0, 500);
    for (const id of ids) {
      const row = await db.one('SELECT chat_id FROM messages WHERE id=?', [id]);
      if (!row || !(await membership(Number(row.chat_id), uid))) continue;
      await db.q('INSERT IGNORE INTO message_hidden (message_id, user_id) VALUES (?,?)', [id, uid]);
      emitToUser(uid, 'msg:remove', { chatId: Number(row.chat_id), id });
    }
  }));

  socket.on('msg:react', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one('SELECT chat_id, deleted FROM messages WHERE id=?', [id]);
    if (!row || row.deleted) throw notFound();
    await requireMember(Number(row.chat_id), uid);
    const emoji = typeof d.emoji === 'string' ? [...d.emoji].slice(0, REACTION_MAX).join('') : null;
    if (emoji) {
      await db.q('INSERT INTO reactions (message_id, user_id, emoji_enc) VALUES (?,?,?) ON DUPLICATE KEY UPDATE emoji_enc=VALUES(emoji_enc), created_at=CURRENT_TIMESTAMP(3)', [id, uid, C.enc(emoji)]);
    } else {
      await db.q('DELETE FROM reactions WHERE message_id=? AND user_id=?', [id, uid]);
    }
    const reactions = (await db.q('SELECT user_id, emoji_enc FROM reactions WHERE message_id=?', [id])).map((r) => ({ userId: Number(r.user_id), emoji: C.dec(r.emoji_enc) }));
    io.to('c:' + row.chat_id).emit('msg:reactions', { chatId: Number(row.chat_id), id, reactions, by: uid, emoji });
  }));

  socket.on('msg:pin', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one('SELECT chat_id, deleted FROM messages WHERE id=?', [id]);
    if (!row || row.deleted) throw notFound();
    await requireMember(Number(row.chat_id), uid);
    await db.q('UPDATE messages SET pinned=? WHERE id=?', [d.pinned ? 1 : 0, id]);
    await emitUpdate(Number(row.chat_id), id, uid);
  }));

  socket.on('letter:open', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one("SELECT chat_id, sender_id, body_enc FROM messages WHERE id=? AND kind='letter' AND deleted=0", [id]);
    if (!row) throw notFound('Letter not found');
    await requireMember(Number(row.chat_id), uid);
    if (Number(row.sender_id) === uid) return { message: await loadMessage(id, uid) };
    const body = C.decJson(row.body_enc, {});
    if (body.letter.unlockAt && body.letter.unlockAt > Date.now()) throw bad('This letter can’t be opened yet');
    if (!body.letter.openedAt) {
      body.letter.openedAt = Date.now();
      await db.q('UPDATE messages SET body_enc=? WHERE id=?', [C.enc(body), id]);
    }
    await emitUpdate(Number(row.chat_id), id, uid);
    return { message: await loadMessage(id, uid) };
  }));

  socket.on('poll:vote', sockHandler(socket, async (d) => {
    const id = toInt(d.id);
    const row = await db.one("SELECT chat_id, body_enc FROM messages WHERE id=? AND kind='poll' AND deleted=0", [id]);
    if (!row) throw notFound();
    await requireMember(Number(row.chat_id), uid);
    const poll = C.decJson(row.body_enc, {}).poll;
    let opts = (Array.isArray(d.options) ? d.options : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < poll.opts.length);
    if (!poll.multi) opts = opts.slice(0, 1);
    await db.q('DELETE FROM poll_votes WHERE message_id=? AND user_id=?', [id, uid]);
    if (opts.length) await db.q('INSERT INTO poll_votes (message_id, user_id, option_idx) VALUES ?', [opts.map((o) => [id, uid, o])]);
    io.to('c:' + row.chat_id).emit('msg:update', await loadMessage(id, uid));
  }));

  socket.on('chat:read', sockHandler(socket, async (d) => {
    const chatId = toInt(d.chatId);
    const upTo = toInt(d.messageId);
    if (!chatId || !upTo) return;
    await requireMember(chatId, uid);
    await markChatRead(chatId, uid, upTo);
  }));

  socket.on('typing', async (d) => {
    const chatId = toInt(d?.chatId);
    if (!chatId || !socket.rooms.has('c:' + chatId)) return;
    const u = await getUser(uid);
    if (!u?.settings.typing) return;
    socket.to('c:' + chatId).emit('typing', { chatId, userId: uid, on: !!d.on });
  });

  // ─── calls ───
  socket.on('call:start', sockHandler(socket, (d) => startCall(socket, d)));
  socket.on('call:join', sockHandler(socket, (d) => joinCall(socket, d)));
  socket.on('call:decline', sockHandler(socket, (d) => declineCall(socket.uid, d)));
  socket.on('call:leave', sockHandler(socket, (d) => leaveCall(socket, toInt(d.callId))));
  socket.on('call:ring-more', sockHandler(socket, (d) => ringMore(socket, d)));
  socket.on('call:signal', (d) => {
    const call = calls.get(toInt(d?.callId));
    if (!call || !call.participants.has(socket.id) || !call.participants.has(d.to)) return;
    io.to(d.to).emit('call:signal', { callId: call.id, from: socket.id, userId: uid, data: d.data });
  });
  socket.on('call:media', (d) => {
    const call = calls.get(toInt(d?.callId));
    if (!call || !call.participants.has(socket.id)) return;
    const state = { audio: !!d.audio, video: !!d.video, screen: !!d.screen };
    call.participants.get(socket.id).media = state;
    for (const sid of call.participants.keys()) if (sid !== socket.id) io.to(sid).emit('call:media', { callId: call.id, socketId: socket.id, userId: uid, ...state });
  });

  socket.on('disconnect', () => {
    for (const call of [...calls.values()]) if (call.participants.has(socket.id)) leaveCall(socket, call.id).catch(() => {});
    const set = online.get(uid);
    if (set) {
      set.delete(socket);
      if (!set.size) { online.delete(uid); broadcastPresence(uid, false); }
    }
  });
});

// ─────────────────────────── calls ───────────────────────────
// Signaling for WebRTC mesh calls (1:1 and small groups). Media flows peer-to-peer.

const calls = new Map();
let nextCallId = 1;
const RING_TIMEOUT = 45000;
const MAX_CALL_PARTICIPANTS = 8;

function callInvite(call) {
  return { callId: call.id, chatId: call.chatId, from: call.startedBy, video: call.video, group: call.group, reason: call.reason || null };
}

function userInCall(userId) {
  for (const c of calls.values()) {
    for (const [sid, p] of c.participants) {
      if (p.userId === userId && io.sockets.sockets.get(sid)?.connected) return c;
    }
  }
  return null;
}

async function ringUsers(call, userIds) {
  const caller = await publicUser(call.startedBy);
  const chat = await db.one('SELECT type, title_enc FROM chats WHERE id=?', [call.chatId]);
  for (const u of userIds) {
    if (call.ringing.has(u) || userInCall(u)) continue;
    if (await isBlockedBetween(call.startedBy, u)) continue;
    call.ringing.add(u);
    emitToUser(u, 'call:incoming', callInvite(call));
    const title0 = chat.type === 'group' ? `${caller.name} · ${C.dec(chat.title_enc) || 'Group'}` : caller.name;
    let rings = 0;
    const t = setInterval(() => {
      if (!calls.has(call.id) || !call.ringing.has(u) || ++rings > 8) return clearInterval(t);
      push.send(u, { type: 'call', title: title0, body: `Incoming ${call.video ? 'video' : 'audio'} call` + (call.reason ? ` — “${call.reason}”` : ''), tag: 'call-' + call.id, url: `/?call=${call.id}&chat=${call.chatId}`, callId: call.id, chatId: call.chatId, video: call.video, ts: Date.now(), ring: rings }, { urgency: 'high', ttl: 10 }).catch(() => {});
    }, 5000);
    (call.ringTimers ||= []).push(t);
    const title = chat.type === 'group' ? `${caller.name} · ${C.dec(chat.title_enc) || 'Group'}` : caller.name;
    push.send(u, { type: 'call', title, body: `Incoming ${call.video ? 'video' : 'audio'} call` + (call.reason ? ` — “${call.reason}”` : ''), tag: 'call-' + call.id, url: `/?call=${call.id}&chat=${call.chatId}`, callId: call.id, chatId: call.chatId, video: call.video, ts: Date.now() }, { urgency: 'high', ttl: 45 }).catch(() => {});
  }
}

async function startCall(socket, d) {
  const chatId = toInt(d.chatId);
  await requireMember(chatId, socket.uid);
  for (const c of calls.values()) {
    if (c.chatId === chatId) return { existing: c.id, video: c.video };
  }
  if (userInCall(socket.uid)) throw bad('You are already in a call');
  const chat = await db.one('SELECT type FROM chats WHERE id=?', [chatId]);
  const members = (await activeMemberIds(chatId)).filter((u) => u !== socket.uid);
  if (!members.length) throw bad('No one else is in this conversation');
  if (chat.type === 'direct' && (await isBlockedBetween(socket.uid, members[0]))) throw forbidden('You can’t call this person');
  // "Reason to call": if they've never replied to you, they see your reason before picking up.
  const reason = clampStr(d.reason || '', 140).trim();
  if (chat.type === 'direct' && !reason) {
    const callee = await getUser(members[0]);
    const known = await db.one("SELECT 1 x FROM messages WHERE chat_id=? AND sender_id=? AND kind<>'system' LIMIT 1", [chatId, members[0]]);
    if (!known && callee?.settings.features.reasonToCall) return { needReason: true };
  }
  const call = {
    reason: reason || null,
    id: nextCallId++,
    chatId,
    video: !!d.video,
    group: chat.type === 'group',
    startedBy: socket.uid,
    startedAt: Date.now(),
    answeredAt: null,
    participants: new Map([[socket.id, { userId: socket.uid, media: { audio: true, video: !!d.video } }]]),
    ringing: new Set(),
    everJoined: new Set([socket.uid]),
    timer: null,
  };
  calls.set(call.id, call);
  if (chat.type === 'direct' && userInCall(members[0])) {
    calls.delete(call.id);
    throw bad('Busy — they’re on another call');
  }
  await ringUsers(call, members);
  call.timer = setTimeout(() => {
    if (!call.answeredAt) endCall(call, 'no-answer');
    else stopRinging(call, [...call.ringing]);
  }, RING_TIMEOUT);
  return { callId: call.id };
}

function stopRinging(call, userIds) {
  for (const u of userIds) {
    call.ringing.delete(u);
    emitToUser(u, 'call:stop-ring', { callId: call.id });
  }
}

async function ringMore(socket, d) {
  const call = calls.get(toInt(d.callId));
  if (!call || !call.participants.has(socket.id)) throw notFound('Call ended');
  const ids = (d.userIds || []).map(toInt).filter(Boolean);
  const members = await activeMemberIds(call.chatId);
  await ringUsers(call, ids.filter((u) => members.includes(u)));
}

async function joinCall(socket, d) {
  const call = calls.get(toInt(d.callId));
  if (!call) throw notFound('This call has ended');
  await requireMember(call.chatId, socket.uid);
  if (call.participants.size >= MAX_CALL_PARTICIPANTS) throw bad('This call is full');
  const peers = [...call.participants.entries()].map(([sid, p]) => ({ socketId: sid, userId: p.userId, media: p.media }));
  call.participants.set(socket.id, { userId: socket.uid, media: { audio: true, video: !!d.video } });
  call.everJoined.add(socket.uid);
  call.ringing.delete(socket.uid);
  // Stop ringing on my other devices.
  for (const s of online.get(socket.uid) || []) if (s.id !== socket.id) s.emit('call:stop-ring', { callId: call.id });
  if (!call.answeredAt && socket.uid !== call.startedBy) call.answeredAt = Date.now();
  for (const sid of call.participants.keys()) {
    if (sid !== socket.id) io.to(sid).emit('call:peer-joined', { callId: call.id, socketId: socket.id, userId: socket.uid, answeredAt: call.answeredAt });
  }
  return { callId: call.id, chatId: call.chatId, video: call.video, peers, answeredAt: call.answeredAt, startedBy: call.startedBy };
}

async function declineCall(uid, d) {
  const call = calls.get(toInt(d.callId));
  if (!call || !call.ringing.has(uid)) return;
  stopRinging(call, [uid]);
  for (const sid of call.participants.keys()) io.to(sid).emit('call:declined', { callId: call.id, userId: uid, busy: !!d.busy });
  if (!call.group && !call.answeredAt) endCall(call, d.busy ? 'busy' : 'declined');
  else if (!call.answeredAt && !call.ringing.size) endCall(call, 'declined');
}

async function leaveCall(socket, callId) {
  const call = calls.get(callId);
  if (!call || !call.participants.has(socket.id)) return;
  call.participants.delete(socket.id);
  for (const sid of call.participants.keys()) io.to(sid).emit('call:peer-left', { callId, socketId: socket.id, userId: socket.uid });
  const remaining = call.participants.size;
  if (remaining === 0 || (remaining === 1 && (call.answeredAt || !call.ringing.size)) || (!call.answeredAt && socket.uid === call.startedBy)) {
    endCall(call, call.answeredAt ? 'ended' : 'cancelled');
  }
}

async function endCall(call, reason) {
  if (!calls.has(call.id)) return;
  calls.delete(call.id);
  clearTimeout(call.timer);
  (call.ringTimers || []).forEach(clearInterval);
  for (const sid of call.participants.keys()) io.to(sid).emit('call:ended', { callId: call.id, reason });
  for (const u of call.ringing) {
    emitToUser(u, 'call:ended', { callId: call.id, reason });
    // Replace the ringing notification on devices where the app is closed.
    push.send(u, { type: 'call-ended', tag: 'call-' + call.id, callId: call.id, chatId: call.chatId, video: call.video, title: (await publicUser(call.startedBy)).name, body: call.answeredAt ? 'Call ended' : `Missed ${call.video ? 'video' : 'audio'} call`, url: '/?chat=' + call.chatId }, { ttl: 3600 }).catch(() => {});
  }
  const dur = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0;
  try {
    await insertMessage({
      chatId: call.chatId,
      senderId: call.startedBy,
      kind: 'call',
      body: { call: { video: call.video, dur, missed: !call.answeredAt, reason, joined: [...call.everJoined] } },
    });
  } catch (e) { console.error('call log failed', e.message); }
}

// ─────────────────────────── workers ───────────────────────────

async function runScheduled() {
  const due = await db.q('SELECT * FROM scheduled_messages WHERE send_at<=? ORDER BY send_at LIMIT 50', [now()]);
  for (const s of due) {
    await db.q('DELETE FROM scheduled_messages WHERE id=?', [s.id]);
    const p = C.decJson(s.payload_enc, null);
    const chatId = Number(s.chat_id), senderId = Number(s.sender_id);
    if (!p || !(await membership(chatId, senderId))) continue;
    try {
      await insertMessage({ chatId, senderId, kind: p.kind, body: p.body, attachmentId: p.attachmentId, replyTo: p.replyTo, effect: p.effect, silent: p.silent, vanish: p.vanish });
      emitToUser(senderId, 'scheduled:sent', { chatId, id: Number(s.id) });
    } catch (e) { console.error('scheduled send failed', e.message); }
  }
}

async function runExpiry() {
  const rows = await db.q('SELECT id, chat_id, attachment_id FROM messages WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT 500', [now()]);
  if (!rows.length) return;
  const ids = rows.map((r) => Number(r.id));
  await db.q('DELETE FROM messages WHERE id IN (?)', [ids]);
  for (const t of ['reactions', 'poll_votes', 'message_hidden']) await db.q(`DELETE FROM ${t} WHERE message_id IN (?)`, [ids]);
  for (const r of rows) {
    await deleteAttachmentIfUnused(r.attachment_id && Number(r.attachment_id));
    io.to('c:' + r.chat_id).emit('msg:remove', { chatId: Number(r.chat_id), id: Number(r.id) });
  }
}

async function runCleanup() {
  // Drop uploads that were never attached to a message (e.g. abandoned sends).
  const stale = await db.q(
    `SELECT a.id FROM attachments a WHERE a.created_at < ? AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.attachment_id=a.id)
       AND NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE s.chat_id=a.chat_id) LIMIT 200`,
    [new Date(Date.now() - 24 * 3600 * 1000)]
  );
  if (stale.length) await db.q('DELETE FROM attachments WHERE id IN (?)', [stale.map((s) => s.id)]);
  await db.q('DELETE FROM sessions WHERE last_used < ?', [new Date(Date.now() - 400 * 86400000)]);
}

function loop(fn, every) {
  const tick = async () => { try { await fn(); } catch (e) { console.error(fn.name, e.message); } setTimeout(tick, every).unref(); };
  setTimeout(tick, 3000).unref();
}

// ─────────────────────────── boot ───────────────────────────

async function backfillCanon() {
  const rows = await db.q('SELECT id, uname_enc FROM users WHERE uname_canon IS NULL LIMIT 5000');
  for (const r of rows) {
    const u = C.dec(r.uname_enc);
    if (u) await db.q('UPDATE users SET uname_canon=? WHERE id=?', [unameCanon(u), r.id]).catch(() => {});
  }
}

db.init().then(async () => {
  await backfillCanon();
  loop(runScheduled, 10000);
  advanced.start(loop);
  loop(runExpiry, 15000);
  loop(runCleanup, 3600000);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use — Ping Me is probably already running in another terminal.`);
      console.error(`Stop it there (Ctrl+C), or free the port with:  lsof -ti tcp:${PORT} | xargs kill`);
      console.error(`Or run on another port:  PORT=3000 npm start\n`);
      process.exit(1);
    }
    throw e;
  });
  server.listen(PORT, () => console.log(`Ping Me running on http://localhost:${PORT}`));
  // On redeploy Cloud Run stops the old copy: disconnect everyone cleanly so phones reconnect to the new one.
  process.on('SIGTERM', () => { io.disconnectSockets(true); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
}).catch((e) => {
  console.error('Database connection failed:', e.message);
  process.exit(1);
});
