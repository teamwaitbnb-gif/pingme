// Ping Me advanced features (server side): promise reminders, safety check-ins, SOS,
// device keys (verified calls + "Verified Real" photos), Golden Keys invites,
// friend-based account recovery, and chat stats (Wrapped + Group Pet).
const crypto = require('crypto');

module.exports = function features(x) {
  const {
    app, io, db, C, push, auth, wrap, bad, notFound, HttpError, toInt, clampStr, now, ms,
    requireMember, getUser, publicUser, insertMessage, loadMessage, emitToUser, joinUserToChat, rateLimit,
    createSession, findUserIdByUsername, meView, inviteHash, INVITES_PER_USER, userCache,
    createUser, usernameProblem, unameHash, unameCanon, U, sessionUser, parseCookies, COOKIE, parseBirth, streaksFor,
  } = x;

  const sharesChat = (a, b) => db.one(
    'SELECT 1 x FROM chat_members m1 JOIN chat_members m2 ON m1.chat_id=m2.chat_id WHERE m1.user_id=? AND m2.user_id=? LIMIT 1', [a, b]
  );

  async function ensureDirectChat(a, b) {
    const key = C.sha256(`direct:${Math.min(a, b)}:${Math.max(a, b)}`);
    let chat = await db.one('SELECT id FROM chats WHERE direct_key=?', [key]);
    if (!chat) {
      const r = await db.q('INSERT INTO chats (type, direct_key, created_by) VALUES (?,?,?)', ['direct', key, a]);
      chat = { id: r.insertId };
      await db.q('INSERT INTO chat_members (chat_id, user_id, role) VALUES (?,?,?), (?,?,?)', [chat.id, a, 'admin', chat.id, b, 'admin']);
    } else {
      await db.q('UPDATE chat_members SET active=1 WHERE chat_id=? AND user_id IN (?)', [chat.id, [a, b]]);
    }
    const chatId = Number(chat.id);
    for (const u of [a, b]) { joinUserToChat(u, chatId); emitToUser(u, 'chat:changed', { chatId }); }
    return chatId;
  }

  // ───────────────────── promise reminders ─────────────────────

  app.post('/api/reminders', auth, wrap(async (req, res) => {
    rateLimit('rem:' + req.uid, 30, 60000);
    const text = clampStr(req.body.text, 300).trim();
    const at = new Date(Number(req.body.remindAt));
    if (!text) throw bad('Reminder text is empty');
    if (!(at.getTime() > Date.now() + 30000) || at.getTime() > Date.now() + 366 * 86400000) throw bad('Pick a time in the future');
    const chatId = toInt(req.body.chatId);
    if (chatId) await requireMember(chatId, req.uid);
    const r = await db.q('INSERT INTO reminders (user_id, chat_id, message_id, text_enc, remind_at) VALUES (?,?,?,?,?)',
      [req.uid, chatId, toInt(req.body.messageId), C.enc(text), at]);
    res.json({ reminder: { id: Number(r.insertId), text, remindAt: at.getTime(), chatId } });
  }));

  app.get('/api/reminders', auth, wrap(async (req, res) => {
    const rows = await db.q('SELECT * FROM reminders WHERE user_id=? ORDER BY remind_at LIMIT 100', [req.uid]);
    res.json({ reminders: rows.map((r) => ({ id: Number(r.id), text: C.dec(r.text_enc), remindAt: ms(r.remind_at), chatId: r.chat_id ? Number(r.chat_id) : null, messageId: r.message_id ? Number(r.message_id) : null })) });
  }));

  app.delete('/api/reminders/:id', auth, wrap(async (req, res) => {
    await db.q('DELETE FROM reminders WHERE id=? AND user_id=?', [toInt(req.params.id), req.uid]);
    res.json({ ok: true });
  }));

  async function runReminders() {
    const due = await db.q('SELECT * FROM reminders WHERE remind_at<=? ORDER BY remind_at LIMIT 100', [now()]);
    for (const r of due) {
      await db.q('DELETE FROM reminders WHERE id=?', [r.id]);
      const text = C.dec(r.text_enc);
      const chatId = r.chat_id ? Number(r.chat_id) : null;
      emitToUser(Number(r.user_id), 'reminder', { id: Number(r.id), text, chatId, messageId: r.message_id ? Number(r.message_id) : null });
      push.send(Number(r.user_id), { type: 'msg', title: 'Reminder', body: text, tag: 'reminder-' + r.id, url: chatId ? '/?chat=' + chatId : '/', chatId }).catch(() => {});
    }
  }

  // ───────────────────── safety check-in ─────────────────────
  // "If I don't check in by HH:MM, tell this chat" — for travelling alone, late nights, first dates.

  const checkinView = (r) => ({ id: Number(r.id), chatId: Number(r.chat_id), dueAt: ms(r.due_at), note: C.decJson(r.payload_enc, {}).note || '' });

  app.post('/api/checkins', auth, wrap(async (req, res) => {
    rateLimit('chk:' + req.uid, 20, 60000);
    const chatId = toInt(req.body.chatId);
    await requireMember(chatId, req.uid);
    const minutes = Math.round(Number(req.body.minutes));
    if (!(minutes >= 5 && minutes <= 1440)) throw bad('Choose between 5 minutes and 24 hours');
    const loc = req.body.loc && Number.isFinite(Number(req.body.loc.lat)) && Number.isFinite(Number(req.body.loc.lng))
      ? { lat: Number(req.body.loc.lat), lng: Number(req.body.loc.lng), acc: Number(req.body.loc.acc) || undefined } : null;
    await db.q('DELETE FROM checkins WHERE user_id=?', [req.uid]); // one active check-in at a time
    const due = new Date(Date.now() + minutes * 60000);
    const r = await db.q('INSERT INTO checkins (user_id, chat_id, payload_enc, due_at) VALUES (?,?,?,?)',
      [req.uid, chatId, C.enc({ note: clampStr(req.body.note, 300).trim(), loc }), due]);
    res.json({ checkin: { id: Number(r.insertId), chatId, dueAt: due.getTime(), note: clampStr(req.body.note, 300).trim() } });
  }));

  app.get('/api/checkins', auth, wrap(async (req, res) => {
    const r = await db.one('SELECT * FROM checkins WHERE user_id=?', [req.uid]);
    res.json({ checkin: r ? checkinView(r) : null });
  }));

  app.post('/api/checkins/:id/safe', auth, wrap(async (req, res) => {
    await db.q('DELETE FROM checkins WHERE id=? AND user_id=?', [toInt(req.params.id), req.uid]);
    res.json({ ok: true });
  }));

  app.post('/api/checkins/:id/extend', auth, wrap(async (req, res) => {
    const minutes = Math.round(Number(req.body.minutes));
    if (!(minutes >= 5 && minutes <= 1440)) throw bad('Choose between 5 minutes and 24 hours');
    const r = await db.one('SELECT * FROM checkins WHERE id=? AND user_id=?', [toInt(req.params.id), req.uid]);
    if (!r) throw notFound('Check-in already ended');
    const due = new Date(Math.max(Date.now(), ms(r.due_at)) + minutes * 60000);
    await db.q('UPDATE checkins SET due_at=? WHERE id=?', [due, r.id]);
    res.json({ checkin: { ...checkinView(r), dueAt: due.getTime() } });
  }));

  async function runCheckins() {
    const due = await db.q('SELECT * FROM checkins WHERE due_at<=? LIMIT 50', [now()]);
    for (const r of due) {
      await db.q('DELETE FROM checkins WHERE id=?', [r.id]);
      const uid = Number(r.user_id), chatId = Number(r.chat_id);
      const p = C.decJson(r.payload_enc, {}) || {};
      try {
        await requireMember(chatId, uid);
        const set = new Date(ms(r.created_at)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
        await insertMessage({
          chatId, senderId: uid, kind: 'text',
          body: { text: `Safety check-in missed. I set a timer at ${set} and didn’t mark myself safe in time. Please check on me.${p.note ? `\nNote: ${p.note}` : ''}`, intent: 'urgent' },
        });
        if (p.loc) await insertMessage({ chatId, senderId: uid, kind: 'location', body: { loc: { ...p.loc, label: 'Location when check-in was set' }, intent: 'urgent' } });
        emitToUser(uid, 'checkin:fired', { id: Number(r.id), chatId });
      } catch (e) { console.error('check-in send failed', e.message); }
    }
  }

  // ───────────────────── silent SOS ─────────────────────
  // Sends trusted contacts an SOS + live location that keeps updating; the client then places
  // a normal-looking audio call to the first contact.

  const sos = new Map(); // uid -> { msgs: [{chatId, id}], startedAt }

  app.post('/api/sos/start', auth, wrap(async (req, res) => {
    rateLimit('sos:' + req.uid, 10, 60000);
    const me = await getUser(req.uid);
    const trusted = me.settings.trusted || [];
    if (!trusted.length) throw bad('Add trusted contacts first (Settings → Safety)');
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    const loc = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, acc: Number(req.body.acc) || undefined, label: 'Live location · SOS' } : null;
    const msgs = [];
    for (const fid of trusted) {
      if (!(await getUser(fid))) continue;
      const blocked = await db.one('SELECT 1 x FROM blocks WHERE user_id=? AND blocked_id=?', [fid, req.uid]);
      if (blocked) continue;
      const chatId = await ensureDirectChat(req.uid, fid);
      const m = loc
        ? await insertMessage({ chatId, senderId: req.uid, kind: 'location', body: { loc, sos: true, text: 'SOS — I need help. This is my live location.', intent: 'urgent' } })
        : await insertMessage({ chatId, senderId: req.uid, kind: 'text', body: { text: 'SOS — I need help. I couldn’t share my location.', sos: true, intent: 'urgent' } });
      msgs.push({ chatId, id: m.id, userId: fid });
    }
    if (!msgs.length) throw bad('None of your trusted contacts can be reached');
    sos.set(req.uid, { msgs, startedAt: Date.now() });
    res.json({ chats: msgs.map((m) => m.chatId), primaryChatId: msgs[0].chatId });
  }));

  app.post('/api/sos/update', auth, wrap(async (req, res) => {
    const s = sos.get(req.uid);
    if (!s) return res.json({ active: false });
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Bad location');
    for (const m of s.msgs) {
      const row = await db.one("SELECT body_enc FROM messages WHERE id=? AND kind='location' AND deleted=0", [m.id]);
      if (!row) continue;
      const body = C.decJson(row.body_enc, {});
      body.loc = { lat, lng, acc: Number(req.body.acc) || undefined, label: `Live location · updated ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` };
      await db.q('UPDATE messages SET body_enc=?, edited_at=? WHERE id=?', [C.enc(body), now(), m.id]);
      io.to('c:' + m.chatId).emit('msg:update', await loadMessage(m.id, req.uid));
    }
    res.json({ active: true });
  }));

  app.post('/api/sos/stop', auth, wrap(async (req, res) => {
    const s = sos.get(req.uid);
    sos.delete(req.uid);
    if (s) for (const m of s.msgs) await insertMessage({ chatId: m.chatId, senderId: req.uid, kind: 'text', body: { text: 'SOS ended — I’m OK now.' } }).catch(() => {});
    res.json({ ok: true });
  }));

  app.get('/api/sos', auth, wrap(async (req, res) => res.json({ active: sos.has(req.uid) })));

  // ───────────────────── device keys ─────────────────────
  // Each device creates a P-256 key pair (private key never leaves the device). The public key is
  // registered here so others can check call verification signatures and "Verified Real" photos.

  function keyIdOf(jwk) {
    return crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('hex');
  }

  app.post('/api/devices', auth, wrap(async (req, res) => {
    rateLimit('dev:' + req.uid, 20, 60000);
    const j = req.body.jwk || {};
    if (j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string' || j.d) throw bad('Invalid device key');
    try { crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, format: 'jwk' }); } catch { throw bad('Invalid device key'); }
    const keyId = keyIdOf(j);
    const existing = await db.one('SELECT user_id FROM device_keys WHERE key_id=?', [keyId]);
    if (existing && Number(existing.user_id) !== req.uid) throw new HttpError(409, 'Key belongs to another account');
    if (!existing) {
      await db.q('INSERT INTO device_keys (key_id, user_id, jwk_enc, label_enc) VALUES (?,?,?,?)',
        [keyId, req.uid, C.enc({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y }), C.enc(clampStr(req.body.label, 80))]);
    }
    res.json({ keyId });
  }));

  app.get('/api/users/:id/devices', auth, wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (id !== req.uid && !(await sharesChat(req.uid, id))) throw notFound();
    const rows = await db.q('SELECT key_id, jwk_enc, created_at FROM device_keys WHERE user_id=? ORDER BY created_at', [id]);
    res.json({ devices: rows.map((r) => ({ keyId: r.key_id, jwk: C.decJson(r.jwk_enc), createdAt: ms(r.created_at) })) });
  }));

  app.get('/api/devices/:keyId', auth, wrap(async (req, res) => {
    const r = await db.one('SELECT key_id, user_id, jwk_enc, created_at FROM device_keys WHERE key_id=?', [clampStr(req.params.keyId, 64)]);
    if (!r) throw notFound();
    const owner = Number(r.user_id);
    if (owner !== req.uid && !(await sharesChat(req.uid, owner))) throw notFound();
    res.json({ keyId: r.key_id, userId: owner, jwk: C.decJson(r.jwk_enc), createdAt: ms(r.created_at) });
  }));

  // ───────────────────── Golden Keys (invites) ─────────────────────

  function newCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
    const pick = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
    return `PING-${pick()}-${pick()}`;
  }

  app.get('/api/invites', auth, wrap(async (req, res) => {
    let rows = await db.q('SELECT * FROM invites WHERE created_by=? ORDER BY created_at', [req.uid]);
    for (let i = rows.length; i < INVITES_PER_USER; i++) {
      const code = newCode();
      await db.q('INSERT INTO invites (code_hash, code_enc, created_by) VALUES (?,?,?)', [inviteHash(code), C.enc(code), req.uid]);
    }
    if (rows.length < INVITES_PER_USER) rows = await db.q('SELECT * FROM invites WHERE created_by=? ORDER BY created_at', [req.uid]);
    res.json({
      invites: await Promise.all(rows.map(async (r) => ({
        code: C.dec(r.code_enc),
        usedBy: r.used_by ? (await publicUser(Number(r.used_by))).name : null,
        usedAt: ms(r.used_at),
      }))),
    });
  }));

  // ───────────────────── friend recovery (3 of 5) ─────────────────────
  // Lost your password? Three of your trusted contacts approve, then — after a safety delay during
  // which your signed-in devices can cancel — you set a new password. No SMS, so no SIM-swap risk.

  const NEEDED = 3;
  const delayMs = () => Math.max(0, Number(process.env.RECOVERY_DELAY_MIN ?? 30)) * 60000;
  const DAY = 86400000;

  async function loadRequest(id) {
    const r = await db.one('SELECT * FROM recovery_requests WHERE id=?', [toInt(id)]);
    if (!r) return null;
    const data = C.decJson(r.data_enc, {}) || {};
    let status = r.status;
    if ((status === 'pending' || status === 'approved') && Date.now() - ms(r.created_at) > DAY) {
      status = 'expired';
      await db.q("UPDATE recovery_requests SET status='expired' WHERE id=?", [r.id]);
    }
    return { row: r, id: Number(r.id), userId: Number(r.user_id), status, data, approvedAt: ms(r.approved_at) };
  }

  const statusView = (q) => ({
    id: q.id, status: q.status, approvals: q.data.approvals.length, needed: NEEDED, friends: q.data.friends.length,
    readyAt: q.approvedAt ? q.approvedAt + delayMs() : null,
  });

  app.post('/api/recovery/start', wrap(async (req, res) => {
    rateLimit('rec:' + req.ip, 5, 600000);
    const uid = await findUserIdByUsername(clampStr(req.body.username, 40));
    const u = uid && (await getUser(uid));
    if (!u) throw bad('No account with that username');
    rateLimit('rec-u:' + uid, 3, 3600000);
    const friends = (u.settings.trusted || []).filter(Boolean);
    if (friends.length < NEEDED) throw bad('This account hasn’t set up friend recovery (it needs at least 3 trusted contacts)');
    await db.q("UPDATE recovery_requests SET status='cancelled' WHERE user_id=? AND status IN ('pending','approved')", [uid]);
    const secret = C.token();
    const r = await db.q('INSERT INTO recovery_requests (user_id, secret_hash, data_enc) VALUES (?,?,?)',
      [uid, C.sha256(secret), C.enc({ friends, approvals: [], denials: [] })]);
    const id = Number(r.insertId);
    const who = `${u.name} (@${u.username})`;
    for (const f of friends) {
      emitToUser(f, 'recovery:request', { id });
      push.send(f, { type: 'msg', title: 'Account recovery request', body: `${who} is trying to recover their account. Only approve if they asked you directly.`, tag: 'recovery-' + id, url: '/?recovery=' + id }).catch(() => {});
    }
    emitToUser(uid, 'recovery:alert', { id });
    push.send(uid, { type: 'msg', title: 'Ping Me security alert', body: 'Someone started recovering your account. If it wasn’t you, open Ping Me and cancel it.', tag: 'recovery-alert-' + id, url: '/?recoveryAlert=' + id }).catch(() => {});
    res.json({ id, secret, needed: NEEDED, friends: friends.length, delayMin: delayMs() / 60000 });
  }));

  app.get('/api/recovery/:id/status', wrap(async (req, res) => {
    const q = await loadRequest(req.params.id);
    if (!q || q.row.secret_hash !== C.sha256(String(req.query.secret || ''))) throw notFound();
    res.json(statusView(q));
  }));

  app.post('/api/recovery/:id/complete', wrap(async (req, res) => {
    rateLimit('reccomp:' + req.ip, 10, 600000);
    const q = await loadRequest(req.params.id);
    if (!q || q.row.secret_hash !== C.sha256(String(req.body.secret || ''))) throw notFound();
    if (q.status !== 'approved') throw bad(q.status === 'pending' ? 'Waiting for your friends to approve' : `This request is ${q.status}`);
    if (Date.now() < q.approvedAt + delayMs()) throw bad('Almost there — the safety delay hasn’t finished yet');
    const pw = String(req.body.password || '');
    if (pw.length < 8 || pw.length > 200) throw bad('Password must be at least 8 characters');
    await db.q('UPDATE users SET pass_hash=? WHERE id=?', [await C.hashPassword(pw), q.userId]);
    await db.q('DELETE FROM sessions WHERE user_id=?', [q.userId]);
    await db.q("UPDATE recovery_requests SET status='completed' WHERE id=?", [q.id]);
    userCache.delete(q.userId);
    await createSession(req, res, q.userId);
    res.json({ user: await meView(q.userId) });
  }));

  app.get('/api/recovery/pending', auth, wrap(async (req, res) => {
    const rows = await db.q("SELECT * FROM recovery_requests WHERE status IN ('pending','approved') AND created_at>? ORDER BY id DESC LIMIT 200", [new Date(Date.now() - DAY)]);
    const out = [];
    for (const r of rows) {
      const data = C.decJson(r.data_enc, {}) || {};
      const uid = Number(r.user_id);
      if (uid === req.uid) out.push({ id: Number(r.id), mine: true, status: r.status, approvals: data.approvals.length, needed: NEEDED, readyAt: r.approved_at ? ms(r.approved_at) + delayMs() : null });
      else if (data.friends?.includes(req.uid)) {
        out.push({ id: Number(r.id), user: await publicUser(uid), status: r.status, responded: data.approvals.includes(req.uid) ? 'approved' : data.denials.includes(req.uid) ? 'denied' : null, createdAt: ms(r.created_at) });
      }
    }
    res.json({ requests: out });
  }));

  app.post('/api/recovery/:id/respond', auth, wrap(async (req, res) => {
    const q = await loadRequest(req.params.id);
    if (!q || !q.data.friends.includes(req.uid)) throw notFound();
    if (q.status !== 'pending' && q.status !== 'approved') throw bad(`This request is ${q.status}`);
    const d = q.data;
    d.approvals = d.approvals.filter((u) => u !== req.uid);
    d.denials = d.denials.filter((u) => u !== req.uid);
    (req.body.approve ? d.approvals : d.denials).push(req.uid);
    let approvedAt = q.row.approved_at;
    let status = q.status;
    if (d.approvals.length >= NEEDED && status === 'pending') {
      status = 'approved'; approvedAt = now();
      const mins = delayMs() / 60000;
      emitToUser(q.userId, 'recovery:alert', { id: q.id });
      push.send(q.userId, { type: 'msg', title: 'Ping Me security alert', body: `Account recovery was approved by ${NEEDED} friends and completes in ${mins} min. Cancel now if this isn’t you.`, tag: 'recovery-alert-' + q.id, url: '/?recoveryAlert=' + q.id }).catch(() => {});
    }
    await db.q('UPDATE recovery_requests SET data_enc=?, status=?, approved_at=? WHERE id=?', [C.enc(d), status, approvedAt, q.id]);
    res.json({ ok: true, approvals: d.approvals.length, needed: NEEDED });
  }));

  app.post('/api/recovery/:id/cancel', auth, wrap(async (req, res) => {
    const q = await loadRequest(req.params.id);
    if (!q || q.userId !== req.uid) throw notFound();
    await db.q("UPDATE recovery_requests SET status='cancelled' WHERE id=?", [q.id]);
    res.json({ ok: true });
  }));

  // ───────────────────── stats: Chat Wrapped + Group Pet ─────────────────────

  const PETS = [
    { emoji: '🐱', kind: 'cat', name: 'Mochi', rarity: 'Common', w: 22 }, { emoji: '🐶', kind: 'dog', name: 'Biscuit', rarity: 'Common', w: 22 },
    { emoji: '🐰', kind: 'bunny', name: 'Puff', rarity: 'Common', w: 18 }, { emoji: '🦊', kind: 'fox', name: 'Ember', rarity: 'Rare', w: 12 },
    { emoji: '🐼', kind: 'panda', name: 'Bao', rarity: 'Rare', w: 10 }, { emoji: '🦉', kind: 'owl', name: 'Sage', rarity: 'Epic', w: 8 },
    { emoji: '🐉', kind: 'dragon', name: 'Drako', rarity: 'Epic', w: 6 }, { emoji: '🦄', kind: 'unicorn', name: 'Nova', rarity: 'Legendary', w: 2 },
  ];
  const STAGES = [[0, 'Egg', '🥚'], [20, 'Hatchling'], [120, 'Kid'], [500, 'Teen'], [1500, 'Adult'], [5000, 'Legend']];
  const STOP = new Set('the a an and or but to of in on at for is are was were be i you he she it we they me my your our this that ok okay yes no hi hey hmm lol so just not have has do did will can its im u r ya na ha haha hahaha'.split(' '));

  function petFor(chatId, total, lastAt) {
    const h = crypto.createHash('sha256').update('pet:' + chatId).digest().readUInt32BE(0);
    let roll = h % PETS.reduce((s, p) => s + p.w, 0), pet = PETS[0];
    for (const p of PETS) { if (roll < p.w) { pet = p; break; } roll -= p.w; }
    let level = 0;
    STAGES.forEach(([min], i) => { if (total >= min) level = i; });
    const next = STAGES[level + 1]?.[0] ?? null;
    const hours = lastAt ? (Date.now() - lastAt) / 3600000 : 999;
    const mood = !lastAt ? ['Waiting to hatch', '✨'] : hours < 12 ? ['Happy', '😊'] : hours < 48 ? ['Content', '🙂'] : hours < 120 ? ['Lonely', '😢'] : ['Sleeping', '💤'];
    return { ...pet, w: undefined, level, stage: STAGES[level][1], display: level === 0 ? '🥚' : pet.emoji, xp: total, next, mood: mood[0], moodEmoji: mood[1] };
  }

  app.get('/api/chats/:id/stats', auth, wrap(async (req, res) => {
    const chatId = toInt(req.params.id);
    const me = await requireMember(chatId, req.uid);
    const period = ['month', 'year', 'all'].includes(req.query.period) ? req.query.period : 'month';
    const since = period === 'all' ? new Date(0) : new Date(Date.now() - (period === 'month' ? 30 : 365) * DAY);
    const rows = await db.q(
      "SELECT id, sender_id, kind, created_at FROM messages WHERE chat_id=? AND deleted=0 AND kind<>'system' AND id>? AND created_at>=? ORDER BY id LIMIT 200000",
      [chatId, Number(me.cleared_before_id), since]
    );
    const perSender = {}, voice = {}, photos = {}, byDay = {}, replyGaps = {};
    let lateNight = 0, calls = 0, prev = null;
    for (const r of rows) {
      const sid = Number(r.sender_id), t = ms(r.created_at);
      perSender[sid] = (perSender[sid] || 0) + 1;
      if (r.kind === 'audio') voice[sid] = (voice[sid] || 0) + 1;
      if (r.kind === 'image' || r.kind === 'video') photos[sid] = (photos[sid] || 0) + 1;
      if (r.kind === 'call') calls++;
      const d = new Date(t + 5.5 * 3600000); // IST day boundaries
      const day = d.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
      if (d.getUTCHours() < 5) lateNight++;
      if (prev && prev.sid !== sid && t - prev.t < 6 * 3600000) (replyGaps[sid] ||= []).push(t - prev.t);
      prev = { sid, t };
    }
    const days = Object.keys(byDay).sort();
    let streak = 0, run = 0, last = null;
    for (const d of days) {
      run = last && (new Date(d) - new Date(last)) === DAY ? run + 1 : 1;
      streak = Math.max(streak, run); last = d;
    }
    const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
    const fastest = Object.entries(replyGaps).filter(([, g]) => g.length >= 3)
      .map(([sid, g]) => [Number(sid), g.sort((a, b) => a - b)[Math.floor(g.length / 2)]]).sort((a, b) => a[1] - b[1])[0] || null;
    // Favourite word & emoji ("inside jokes") from recent text messages.
    const texts = await db.q("SELECT body_enc FROM messages WHERE chat_id=? AND kind='text' AND deleted=0 AND id>? AND created_at>=? ORDER BY id DESC LIMIT 3000", [chatId, Number(me.cleared_before_id), since]);
    const words = {}, emojis = {};
    for (const t of texts) {
      const b = C.decJson(t.body_enc, {}) || {};
      if (b.secure || b.eyes || !b.text) continue;
      for (const e of b.text.match(/\p{Extended_Pictographic}/gu) || []) emojis[e] = (emojis[e] || 0) + 1;
      for (const w of b.text.toLowerCase().match(/[\p{L}]{3,15}/gu) || []) if (!STOP.has(w)) words[w] = (words[w] || 0) + 1;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || null;
    const allTime = await db.one("SELECT COUNT(*) n, MAX(created_at) last FROM messages WHERE chat_id=? AND deleted=0 AND kind<>'system'", [chatId]);
    const users = {};
    for (const sid of Object.keys(perSender)) users[sid] = (await publicUser(Number(sid))).name;
    res.json({
      period, total: rows.length, perSender, voice, photos, calls, lateNight, streak, activeDays: days.length,
      busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
      fastest: fastest ? { userId: fastest[0], medianMs: fastest[1] } : null,
      topWord: top(words), topEmoji: top(emojis), users,
      pet: petFor(chatId, Number(allTime.n), ms(allTime.last)),
    });
  }));

  // ───────────────────── the pet that lives inside group chats ─────────────────────
  // Light-weight state for the roaming pet: who it is, how grown/happy, and whether someone caged it.
  // Pet 2.0 — needs (hunger, happiness, energy), a name, outfits unlocked as it grows, and a favourite
  // person (whoever feeds, plays with and pets it most). Care also helps it grow.
  const OUTFITS = [['bow', 2, 'Bow'], ['glasses', 3, 'Sunglasses'], ['scarf', 4, 'Scarf'], ['crown', 5, 'Crown']];
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const istHour = () => new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  async function petState(chatId) {
    const all = await db.one("SELECT COUNT(*) n, MAX(created_at) last FROM messages WHERE chat_id=? AND deleted=0 AND kind<>'system'", [chatId]);
    const row = await db.one('SELECT caged, caged_by, fed_at, name_enc, outfit, played_at, petted_at, love_enc FROM chat_pets WHERE chat_id=?', [chatId]);
    const love = (row?.love_enc && C.decJson(row.love_enc, {})) || {};
    const care = Object.values(love).reduce((a, b) => a + b, 0);
    const p = petFor(chatId, Number(all.n) + Math.round(care / 2), ms(all.last));
    const hrs = (t) => (t ? (Date.now() - ms(t)) / 3600000 : 999);
    const night = istHour() >= 23 || istHour() < 6;
    const hunger = clamp(100 - hrs(row?.fed_at) * 8);                                   // full after a meal, hungry in ~10 h
    const lastCare = Math.min(hrs(row?.fed_at), hrs(row?.played_at), hrs(row?.petted_at));
    const chatH = all.last ? (Date.now() - ms(all.last)) / 3600000 : 999;
    const happiness = clamp(0.4 * (chatH < 2 ? 100 : chatH < 12 ? 75 : chatH < 48 ? 45 : 15) + 0.3 * (lastCare < 1 ? 100 : lastCare < 6 ? 70 : lastCare < 24 ? 40 : 10) + 0.3 * hunger);
    const energy = clamp((night ? 30 : 92) - (hrs(row?.played_at) < 0.25 ? 30 : 0));
    let mood = p.mood, moodEmoji = p.moodEmoji;
    if (p.level > 0) {
      [mood, moodEmoji] = row?.caged ? ['Caged', '😿'] : hunger < 25 ? ['Hungry', '🍖'] : energy < 35 ? ['Sleepy', '😴'] : happiness >= 70 ? ['Happy', '😊'] : happiness >= 40 ? ['Content', '🙂'] : ['Lonely', '😢'];
      if (mood === 'Sleepy' && chatH > 120) [mood, moodEmoji] = ['Sleeping', '💤'];
    }
    const fav = Object.entries(love).sort((a, b) => b[1] - a[1])[0];
    const favorite = fav && fav[1] >= 3 ? { userId: Number(fav[0]), name: (await publicUser(Number(fav[0]))).name, love: fav[1] } : null;
    const outfits = OUTFITS.filter(([, lvl]) => p.level >= lvl).map(([id, , label]) => ({ id, label }));
    const outfit = row?.outfit && outfits.some((o) => o.id === row.outfit) ? row.outfit : null;
    return { ...p, defaultName: p.name, name: (row?.name_enc && C.dec(row.name_enc)) || p.name, mood, moodEmoji, hunger, happiness, energy, night,
      favorite, outfit, outfits, nextOutfit: OUTFITS.find(([, lvl]) => p.level < lvl)?.[2] || null,
      caged: !!row?.caged, cagedBy: row?.caged_by ? Number(row.caged_by) : null, fedAt: row?.fed_at ? ms(row.fed_at) : null };
  }
  async function addLove(chatId, uid, n) {
    const row = await db.one('SELECT love_enc FROM chat_pets WHERE chat_id=?', [chatId]);
    const love = (row?.love_enc && C.decJson(row.love_enc, {})) || {};
    love[uid] = Math.min(100000, (love[uid] || 0) + n);
    await db.q('INSERT INTO chat_pets (chat_id, love_enc) VALUES (?,?) ON DUPLICATE KEY UPDATE love_enc=VALUES(love_enc)', [chatId, C.enc(love)]);
  }

  app.get('/api/chats/:id/pet', auth, wrap(async (req, res) => {
    const chatId = toInt(req.params.id);
    await requireMember(chatId, req.uid);
    const chat = await db.one('SELECT type FROM chats WHERE id=?', [chatId]);
    if (chat?.type !== 'group') throw notFound(); // pets live in group chats only
    res.json({ pet: await petState(chatId) });
  }));

  // cage / release / feed are shared with the whole group; poke just makes it react for everyone.
  app.post('/api/chats/:id/pet', auth, wrap(async (req, res) => {
    const chatId = toInt(req.params.id);
    await requireMember(chatId, req.uid);
    rateLimit('pet:' + req.uid, 40, 60000);
    const action = String(req.body.action || '');
    if (!['cage', 'release', 'feed', 'poke', 'play', 'rename', 'outfit'].includes(action)) throw bad('Unknown action');
    if ((await db.one('SELECT type FROM chats WHERE id=?', [chatId]))?.type !== 'group') throw notFound();
    const extra = {};
    if (action === 'rename') {
      const name = clampStr(String(req.body.name || ''), 20).replace(/[\u0000-\u001f<>]/g, '').trim();
      if (!name) throw bad('Give it a name');
      rateLimit('petname:' + chatId, 6, 3600000);
      await db.q('INSERT INTO chat_pets (chat_id, name_enc) VALUES (?,?) ON DUPLICATE KEY UPDATE name_enc=VALUES(name_enc)', [chatId, C.enc(name)]);
      extra.name = name;
      await insertMessage({ chatId, senderId: req.uid, kind: 'system', body: { sys: { type: 'pet-name', name } } });
    } else if (action === 'outfit') {
      const st = await petState(chatId);
      const o = req.body.outfit ? String(req.body.outfit) : null;
      if (o && !st.outfits.some((x) => x.id === o)) throw bad('That outfit unlocks later');
      await db.q('INSERT INTO chat_pets (chat_id, outfit) VALUES (?,?) ON DUPLICATE KEY UPDATE outfit=VALUES(outfit)', [chatId, o]);
    } else if (action === 'play') {
      await db.q('INSERT INTO chat_pets (chat_id, played_at) VALUES (?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE played_at=CURRENT_TIMESTAMP(3)', [chatId]);
      await addLove(chatId, req.uid, 2);
      extra.throwX = Math.random(); // where the ball lands — the same on every phone
    } else if (action === 'poke') {
      await db.q('INSERT INTO chat_pets (chat_id, petted_at) VALUES (?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE petted_at=CURRENT_TIMESTAMP(3)', [chatId]);
      try { rateLimit('petlove:' + req.uid + ':' + chatId, 10, 600000); await addLove(chatId, req.uid, 1); } catch {}
    }
    if (action === 'cage' || action === 'release') {
      await db.q('INSERT INTO chat_pets (chat_id, caged, caged_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE caged=VALUES(caged), caged_by=VALUES(caged_by), updated_at=CURRENT_TIMESTAMP(3)',
        [chatId, action === 'cage' ? 1 : 0, action === 'cage' ? req.uid : null]);
    } else if (action === 'feed') {
      await db.q('INSERT INTO chat_pets (chat_id, fed_at) VALUES (?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE fed_at=CURRENT_TIMESTAMP(3)', [chatId]);
      await addLove(chatId, req.uid, 3);
    }
    const pet = await petState(chatId);
    io.to('c:' + chatId).emit('pet:event', { chatId, action, by: req.uid, pet, at: Date.now(), ...extra });
    res.json({ pet });
  }));

  // ───────────────────── reply without installing (guest links) ─────────────────────
  // Share a link; the other person reads your message and replies right in the browser with just
  // their name. Later they can save the account (username, password, birthday) and install the app.

  const origin = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const linkRow = (token) => db.one('SELECT * FROM guest_links WHERE token_hash=?', [C.sha256('guest:' + String(token || ''))]);

  app.post('/api/guest-links', auth, wrap(async (req, res) => {
    rateLimit('glink:' + req.uid, 20, 3600000);
    const token = crypto.randomBytes(15).toString('base64url');
    const msg = clampStr(req.body.message, 300).trim();
    await db.q('INSERT INTO guest_links (token_hash, user_id, msg_enc) VALUES (?,?,?)', [C.sha256('guest:' + token), req.uid, msg ? C.enc(msg) : null]);
    res.json({ url: `${origin(req)}/join/${token}`, token });
  }));

  app.get('/api/guest-links/:token', wrap(async (req, res) => {
    rateLimit('glinkv:' + req.ip, 60, 60000);
    const row = await linkRow(req.params.token);
    const inviter = row && (await getUser(Number(row.user_id)));
    if (!inviter) throw notFound('This invite link has expired');
    res.json({ inviter: { id: inviter.id, name: inviter.name, avatarV: inviter.avatarV }, message: C.dec(row.msg_enc) });
  }));

  app.get('/api/guest-links/:token/avatar', wrap(async (req, res) => {
    const row = await linkRow(req.params.token);
    const u = row && (await db.one('SELECT avatar_enc FROM users WHERE id=?', [row.user_id]));
    const m = u?.avatar_enc && /^data:(image\/[a-z]+);base64,(.*)$/.exec(C.dec(u.avatar_enc) || '');
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(m[2], 'base64'));
  }));

  app.post('/api/guest-links/:token/accept', wrap(async (req, res) => {
    rateLimit('glinka:' + req.ip, 10, 600000);
    const row = await linkRow(req.params.token);
    const inviterId = row && Number(row.user_id);
    if (!inviterId || !(await getUser(inviterId))) throw notFound('This invite link has expired');
    let uid = await sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
    let created = false;
    if (!uid) {
      const name = clampStr(req.body.name, 60).trim();
      if (!name) throw bad('Please enter your name');
      if (req.body.ageOk !== true) throw bad('Please confirm you’re 13 or older');
      let username = null;
      for (let i = 0; i < 20 && !username; i++) {
        const cand = 'guest' + crypto.randomInt(100000, 9999999);
        if (!(await usernameProblem(cand))) username = cand;
      }
      uid = await createUser({ username, name, guest: true });
      await createSession(req, res, uid);
      created = true;
    }
    if (uid === inviterId) throw bad('That’s your own invite link — share it with someone else');
    const chatId = await ensureDirectChat(inviterId, uid);
    const msg = C.dec(row.msg_enc);
    if (created && msg) await insertMessage({ chatId, senderId: inviterId, kind: 'text', body: { text: msg } });
    await db.q('UPDATE guest_links SET uses=uses+1 WHERE token_hash=?', [row.token_hash]);
    res.json({ user: await meView(uid), chatId });
  }));

  // Guests save their account: username, password, birthday.
  app.post('/api/me/upgrade', auth, wrap(async (req, res) => {
    const me = await getUser(req.uid);
    if (!me.settings.guest) throw bad('Your account is already saved');
    const username = U.normalize(clampStr(req.body.username, 40));
    const problem = await usernameProblem(username, req.uid);
    if (problem) throw bad(problem);
    const pw = String(req.body.password || '');
    if (pw.length < 8 || pw.length > 200) throw bad('Password must be at least 8 characters');
    const birth = parseBirth(req.body.birth);
    const settings = { ...me.settings, guest: false };
    delete settings.features; delete settings.trusted;
    const rowS = await db.one('SELECT settings_enc FROM users WHERE id=?', [req.uid]);
    const stored = { ...(C.decJson(rowS.settings_enc, {}) || {}), guest: false };
    await db.q('UPDATE users SET uname_hash=?, uname_canon=?, uname_enc=?, pass_hash=?, birth_enc=?, settings_enc=? WHERE id=?',
      [unameHash(username), unameCanon(username), C.enc(username), await C.hashPassword(pw), C.enc(birth), C.enc(stored), req.uid]);
    userCache.delete(req.uid);
    res.json({ user: await meView(req.uid) });
  }));

  // ───────────────────── Us space (direct chats) ─────────────────────

  const DAY_MS = 86400000;
  app.get('/api/chats/:id/us', auth, wrap(async (req, res) => {
    const chatId = toInt(req.params.id);
    await requireMember(chatId, req.uid);
    const chat = await db.one('SELECT type, extra_enc, created_at FROM chats WHERE id=?', [chatId]);
    if (chat.type !== 'direct') throw bad('Us space is for one-to-one chats');
    const extra = C.decJson(chat.extra_enc, {}) || {};
    const first = await db.one("SELECT MIN(created_at) t FROM messages WHERE chat_id=? AND kind NOT IN ('system','call')", [chatId]);
    const firstAt = first?.t ? ms(first.t) : ms(chat.created_at);
    const sinceAt = extra.since ? new Date(extra.since + 'T00:00:00+05:30').getTime() : firstAt;
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const todayRows = await db.q("SELECT DISTINCT sender_id FROM messages WHERE chat_id=? AND deleted=0 AND kind NOT IN ('system','call') AND DATE(CONVERT_TZ(created_at,'+00:00','+05:30'))=?", [chatId, today]);
    const total = await db.one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND deleted=0 AND kind NOT IN ('system','call')", [chatId]);
    const pings = await db.one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND kind='ping'", [chatId]);
    // next anniversary of the "together since" date
    let anniversary = null;
    if (extra.since) {
      const [, m, d] = extra.since.split('-').map(Number);
      const now = new Date();
      let next = new Date(now.getFullYear(), m - 1, d);
      if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(now.getFullYear() + 1, m - 1, d);
      anniversary = { at: next.getTime(), years: next.getFullYear() - Number(extra.since.slice(0, 4)), inDays: Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS) };
    }
    const letterRows = await db.q("SELECT * FROM messages WHERE chat_id=? AND kind='letter' AND deleted=0 ORDER BY id DESC LIMIT 50", [chatId]);
    const { serializeMessagesFor } = x;
    res.json({
      since: extra.since || null, sinceAt, label: extra.label || '',
      days: Math.max(0, Math.floor((Date.now() - sinceAt) / DAY_MS)),
      streak: (await streaksFor([chatId])).get(chatId) || 0,
      bothToday: todayRows.length >= 2, iSentToday: todayRows.some((r) => Number(r.sender_id) === req.uid),
      messages: Number(total.n), pings: Number(pings.n), anniversary,
      letters: (await serializeMessagesFor(letterRows, req.uid)).map((m) => ({ id: m.id, senderId: m.senderId, createdAt: m.createdAt, ...m.letter })),
    });
  }));

  app.patch('/api/chats/:id/us', auth, wrap(async (req, res) => {
    const chatId = toInt(req.params.id);
    await requireMember(chatId, req.uid);
    const chat = await db.one('SELECT type, extra_enc FROM chats WHERE id=?', [chatId]);
    if (chat.type !== 'direct') throw bad('Us space is for one-to-one chats');
    const extra = C.decJson(chat.extra_enc, {}) || {};
    if (req.body.since !== undefined) {
      if (req.body.since === null || req.body.since === '') delete extra.since;
      else {
        const v = String(req.body.since);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v).getTime() > Date.now()) throw bad('Pick a date in the past');
        extra.since = v;
      }
    }
    if (typeof req.body.label === 'string') extra.label = clampStr(req.body.label, 40).trim();
    await db.q('UPDATE chats SET extra_enc=? WHERE id=?', [C.enc(extra), chatId]);
    io.to('c:' + chatId).emit('us:changed', { chatId });
    res.json({ ok: true });
  }));

  return {
    start(loop) {
      loop(runReminders, 15000);
      loop(runCheckins, 15000);
    },
  };
};
