// Notifications the owner controls from the admin page:
//  • one-off messages to everyone, recently active people, a city, or chosen usernames;
//  • automatic "trending now" alerts for the biggest Buzz stories;
//  • automatic "your group pet is hungry" alerts.
// Each goes out as a phone notification and, when the app is open, as an in-app banner.
// People can switch the automatic ones off in Settings (buzzAlerts / petAlerts). Automatic alerts
// only go out during the day (IST) and are spaced out, so nobody is spammed.
const IST = 5.5 * 3600e3;
const istHour = (t = Date.now()) => new Date(t + IST).getUTCHours();
const istDay = (t = Date.now()) => new Date(t + IST).toISOString().slice(0, 10);

const DEFAULTS = {
  // Up to 15 viral stories a day per person, about one an hour from 8 am to 11 pm (IST), each a
  // different story. "Viral" = trending, covered by several outlets, or buzzing on Ping Me.
  buzz: { v: 2, on: true, perDay: 15, gapMinutes: 50, from: 8, to: 23, minOutlets: 2, maxAgeHours: 8 },
  pets: { on: true, below: 25, gapHours: 12, activeDays: 3, from: 9, to: 21 },
};

module.exports = function notify({ app, db, C, push, emitToUser, getUser, isAdmin, wrap, bad, toInt, clampStr, buzz, petState, monitor, pushStats }) {
  const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Admin key required' }));

  // ───── settings ─────
  let config = null;
  async function getConfig() {
    if (config) return config;
    const row = await db.one("SELECT v FROM app_config WHERE k='notify'").catch(() => null);
    let saved = {};
    try { saved = row ? JSON.parse(row.v) : {}; } catch {}
    // Settings saved before the 15-a-day version keep only their on/off switch.
    const sb = saved.buzz?.v === 2 ? saved.buzz : { on: saved.buzz?.on ?? true };
    config = { buzz: { ...DEFAULTS.buzz, ...sb }, pets: { ...DEFAULTS.pets, ...(saved.pets || {}) } };
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
    else if (to === 'city') {
      const city = String(req.body?.city || '');
      if (!buzz.REGIONS.has(city)) throw bad('Choose a city');
      list = (await people()).filter((u) => (u.settings.buzzRegion || 'india') === city);
      audience = `City: ${buzz.CITIES[city]?.name || 'All of India'}`;
    } else if (to === 'users') {
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

  // ───── admin: settings, history, and "send the top story now" ─────
  app.get('/api/admin/notify', adminOnly, wrap(async (req, res) => {
    const c = await getConfig();
    const hist = await db.q('SELECT id, kind, title, body, url, audience, recipients, created_at FROM notify_history ORDER BY id DESC LIMIT 60');
    const day = new Date(Date.now() - 24 * 3600e3);
    const [[today]] = [await db.q("SELECT SUM(kind='buzz') buzz, SUM(kind='pet') pets, SUM(kind='admin') admin, SUM(recipients) people FROM notify_history WHERE created_at > ?", [day])];
    const audience = await people();
    const optedOut = { buzz: audience.filter((u) => u.settings.buzzAlerts === false).length, pets: audience.filter((u) => u.settings.petAlerts === false).length };
    const withPush = new Set((await db.q('SELECT DISTINCT user_id FROM push_subs')).map((r) => Number(r.user_id)));
    res.json({ pushOn: audience.filter((u) => withPush.has(u.id)).length, delivery: pushStats?.() || null, config: c, history: hist.map((h) => ({ ...h, createdAt: new Date(h.created_at).getTime() })), last24h: today, reachable: audience.length, optedOut,
      cities: [...Object.entries(buzz.CITIES).map(([id, x]) => ({ id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)), { id: 'india', name: 'All of India' }],
      nextBuzz: await bestStory('india', c.buzz).then((x) => x && { id: x.row.id, title: x.row.title, outlets: x.coverage || 1 }).catch(() => null) });
  }));
  app.post('/api/admin/notify/config', adminOnly, wrap(async (req, res) => {
    const c = await getConfig();
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
    const b = req.body?.buzz || {}, p = req.body?.pets || {};
    const next = {
      buzz: { v: 2, on: b.on ?? c.buzz.on, perDay: num(b.perDay, 0, 30, c.buzz.perDay), gapMinutes: num(b.gapMinutes, 15, 600, c.buzz.gapMinutes), from: num(b.from, 0, 23, c.buzz.from), to: num(b.to, 1, 24, c.buzz.to), minOutlets: num(b.minOutlets, 1, 10, c.buzz.minOutlets), maxAgeHours: num(b.maxAgeHours, 1, 24, c.buzz.maxAgeHours) },
      pets: { on: p.on ?? c.pets.on, below: num(p.below, 5, 60, c.pets.below), gapHours: num(p.gapHours, 2, 48, c.pets.gapHours), activeDays: num(p.activeDays, 1, 30, c.pets.activeDays), from: num(p.from, 0, 23, c.pets.from), to: num(p.to, 1, 24, c.pets.to) },
    };
    next.buzz.on = !!next.buzz.on; next.pets.on = !!next.pets.on;
    await saveConfig(next);
    res.json({ config: next });
  }));
  app.post('/api/admin/notify/buzz-now', adminOnly, wrap(async (req, res) => {
    const r = await runBuzz({ force: true, itemId: req.body?.itemId ? String(req.body.itemId) : null });
    res.json({ ok: true, recipients: r.sent, story: r.story, skipped: r.skipped, busy: !!r.busy });
  }));
  app.post('/api/admin/notify/pets-now', adminOnly, wrap(async (req, res) => {
    const r = await runPets({ force: true });
    res.json({ ok: true, recipients: r.sent, groups: r.groups, checked: r.checked, skipped: r.skipped, busy: !!r.busy });
  }));

  // ───── automatic: trending Buzz stories ─────
  // The biggest fresh story for a region: covered by several outlets or trending, published recently.
  // Viral stories for a region, best first: trending / covered by several outlets / buzzing on
  // Ping Me, fresh, Indian or local (not foreign news), and not videos. If the news is quiet, the
  // best fresh stories fill in, so people still get their stories.
  const viral = (x) => (x.coverage || 1) >= 2 || ['trending', 'top', 'buzzing'].includes(x.label?.kind);
  async function candidates(region, cfg, relaxed = false) {
    const { list } = await buzz.ranked(region);
    const maxAge = (relaxed ? Math.max(cfg.maxAgeHours, 24) : cfg.maxAgeHours) * 3600e3;
    const ok = list.filter((x) => Date.now() - x.ts < maxAge && !x.row.video_url && x.row.region !== 'world');
    const rank = (x) => (x.coverage || 1) * 0.6 + x.score * 4 + (viral(x) ? 2 : 0);
    const hot = ok.filter((x) => viral(x) && (x.coverage || 1) >= Math.min(cfg.minOutlets, 2) || ['trending', 'top', 'buzzing'].includes(x.label?.kind)).sort((a, b) => rank(b) - rank(a));
    const rest = ok.filter((x) => !hot.includes(x)).sort((a, b) => rank(b) - rank(a));
    return [...hot, ...rest].slice(0, 80);
  }
  async function topStory(region, cfg = DEFAULTS.buzz) { return (await candidates(region, cfg))[0] || null; }
  async function bestStory(region, cfg) { return (await candidates(region, cfg, true))[0] || null; }
  let buzzBusy = false;
  async function runBuzz({ force = false, itemId = null } = {}) {
    const cfg = (await getConfig()).buzz;
    const out = { sent: 0, story: null, skipped: { optedOut: 0, noStory: 0, alreadyGot: 0, dailyLimit: 0 } };
    if (buzzBusy) return { ...out, busy: true };
    if (!force && (!cfg.on || cfg.perDay < 1)) return out;
    const h = istHour();
    if (!force && (h < cfg.from || h >= cfg.to)) return out;
    buzzBusy = true;
    let sent = 0;
    const titles = new Set();
    try {
      const byRegion = new Map();
      const pool = async (region) => {
        if (!byRegion.has(region)) {
          let list = await candidates(region, cfg, force).catch(() => []);
          if (itemId) { const one = list.find((x) => x.row.id === itemId) || (await buzz.ranked(region)).list.find((x) => x.row.id === itemId || x.members?.includes(itemId)); list = one ? [one] : []; }
          byRegion.set(region, list);
        }
        return byRegion.get(region);
      };
      for (const u of await people(30)) {
        if (u.settings.buzzAlerts === false) { out.skipped.optedOut++; continue; }
        const region = buzz.REGIONS.has(u.settings.buzzRegion) ? u.settings.buzzRegion : 'india';
        const list = await pool(region);
        if (!list.length) { out.skipped.noStory++; continue; }
        const dayKey = `bd:${u.id}:${istDay()}`;
        if (!force) {
          const d = await lastSent(dayKey);
          if (d && d.n >= cfg.perDay) { out.skipped.dailyLimit++; continue; }
          const last = await lastSent(`bl:${u.id}`);
          if (last && Date.now() - last.at < cfg.gapMinutes * 60000) { out.skipped.dailyLimit++; continue; }
        }
        // The best story this person hasn't been sent yet (never the same story twice).
        let story = null;
        for (const x of list) { if (!(await lastSent(`bs:${u.id}:${x.row.id}`))) { story = x; break; } }
        if (!story) { out.skipped.alreadyGot++; continue; }
        const outlets = story.coverage || 1;
        const title = story.label?.kind === 'buzzing' ? 'Buzzing on Ping Me' : story.label?.kind === 'trending' ? 'Trending now' : outlets >= 3 ? `Big story · ${outlets} outlets` : 'Viral on Buzz';
        await deliver(u.id, { title, body: story.row.title, url: `/?buzz=${story.row.id}`, tag: 'pm-buzz-' + story.row.id });
        const d = await lastSent(dayKey);
        await mark(dayKey, (d?.n || 0) + 1); await mark(`bl:${u.id}`); await mark(`bs:${u.id}:${story.row.id}`);
        sent++; titles.add(story.row.title);
      }
      out.sent = sent; out.story = [...titles][0] || [...byRegion.values()].find((l) => l.length)?.[0]?.row.title || null;
      if (sent) { await history('buzz', titles.size > 1 ? `Viral on Buzz · ${titles.size} stories` : 'Viral on Buzz', [...titles].slice(0, 3).join(' · '), null, force ? 'Sent from admin' : 'Automatic', sent); monitor?.log?.(null, 'notify', { kind: 'buzz', n: sent }); }
    } finally { buzzBusy = false; }
    return out;
  }

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
      loop(() => runBuzz().catch((e) => console.error('buzz alerts:', e.message)), 10 * 60000);
      loop(() => runPets().catch((e) => console.error('pet alerts:', e.message)), 15 * 60000);
    },
    runBuzz, runPets,
  };
};
