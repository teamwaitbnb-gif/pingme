// Notifications the owner controls from the admin page:
//  • one-off messages to everyone, recently active people, a city, or chosen usernames;
//  • automatic "your group pet is hungry" alerts.
// Each goes out as a phone notification and, when the app is open, as an in-app banner.
// People can switch the automatic ones off in Settings (petAlerts). Automatic alerts
// only go out during the day (IST) and are spaced out, so nobody is spammed.
const IST = 5.5 * 3600e3;
const istHour = (t = Date.now()) => new Date(t + IST).getUTCHours();
const istDay = (t = Date.now()) => new Date(t + IST).toISOString().slice(0, 10);

const DEFAULTS = {
  pets: { on: true, below: 25, gapHours: 12, activeDays: 3, from: 9, to: 21 },
};

module.exports = function notify({ app, db, C, push, emitToUser, getUser, isAdmin, wrap, bad, toInt, clampStr, petState, monitor, pushStats }) {
  const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Admin key required' }));

  // ───── settings ─────
  let config = null;
  async function getConfig() {
    if (config) return config;
    const row = await db.one("SELECT v FROM app_config WHERE k='notify'").catch(() => null);
    let saved = {};
    try { saved = row ? JSON.parse(row.v) : {}; } catch {}
    // Settings saved before the 15-a-day version keep only their on/off switch.
    config = { pets: { ...DEFAULTS.pets, ...(saved.pets || {}) } };
    return config;
  }
  async function saveConfig(c) {
    config = c;
    await db.q("INSERT INTO app_config (k, v) VALUES ('notify', ?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [JSON.stringify(c)]);
  }

  // ───── delivery ─────
  async function deliver(uid, { title, body, url, tag }) {
    emitToUser(uid, 'notice', { title, body, url });
    await push.send(uid, { type: 'msg', title, body, url: url || '/', tag: tag || 'pm-notice' }).catch(() => {});
  }
  async function lastSent(key) {
    const r = await db.one('SELECT at, n FROM notify_log WHERE k=?', [key]);
    return r ? { at: new Date(r.at).getTime(), n: Number(r.n) } : null;
  }
  const mark = (key, n = 1) => db.q('INSERT INTO notify_log (k, n, at) VALUES (?,?,NOW(3)) ON DUPLICATE KEY UPDATE n=VALUES(n), at=NOW(3)', [key, n]);
  const history = (kind, title, body, url, audience, recipients) =>
    db.q('INSERT INTO notify_history (kind, title, body, url, audience, recipients) VALUES (?,?,?,?,?,?)', [kind, title.slice(0, 120), body.slice(0, 400), url ? url.slice(0, 300) : null, audience.slice(0, 120), recipients]);

  // Everyone who could get a notification (has used the app in the last 60 days).
  async function people(sinceDays = 60) {
    const rows = await db.q('SELECT id FROM users WHERE last_seen > ? ORDER BY id', [new Date(Date.now() - sinceDays * 86400e3)]);
    const out = [];
    for (const r of rows) { const u = await getUser(Number(r.id)); if (u && !u.settings.guest) out.push(u); }
    return out;
  }

  // ───── admin: send now ─────
  app.post('/api/admin/notify/send', adminOnly, wrap(async (req, res) => {
    const title = clampStr(String(req.body?.title || ''), 80).trim();
    const body = clampStr(String(req.body?.body || ''), 300).trim();
    if (!title || !body) throw bad('Add a title and a message');
    let url = String(req.body?.url || '').trim();
    if (url && !/^\/(?!\/)/.test(url) && !/^https:\/\//.test(url)) throw bad('Link must start with / (inside Ping Me) or https://');
    url = url.slice(0, 300) || '/';
    const to = String(req.body?.to || 'all');
    let list, audience;
    if (to === 'active') { list = await people(7); audience = 'Active in the last 7 days'; }
    else if (to === 'users') {
      const names = String(req.body?.usernames || '').split(/[\s,]+/).map((s) => s.replace(/^@/, '').toLowerCase()).filter(Boolean).slice(0, 200);
      if (!names.length) throw bad('Add at least one username');
      list = (await people(3650)).filter((u) => names.includes(String(u.username).toLowerCase()));
      if (!list.length) throw bad('None of those usernames were found');
      audience = `Users: ${list.map((u) => '@' + u.username).join(', ')}`;
    } else { list = await people(); audience = 'Everyone'; }
    if (req.body?.preview) return res.json({ recipients: list.length, audience });
    for (const u of list) await deliver(u.id, { title, body, url, tag: 'pm-admin-' + Date.now() });
    await history('admin', title, body, url, audience, list.length);
    monitor?.log?.(null, 'notify', { kind: 'admin', n: list.length });
    res.json({ ok: true, recipients: list.length, audience });
  }));

  // ───── admin: settings and history ─────
  app.get('/api/admin/notify', adminOnly, wrap(async (req, res) => {
    const c = await getConfig();
    const hist = await db.q('SELECT id, kind, title, body, url, audience, recipients, created_at FROM notify_history ORDER BY id DESC LIMIT 60');
    const day = new Date(Date.now() - 24 * 3600e3);
    const [[today]] = [await db.q("SELECT SUM(kind='pet') pets, SUM(kind='admin') admin, SUM(recipients) people FROM notify_history WHERE created_at > ?", [day])];
    const audience = await people();
    const optedOut = { pets: audience.filter((u) => u.settings.petAlerts === false).length };
    const withPush = new Set((await db.q('SELECT DISTINCT user_id FROM push_subs')).map((r) => Number(r.user_id)));
    res.json({ pushOn: audience.filter((u) => withPush.has(u.id)).length, delivery: pushStats?.() || null, config: c, history: hist.map((h) => ({ ...h, createdAt: new Date(h.created_at).getTime() })), last24h: today, reachable: audience.length, optedOut });
  }));
  app.post('/api/admin/notify/config', adminOnly, wrap(async (req, res) => {
    const c = await getConfig();
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
    const p = req.body?.pets || {};
    const next = {
      pets: { on: p.on ?? c.pets.on, below: num(p.below, 5, 60, c.pets.below), gapHours: num(p.gapHours, 2, 48, c.pets.gapHours), activeDays: num(p.activeDays, 1, 30, c.pets.activeDays), from: num(p.from, 0, 23, c.pets.from), to: num(p.to, 1, 24, c.pets.to) },
    };
    next.pets.on = !!next.pets.on;
    await saveConfig(next);
    res.json({ config: next });
  }));
  app.post('/api/admin/notify/pets-now', adminOnly, wrap(async (req, res) => {
    const r = await runPets({ force: true });
    res.json({ ok: true, recipients: r.sent, groups: r.groups, checked: r.checked, skipped: r.skipped, busy: !!r.busy });
  }));

  // ───── automatic: hungry group pets ─────
  let petsBusy = false;
  async function runPets({ force = false } = {}) {
    const cfg = (await getConfig()).pets;
    const out = { sent: 0, groups: 0, checked: 0, skipped: { notHungry: 0, recentlyReminded: 0, noPet: 0 } };
    if (petsBusy) return { ...out, busy: true };
    if (!force && !cfg.on) return out;
    const h = istHour();
    if (!force && (h < cfg.from || h >= cfg.to)) return out;
    petsBusy = true;
    let sent = 0, groups = 0;
    try {
      // Only groups that are actually chatting (a pet nobody visits shouldn't nag anyone).
      const chats = await db.q("SELECT id, title_enc FROM chats WHERE type='group' AND last_msg_at > ? ORDER BY last_msg_at DESC LIMIT 500", [new Date(Date.now() - cfg.activeDays * 86400e3)]);
      for (const c of chats) {
        const chatId = Number(c.id);
        const st = await petState(chatId).catch(() => null);
        out.checked++;
        if (!st || !st.level || st.caged) { out.skipped.noPet++; continue; }
        if (st.hunger >= cfg.below) { out.skipped.notHungry++; continue; }
        const last = await lastSent(`pet:${chatId}`);
        if (last && Date.now() - last.at < cfg.gapHours * 3600e3) { out.skipped.recentlyReminded++; continue; }
        const members = await db.q('SELECT user_id, muted_until FROM chat_members WHERE chat_id=? AND active=1 AND removed=0', [chatId]);
        const group = C.dec(c.title_enc) || 'your group';
        const hours = st.fedAt ? Math.round((Date.now() - st.fedAt) / 3600e3) : null;
        let n = 0;
        for (const m of members) {
          if (m.muted_until && new Date(m.muted_until).getTime() > Date.now()) continue;
          const u = await getUser(Number(m.user_id));
          if (!u || u.settings.petAlerts === false || u.settings.features?.groupPets === false) continue;
          await deliver(u.id, { title: `${st.name} is hungry`, body: `${st.name} in ${group} ${hours && hours < 200 ? `hasn’t eaten for ${hours} hours` : 'is waiting for a meal'}. Tap to feed.`, url: `/?chat=${chatId}`, tag: 'pm-pet-' + chatId });
          n++;
        }
        await mark(`pet:${chatId}`);
        if (n) { sent += n; groups++; }
      }
      if (sent) { await history('pet', 'Hungry pets', `${groups} group${groups === 1 ? '' : 's'} reminded to feed their pet`, null, force ? 'Sent from admin' : 'Automatic', sent); monitor?.log?.(null, 'notify', { kind: 'pet', n: sent }); }
      out.sent = sent; out.groups = groups;
    } finally { petsBusy = false; }
    return out;
  }

  return {
    start(loop) {
      loop(() => runPets().catch((e) => console.error('pet alerts:', e.message)), 15 * 60000);
    },
    runPets,
  };
};
