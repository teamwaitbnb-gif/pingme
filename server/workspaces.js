// Organization-wide channels reuse the chat transport and its membership checks.
const crypto = require('crypto');
const fail = (status, message) => Object.assign(new Error(message), { status });
const manager = (role) => role === 'owner' || role === 'admin';
function canManageMember(actor, target) { return actor === 'owner' || actor === 'admin' && target === 'member'; }
function validInvite(row, now = Date.now()) { return !!row && !row.revoked && !row.accepted_by && new Date(row.expires_at).getTime() > now; }
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS workspaces (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name_enc TEXT NOT NULL, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, role ENUM('owner','admin','member') NOT NULL DEFAULT 'member', joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(workspace_id,user_id), INDEX(user_id))`,
  `CREATE TABLE IF NOT EXISTS workspace_channels (chat_id BIGINT UNSIGNED PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL, name_key VARCHAR(80) NOT NULL, UNIQUE KEY(workspace_id,name_key))`,
  `CREATE TABLE IF NOT EXISTS workspace_invites (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, role ENUM('admin','member') NOT NULL DEFAULT 'member', created_by BIGINT UNSIGNED NOT NULL, expires_at DATETIME(3) NOT NULL, revoked TINYINT NOT NULL DEFAULT 0, accepted_by BIGINT UNSIGNED NULL, INDEX(workspace_id))`,
];
module.exports = function workspaces({ app, db, C, auth, wrap, rateLimit, publicUser, getUser, emitToUser, joinUserToChat, disconnectUser, publicOrigin }) {
  const idOf = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw fail(400, 'Invalid ID'); return n; };
  const label = (v) => { const s = String(v || '').trim(); if (!s || s.length > 80) throw fail(400, 'Use a name between 1 and 80 characters'); return s; };
  const hash = (token) => C.sha256('workspace-invite:' + token);
  async function tx(fn) {
    const conn = await db.pool.getConnection();
    const q = async (sql, args) => (await conn.query(sql, args))[0];
    const t = { q, one: async (sql, args) => (await q(sql, args))[0] || null };
    try { await conn.beginTransaction(); const out = await fn(t); await conn.commit(); return out; }
    catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }
  async function member(d, wid, uid, lock = false) {
    if (lock && !await d.one('SELECT id FROM workspaces WHERE id=? FOR UPDATE', [wid])) throw fail(404, 'Organization not found');
    const m = await d.one('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?', [wid, uid]);
    if (!m) throw fail(403, 'You are not a member of this organization');
    return m.role;
  }
  async function account(uid) { const u = await getUser(uid); if (!u || u.settings.guest) throw fail(403, 'Create a full account to use organizations'); }
  async function changed(wid) {
    for (const m of await db.q('SELECT user_id FROM workspace_members WHERE workspace_id=?', [wid])) emitToUser(Number(m.user_id), 'workspace:changed', { workspaceId: wid });
  }
  async function channel(t, wid, uid, title) {
    const key = C.sha256(title.toLowerCase());
    if (await t.one('SELECT chat_id FROM workspace_channels WHERE workspace_id=? AND name_key=?', [wid, key])) throw fail(409, 'A channel with this name already exists');
    const r = await t.q("INSERT INTO chats (type,title_enc,created_by) VALUES ('group',?,?)", [C.enc(title), uid]);
    const cid = Number(r.insertId);
    await t.q('INSERT INTO workspace_channels (chat_id,workspace_id,name_key) VALUES (?,?,?)', [cid, wid, key]);
    await t.q("INSERT INTO chat_members (chat_id,user_id,role) SELECT ?,user_id,IF(role='member','member','admin') FROM workspace_members WHERE workspace_id=?", [cid, wid]);
    return cid;
  }
  // Prevent legacy group controls from bypassing organization membership or roles.
  app.use('/api/chats/:id', auth, wrap(async (req, res, next) => {
    if (req.method === 'GET') return next();
    const c = await db.one('SELECT workspace_id FROM workspace_channels WHERE chat_id=?', [idOf(req.params.id)]);
    if (!c) return next();
    await member(db, c.workspace_id, req.uid);
    if (/^\/(members|admins|incognito)(\/|$)/i.test(req.path) || req.method === 'DELETE' && req.path === '/') throw fail(403, 'Manage channel membership in the organization');
    if (req.method === 'PATCH' && req.path === '/' && ('title' in req.body || 'avatar' in req.body || 'disappearSecs' in req.body)) throw fail(403, 'Manage channels in the organization');
    next();
  }));
  app.get('/api/workspaces', auth, wrap(async (req, res) => {
    const rows = await db.q('SELECT w.id,w.name_enc,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.id', [req.uid]);
    res.json({ workspaces: rows.map((r) => ({ id: Number(r.id), name: C.dec(r.name_enc), role: r.role })) });
  }));
  app.post('/api/workspaces', auth, wrap(async (req, res) => {
    await account(req.uid); rateLimit('workspace:create:' + req.uid, 5, 3600000);
    const name = label(req.body.name);
    const out = await tx(async (t) => {
      const r = await t.q('INSERT INTO workspaces (name_enc,created_by) VALUES (?,?)', [C.enc(name), req.uid]); const wid = Number(r.insertId);
      await t.q("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,'owner')", [wid, req.uid]);
      return { id: wid, chatId: await channel(t, wid, req.uid, 'General') };
    });
    joinUserToChat(req.uid, out.chatId); await changed(out.id); res.status(201).json(out);
  }));
  app.get('/api/workspaces/:wid', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), role = await member(db, wid, req.uid);
    const w = await db.one('SELECT name_enc FROM workspaces WHERE id=?', [wid]);
    const members = await db.q('SELECT user_id,role FROM workspace_members WHERE workspace_id=? ORDER BY joined_at', [wid]);
    const channels = await db.q('SELECT c.id,c.title_enc FROM workspace_channels wc JOIN chats c ON c.id=wc.chat_id WHERE wc.workspace_id=? ORDER BY c.id', [wid]);
    const invites = manager(role) ? await db.q('SELECT id,role,expires_at,revoked,accepted_by FROM workspace_invites WHERE workspace_id=? ORDER BY id DESC LIMIT 50', [wid]) : [];
    res.json({ id: wid, name: C.dec(w.name_enc), role, members: await Promise.all(members.map(async (m) => ({ ...(await publicUser(Number(m.user_id))), role: m.role }))), channels: channels.map((c) => ({ id: Number(c.id), name: C.dec(c.title_enc) })), invites });
  }));
  app.post('/api/workspaces/:wid/channels', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), name = label(req.body.name);
    rateLimit('workspace:channel:' + req.uid, 30, 3600000);
    const cid = await tx(async (t) => { if (!manager(await member(t, wid, req.uid, true))) throw fail(403, 'Only owners and admins can create channels'); return channel(t, wid, req.uid, name); });
    for (const m of await db.q('SELECT user_id FROM workspace_members WHERE workspace_id=?', [wid])) { joinUserToChat(Number(m.user_id), cid); emitToUser(Number(m.user_id), 'chat:changed', { chatId: cid }); }
    await changed(wid); res.status(201).json({ chatId: cid });
  }));
  app.patch('/api/workspaces/:wid/members/:uid', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), uid = idOf(req.params.uid), role = req.body.role;
    if (!['owner','admin','member'].includes(role)) throw fail(400, 'Choose owner, admin, or member');
    await tx(async (t) => {
      if (await member(t, wid, req.uid, true) !== 'owner') throw fail(403, 'Only owners can change roles');
      const old = await member(t, wid, uid);
      if (old === 'owner' && role !== 'owner') { const r = await t.one("SELECT COUNT(*) n FROM workspace_members WHERE workspace_id=? AND role='owner'", [wid]); if (Number(r.n) <= 1) throw fail(409, 'Assign another owner first'); }
      await t.q('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?', [role, wid, uid]);
      await t.q("UPDATE chat_members cm JOIN workspace_channels wc ON wc.chat_id=cm.chat_id SET cm.role=? WHERE wc.workspace_id=? AND cm.user_id=?", [manager(role) ? 'admin' : 'member', wid, uid]);
    });
    await changed(wid); res.json({ ok: true });
  }));
  app.delete('/api/workspaces/:wid/members/:uid', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), uid = idOf(req.params.uid);
    await tx(async (t) => {
      const actor = await member(t, wid, req.uid, true), target = await member(t, wid, uid);
      if (uid !== req.uid && !canManageMember(actor, target)) throw fail(403, 'You cannot remove this member');
      if (target === 'owner') { const r = await t.one("SELECT COUNT(*) n FROM workspace_members WHERE workspace_id=? AND role='owner'", [wid]); if (Number(r.n) <= 1) throw fail(409, 'Assign another owner before leaving'); }
      await t.q('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?', [wid, uid]);
      await t.q('UPDATE chat_members cm JOIN workspace_channels wc ON wc.chat_id=cm.chat_id SET cm.active=0,cm.removed=1 WHERE wc.workspace_id=? AND cm.user_id=?', [wid, uid]);
      await t.q('UPDATE workspace_invites SET revoked=1 WHERE workspace_id=? AND created_by=? AND accepted_by IS NULL', [wid, uid]);
      await t.q('DELETE sm FROM scheduled_messages sm JOIN workspace_channels wc ON wc.chat_id=sm.chat_id WHERE wc.workspace_id=? AND sm.sender_id=?', [wid, uid]);
    });
    disconnectUser(uid); await changed(wid); res.json({ ok: true });
  }));
  app.post('/api/workspaces/:wid/invites', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), role = req.body.role || 'member';
    if (!['admin','member'].includes(role)) throw fail(400, 'Invitations can grant member or admin access');
    rateLimit('workspace:invite:' + req.uid, 30, 3600000);
    const token = crypto.randomBytes(32).toString('base64url'), expires = new Date(Date.now() + 7 * 86400e3);
    await tx(async (t) => { const actor = await member(t, wid, req.uid, true); if (!manager(actor) || role === 'admin' && actor !== 'owner') throw fail(403, 'You cannot invite this role'); await t.q('INSERT INTO workspace_invites (workspace_id,token_hash,role,created_by,expires_at) VALUES (?,?,?,?,?)', [wid, hash(token), role, req.uid, expires]); });
    res.status(201).json({ token, url: `${publicOrigin(req)}/#workspace-invite=${token}`, expiresAt: expires });
  }));
  app.delete('/api/workspaces/:wid/invites/:iid', auth, wrap(async (req, res) => {
    const wid = idOf(req.params.wid), iid = idOf(req.params.iid);
    await tx(async (t) => { const actor = await member(t, wid, req.uid, true); if (!manager(actor)) throw fail(403, 'Only owners and admins can revoke invitations'); await t.q('UPDATE workspace_invites SET revoked=1 WHERE id=? AND workspace_id=?', [iid, wid]); });
    res.json({ ok: true });
  }));
  app.post('/api/workspace-invites/accept', auth, wrap(async (req, res) => {
    await account(req.uid); rateLimit('workspace:accept:' + req.uid, 20, 60000);
    const token = String(req.body.token || ''); if (!/^[\w-]{43}$/.test(token)) throw fail(400, 'Invalid invitation');
    const pre = await db.one('SELECT workspace_id FROM workspace_invites WHERE token_hash=?', [hash(token)]); if (!pre) throw fail(404, 'Invitation not found');
    const wid = Number(pre.workspace_id);
    await tx(async (t) => {
      await t.one('SELECT id FROM workspaces WHERE id=? FOR UPDATE', [wid]);
      const inv = await t.one('SELECT * FROM workspace_invites WHERE token_hash=? FOR UPDATE', [hash(token)]);
      if (!validInvite(inv)) throw fail(410, 'This invitation has expired, was revoked, or has already been used');
      const issuer = await t.one('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?', [wid, inv.created_by]);
      if (!issuer || !manager(issuer.role) || inv.role === 'admin' && issuer.role !== 'owner') throw fail(410, 'The inviter no longer has permission');
      if (await t.one('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?', [wid, req.uid])) throw fail(409, 'You already belong to this organization');
      await t.q('INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,?)', [wid, req.uid, inv.role]);
      await t.q("INSERT INTO chat_members (chat_id,user_id,role,active,removed) SELECT chat_id,?,?,1,0 FROM workspace_channels WHERE workspace_id=? ON DUPLICATE KEY UPDATE role=VALUES(role),active=1,removed=0", [req.uid, manager(inv.role) ? 'admin' : 'member', wid]);
      await t.q('UPDATE workspace_invites SET accepted_by=? WHERE id=?', [req.uid, inv.id]);
    });
    for (const c of await db.q('SELECT chat_id FROM workspace_channels WHERE workspace_id=?', [wid])) joinUserToChat(req.uid, Number(c.chat_id));
    await changed(wid); res.json({ workspaceId: wid });
  }));
};
module.exports.SCHEMA = SCHEMA;
module.exports.canManageMember = canManageMember;
module.exports.validInvite = validInvite;
