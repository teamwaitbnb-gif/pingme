// Analytics + the owner's admin portal (/admin).
// Collects only activity metadata — which screen, for how long, which Buzz story was opened — never
// message text or call content. The portal is unlocked with ADMIN_KEY (not a Ping Me login, so the
// one-device rule never signs the owner's phone out).
const crypto = require('crypto');
const { byId } = require('./buzz/sources');
const srcName = (id) => byId(id)?.name || id;
const AI = require('./buzz/ai');

const SCREENS = new Set(['chats', 'chat', 'group', 'buzz', 'call', 'camera', 'settings', 'auth', 'install', 'other']);
const PLATFORMS = new Set(['ios', 'android', 'desktop', 'other']);
const IST = 5.5 * 3600e3;
const istDay = (t = Date.now()) => new Date(t + IST).toISOString().slice(0, 10);
const DAYSQL = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;

module.exports = function admin({ app, io, db, C, auth, wrap, bad, rateLimit, publicUser, getUser, parseCookies, online, buzz }) {
  const buzzMod = buzz;
  // ───── collection ─────
  app.post('/api/t', auth, wrap(async (req, res) => {
    rateLimit('t:' + req.uid, 120, 60000);
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 60) : [];
    const sid = String(req.body?.sid || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || null;
    const day = istDay();
    let secs = 0, buzzSecs = 0, buzz = 0, opens = 0;
    const rows = [];
    for (const e of events) {
      const type = String(e.t || '');
      if (type === 'session') {
        const platform = PLATFORMS.has(e.p) ? e.p : 'other';
        await db.q('INSERT INTO user_devices (user_id, platform, standalone) VALUES (?,?,?) ON DUPLICATE KEY UPDATE platform=VALUES(platform), standalone=VALUES(standalone), updated_at=CURRENT_TIMESTAMP(3)', [req.uid, platform, e.a ? 1 : 0]);
        rows.push([req.uid, sid, 'session', null, platform, e.a ? 1 : 0]);
        opens++;
      } else if (type === 'screen') {
        const screen = SCREENS.has(e.s) ? e.s : 'other';
        const v = Math.max(0, Math.min(3600, Math.round(Number(e.v) || 0)));
        if (!v) continue;
        rows.push([req.uid, sid, 'screen', screen, null, v]);
        secs += v;
        if (screen === 'buzz') { buzzSecs += v; buzz = 1; }
      } else if (type === 'buzz_seen') {
        // New apps send the stories themselves ([id, slot] pairs): they're never shown again, and each
        // impression is credited to the part of the algorithm that chose it.
        const pairs = Array.isArray(e.s) ? e.s.slice(0, 200).filter(Array.isArray) : [];
        const v = Math.max(0, Math.min(500, pairs.length || Math.round(Number(e.v) || 0)));
        if (v) { rows.push([req.uid, sid, 'buzz_seen', 'buzz', null, v]); buzz = 1; }
        if (pairs.length && buzzMod) {
          const r = await buzzMod.markSeen(req.uid, pairs).catch(() => null);
          if (r?.repeats) rows.push([req.uid, sid, 'buzz_repeat', 'buzz', null, r.repeats]);
        }
      } else if (type === 'buzz_dwell' || type === 'buzz_skip') {
        const item = String(e.i || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
        // Reading: store how much of the story's expected reading time was spent (100 = read it fully).
        const secs = Math.max(1, Math.min(180, Math.round(Number(e.v) || 0)));
        const expected = Math.max(3, Math.min(120, Math.round(Number(e.e) || 10)));
        const v = type === 'buzz_dwell' ? Math.min(300, Math.round((secs / expected) * 100)) : 1;
        if (item) rows.push([req.uid, sid, type, 'buzz', item, v]);
      } else if (type === 'buzz_open') {
        const item = String(e.i || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
        if (item) { rows.push([req.uid, sid, 'buzz_open', 'buzz', item, 1]); buzz = 1; }
      }
    }
    if (rows.length) await db.q('INSERT INTO analytics_events (user_id, sid, type, screen, item, value) VALUES ?', [rows]);
    await db.q(`INSERT INTO user_days (user_id, day, secs, buzz, buzz_secs, opens) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE secs=secs+VALUES(secs), buzz=GREATEST(buzz, VALUES(buzz)), buzz_secs=buzz_secs+VALUES(buzz_secs), opens=opens+VALUES(opens)`,
    [req.uid, day, secs, buzz, buzzSecs, opens]);
    res.json({ ok: true });
  }));

  // Live: which screen each connected phone is on right now (sent over the socket).
  io.on('connection', (socket) => {
    socket.on('screen', (d) => {
      socket.data.screen = SCREENS.has(d?.s) ? d.s : 'other';
      socket.data.platform = PLATFORMS.has(d?.p) ? d.p : socket.data.platform || 'other';
      socket.data.standalone = !!d?.a;
      socket.data.screenAt = Date.now();
    });
  });

  // ───── admin access ─────
  const KEY = process.env.ADMIN_KEY || '';
  const COOKIE = 'pm_admin';
  const sign = (exp) => crypto.createHmac('sha256', 'admin:' + KEY).update(String(exp)).digest('hex');
  function isAdmin(req) {
    if (!KEY) return false;
    const v = parseCookies(req.headers.cookie)[COOKIE];
    const [mac, exp] = String(v || '').split('.');
    if (!mac || !exp || Number(exp) < Date.now()) return false;
    const want = sign(exp);
    return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
  }
  const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Admin key required' }));

  app.post('/api/admin/login', wrap(async (req, res) => {
    rateLimit('admin-login:' + req.ip, 8, 15 * 60000);
    if (!KEY || KEY.length < 16) throw bad('Admin portal is not set up (ADMIN_KEY missing or shorter than 16 characters)');
    const a = crypto.createHash('sha256').update(String(req.body?.key || '')).digest();
    const b = crypto.createHash('sha256').update(KEY).digest();
    if (!crypto.timingSafeEqual(a, b)) { await new Promise((r) => setTimeout(r, 600)); return res.status(401).json({ error: 'Wrong admin key' }); }
    const exp = Date.now() + 30 * 86400e3;
    res.setHeader('Set-Cookie', `${COOKIE}=${sign(exp)}.${exp}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  }));
  app.post('/api/admin/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0`); res.json({ ok: true }); });
  app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), configured: KEY.length >= 16 }));

  // ───── numbers ─────
  const n = (v) => Number(v || 0);
  const daysAgo = (k) => istDay(Date.now() - k * 86400e3);

  app.get('/api/admin/overview', adminOnly, wrap(async (req, res) => {
    const today = istDay();
    const [users] = await db.q('SELECT COUNT(*) total, SUM(created_at >= ?) d7 FROM users', [new Date(Date.now() - 7 * 86400e3)]);
    const [newToday] = await db.q(`SELECT COUNT(*) c FROM users WHERE ${DAYSQL('created_at')} = ?`, [today]);
    const active = async (from) => n((await db.one('SELECT COUNT(DISTINCT user_id) c FROM user_days WHERE day >= ?', [from]))?.c);
    const [buzzToday] = await db.q('SELECT COUNT(*) c, AVG(buzz_secs) s FROM user_days WHERE day=? AND buzz=1', [today]);
    const [timeToday] = await db.q('SELECT AVG(secs) s FROM user_days WHERE day=? AND secs>0', [today]);
    const [msgs] = await db.q(`SELECT SUM(kind <> 'call' AND kind <> 'system') m, SUM(kind = 'call') c FROM messages WHERE ${DAYSQL('created_at')} = ?`, [today]);
    const devices = await db.q('SELECT platform, standalone, COUNT(*) c FROM user_devices GROUP BY platform, standalone');
    const onlineIds = new Set();
    for (const [, s] of io.sockets.sockets) if (s.uid) onlineIds.add(s.uid);
    res.json({
      totalUsers: n(users.total), newToday: n(newToday.c), new7d: n(users.d7),
      dau: await active(today), wau: await active(daysAgo(6)), mau: await active(daysAgo(29)),
      onlineNow: onlineIds.size,
      avgMinutesToday: Math.round(n(timeToday.s) / 6) / 10,
      buzzUsersToday: n(buzzToday.c), buzzMinutesToday: Math.round(n(buzzToday.s) / 6) / 10,
      messagesToday: n(msgs.m), callsToday: n(msgs.c),
      devices: devices.map((d) => ({ platform: d.platform, installed: !!d.standalone, users: n(d.c) })),
    });
  }));

  app.get('/api/admin/timeseries', adminOnly, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const from = daysAgo(days - 1);
    const map = new Map();
    for (let k = days - 1; k >= 0; k--) map.set(daysAgo(k), { day: daysAgo(k), dau: 0, newUsers: 0, messages: 0, calls: 0, buzzUsers: 0, buzzOpens: 0, avgMinutes: 0 });
    for (const r of await db.q('SELECT DATE_FORMAT(day, \'%Y-%m-%d\') d, COUNT(*) c, SUM(buzz) b, AVG(secs) s FROM user_days WHERE day >= ? GROUP BY day', [from])) {
      const x = map.get(r.d); if (x) { x.dau = n(r.c); x.buzzUsers = n(r.b); x.avgMinutes = Math.round(n(r.s) / 6) / 10; }
    }
    for (const r of await db.q(`SELECT DATE_FORMAT(${DAYSQL('created_at')}, \'%Y-%m-%d\') d, COUNT(*) c FROM users WHERE created_at >= ? GROUP BY d`, [new Date(Date.now() - days * 86400e3)])) {
      const x = map.get(r.d); if (x) x.newUsers = n(r.c);
    }
    for (const r of await db.q(`SELECT DATE_FORMAT(${DAYSQL('created_at')}, \'%Y-%m-%d\') d, SUM(kind <> 'call' AND kind <> 'system') m, SUM(kind = 'call') c FROM messages WHERE created_at >= ? GROUP BY d`, [new Date(Date.now() - days * 86400e3)])) {
      const x = map.get(r.d); if (x) { x.messages = n(r.m); x.calls = n(r.c); }
    }
    for (const r of await db.q(`SELECT DATE_FORMAT(${DAYSQL('created_at')}, \'%Y-%m-%d\') d, COUNT(*) c FROM analytics_events WHERE type='buzz_open' AND created_at >= ? GROUP BY d`, [new Date(Date.now() - days * 86400e3)])) {
      const x = map.get(r.d); if (x) x.buzzOpens = n(r.c);
    }
    res.json({ days: [...map.values()] });
  }));

  // Weekly cohorts: of the people who joined (or first used Buzz) that week, how many came back on
  // day 1, during days 7–13, and during days 30–36.
  app.get('/api/admin/retention', adminOnly, wrap(async (req, res) => {
    const firstApp = await db.q(`SELECT u.id user_id, DATE_FORMAT(${DAYSQL('u.created_at')}, \'%Y-%m-%d\') d0 FROM users u WHERE u.created_at >= ?`, [new Date(Date.now() - 70 * 86400e3)]);
    const firstBuzz = await db.q('SELECT user_id, DATE_FORMAT(MIN(day), \'%Y-%m-%d\') d0 FROM user_days WHERE buzz=1 GROUP BY user_id HAVING MIN(day) >= ?', [daysAgo(70)]);
    const activity = await db.q('SELECT user_id, DATE_FORMAT(day, \'%Y-%m-%d\') d, buzz FROM user_days WHERE day >= ?', [daysAgo(110)]);
    const appDays = new Map(), buzzDays = new Map();
    for (const a of activity) {
      if (!appDays.has(a.user_id)) appDays.set(a.user_id, new Set());
      appDays.get(a.user_id).add(a.d);
      if (a.buzz) { if (!buzzDays.has(a.user_id)) buzzDays.set(a.user_id, new Set()); buzzDays.get(a.user_id).add(a.d); }
    }
    const addDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 86400e3).toISOString().slice(0, 10);
    const today = istDay();
    function cohorts(firsts, daysOf) {
      const weeks = new Map();
      for (const f of firsts) {
        const dt = new Date(f.d0 + 'T00:00:00Z');
        const monday = addDays(f.d0, -((dt.getUTCDay() + 6) % 7));
        if (!weeks.has(monday)) weeks.set(monday, []);
        weeks.get(monday).push(f);
      }
      return [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([week, list]) => {
        const rate = (from, to) => {
          const eligible = list.filter((f) => addDays(f.d0, from) <= today);
          if (!eligible.length) return null;
          const back = eligible.filter((f) => { const ds = daysOf.get(f.user_id); if (!ds) return false; for (let k = from; k <= to; k++) if (ds.has(addDays(f.d0, k))) return true; return false; });
          return Math.round((back.length / eligible.length) * 100);
        };
        return { week, size: list.length, d1: rate(1, 1), d7: rate(7, 13), d30: rate(30, 36) };
      });
    }
    res.json({ app: cohorts(firstApp, appDays), buzz: cohorts(firstBuzz, buzzDays) });
  }));

  app.get('/api/admin/screens', adminOnly, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const rows = await db.q(`SELECT screen, SUM(value) secs, COUNT(DISTINCT user_id) users, COUNT(*) visits FROM analytics_events
      WHERE type='screen' AND created_at >= ? GROUP BY screen ORDER BY secs DESC`, [new Date(Date.now() - days * 86400e3)]);
    res.json({ screens: rows.map((r) => ({ screen: r.screen, minutes: Math.round(n(r.secs) / 6) / 10, users: n(r.users), visits: n(r.visits), avgMinutesPerUser: n(r.users) ? Math.round(n(r.secs) / n(r.users) / 6) / 10 : 0 })) });
  }));

  app.get('/api/admin/buzz', adminOnly, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 86400e3);
    const [ev] = await db.q(`SELECT SUM(type='buzz_seen' ) _x, SUM(CASE WHEN type='buzz_seen' THEN value ELSE 0 END) seen, SUM(type='buzz_open') opens,
      COUNT(DISTINCT CASE WHEN type IN ('buzz_seen','buzz_open') THEN user_id END) users FROM analytics_events WHERE created_at >= ?`, [since]);
    const cnt = async (t) => n((await db.one(`SELECT COUNT(*) c FROM ${t} WHERE created_at >= ?`, [since]))?.c);
    const [likes, comments, reposts] = [await cnt('feed_likes'), await cnt('feed_comments'), await cnt('feed_reposts')];
    const top = await db.q(`SELECT i.id, i.title, i.source_id, i.via, COALESCE(o.c,0) opens, COALESCE(l.c,0) likes, COALESCE(cm.c,0) comments, COALESCE(r.c,0) reposts
      FROM feed_items i
      LEFT JOIN (SELECT item, COUNT(*) c FROM analytics_events WHERE type='buzz_open' AND created_at >= ? GROUP BY item) o ON o.item=i.id
      LEFT JOIN (SELECT item_id, COUNT(*) c FROM feed_likes WHERE created_at >= ? GROUP BY item_id) l ON l.item_id=i.id
      LEFT JOIN (SELECT item_id, COUNT(*) c FROM feed_comments WHERE created_at >= ? GROUP BY item_id) cm ON cm.item_id=i.id
      LEFT JOIN (SELECT item_id, COUNT(*) c FROM feed_reposts WHERE created_at >= ? GROUP BY item_id) r ON r.item_id=i.id
      WHERE COALESCE(o.c,0)+COALESCE(l.c,0)+COALESCE(cm.c,0)+COALESCE(r.c,0) > 0
      ORDER BY COALESCE(o.c,0)*3 + COALESCE(l.c,0) + COALESCE(cm.c,0)*2 + COALESCE(r.c,0)*3 DESC LIMIT 15`, [since, since, since, since]);
    const sources = await db.q(`SELECT i.source_id, COUNT(*) opens FROM analytics_events e JOIN feed_items i ON i.id=e.item
      WHERE e.type='buzz_open' AND e.created_at >= ? GROUP BY i.source_id ORDER BY opens DESC LIMIT 12`, [since]);
    // Which city people chose (from settings).
    const regions = {};
    const ids = await db.q('SELECT DISTINCT user_id FROM user_days WHERE buzz=1 AND day >= ?', [daysAgo(days - 1)]);
    for (const r of ids.slice(0, 3000)) { const u = await getUser(Number(r.user_id)); const k = u?.settings?.buzzRegion || 'india'; regions[k] = (regions[k] || 0) + 1; }
    const seen = n(ev.seen), opens = n(ev.opens);
    const [ai] = await db.q('SELECT COUNT(*) n, SUM(ai_summary IS NOT NULL) done FROM feed_items WHERE fetched_at >= ?', [new Date(Date.now() - 2 * 86400e3)]);
    const [opt] = await db.q('SELECT COUNT(*) n FROM user_interests');
    res.json({ ai: { ...AI.status(), summarised48h: n(ai.done), stories48h: n(ai.n) }, chatPersonalisedUsers: n(opt.n), users: n(ev.users), seen, opens, ctr: seen ? Math.round((opens / seen) * 1000) / 10 : 0, likes, comments, reposts,
      top: top.map((t) => ({ title: t.title, source: t.via || srcName(t.source_id), opens: n(t.opens), likes: n(t.likes), comments: n(t.comments), reposts: n(t.reposts) })),
      sources: sources.map((s) => ({ source: srcName(s.source_id), opens: n(s.opens) })), regions });
  }));

  // ───── suggestion algorithm performance ─────
  // Every story a person really saw (feed_seen) is matched with what they did with it. "Engaged" =
  // opened it, liked / commented / reposted, or spent at least 60% of its reading time on it. Each
  // impression is credited to the slot that chose it, so personal picks can be compared with trending
  // ones (the lift), and impressions are ordered per person so we can see if suggestions get better
  // the longer someone uses Buzz (the learning curve).
  const SLOT_NAMES = { p: 'For you (personal)', m: 'Section mix', t: 'Trending', x: 'Explore', r: 'More like this', g: 'New reader (no profile yet)' };
  app.get('/api/admin/algo', adminOnly, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400e3);
    const imps = await db.q('SELECT user_id, item_id, slot, topic, seq, seen_at FROM feed_seen WHERE seen_at >= ? ORDER BY seen_at LIMIT 300000', [since]);
    const act = new Map(); // uid:item → { o, d, s, l, c, r }
    const get = (u, i) => { const k = u + ':' + i; let a = act.get(k); if (!a) act.set(k, (a = { o: 0, d: 0, s: 0, l: 0, c: 0, r: 0 })); return a; };
    for (const r of await db.q(`SELECT user_id, item, type, SUM(value) v FROM analytics_events WHERE created_at >= ? AND type IN ('buzz_open','buzz_dwell','buzz_skip') GROUP BY user_id, item, type`, [since])) {
      const a = get(r.user_id, r.item);
      if (r.type === 'buzz_open') a.o = 1; else if (r.type === 'buzz_dwell') a.d = n(r.v); else a.s = 1;
    }
    for (const [t, k] of [['feed_likes', 'l'], ['feed_comments', 'c'], ['feed_reposts', 'r']]) for (const r of await db.q(`SELECT DISTINCT user_id, item_id FROM ${t} WHERE created_at >= ?`, [since])) get(r.user_id, r.item_id)[k] = 1;
    const empty = () => ({ imp: 0, eng: 0, open: 0, skip: 0, like: 0, readN: 0, readSum: 0 });
    const add = (b, a) => {
      b.imp++;
      if (!a) return;
      const engaged = a.o || a.l || a.c || a.r || a.d >= 60;
      if (engaged) b.eng++;
      if (a.o) b.open++;
      if (a.l) b.like++;
      if (a.s && !engaged) b.skip++;
      if (a.d) { b.readN++; b.readSum += Math.min(150, a.d); }
    };
    const pct = (k, nn) => (nn ? Math.round((k / nn) * 1000) / 10 : null);
    const view = (b) => ({ impressions: b.imp, engagedRate: pct(b.eng, b.imp), openRate: pct(b.open, b.imp), skipRate: pct(b.skip, b.imp), likeRate: pct(b.like, b.imp), avgRead: b.readN ? Math.round(b.readSum / b.readN) : null });
    const all = empty(), slots = {}, daily = new Map(), topics = {}, users = new Map();
    const CURVE = [[1, 25, 'First 25 stories'], [26, 100, '26 – 100'], [101, 300, '101 – 300'], [301, 1000, '301 – 1,000'], [1001, 1e12, '1,000+']];
    const curve = CURVE.map(() => ({ ...empty(), users: new Set() }));
    for (let k = days - 1; k >= 0; k--) daily.set(daysAgo(k), { all: empty(), p: empty(), t: empty() });
    for (const s0 of imps) {
      const a = act.get(s0.user_id + ':' + s0.item_id);
      add(all, a);
      add((slots[s0.slot] ||= empty()), a);
      const d = daily.get(istDay(new Date(s0.seen_at).getTime()));
      if (d) { add(d.all, a); if (s0.slot === 'p') add(d.p, a); if (s0.slot === 't' || s0.slot === 'g') add(d.t, a); }
      add((topics[s0.topic || 'other'] ||= empty()), a);
      const ci = CURVE.findIndex(([lo, hi]) => s0.seq >= lo && s0.seq <= hi);
      if (ci >= 0) { add(curve[ci], a); curve[ci].users.add(s0.user_id); }
      let u = users.get(s0.user_id);
      if (!u) users.set(s0.user_id, (u = { all: empty(), list: [], topics: {} }));
      add(u.all, a);
      u.list.push(a ? (a.o || a.l || a.c || a.r || a.d >= 60 ? 1 : 0) : 0);
      if (a && (a.o || a.l || a.c || a.r || a.d >= 60)) u.topics[s0.topic] = (u.topics[s0.topic] || 0) + 1;
    }
    const pRate = pct(slots.p?.eng || 0, slots.p?.imp || 0), tRate = pct((slots.t?.eng || 0) + (slots.g?.eng || 0), (slots.t?.imp || 0) + (slots.g?.imp || 0));
    // Lift with light smoothing so a small sample (or zero trending engagement) still gives a fair number.
    const pe = slots.p?.eng || 0, pi = slots.p?.imp || 0, te = (slots.t?.eng || 0) + (slots.g?.eng || 0), ti = (slots.t?.imp || 0) + (slots.g?.imp || 0);
    const lift = pi >= 10 && ti >= 10 ? Math.round((((pe + 1) / (pi + 4)) / ((te + 1) / (ti + 4))) * 100) / 100 : null;
    const [rep] = await db.q('SELECT COALESCE(SUM(value),0) r FROM analytics_events WHERE type=\'buzz_repeat\' AND created_at >= ?', [since]);
    const [opt] = await db.q('SELECT COUNT(*) c FROM user_interests');
    const curveOut = curve.map((b, i) => ({ bucket: CURVE[i][2], users: b.users.size, ...view(b) })).filter((b) => b.impressions);
    // Per person: first 50 stories they saw vs their latest 50 — is it getting better for them?
    const rate = (arr) => (arr.length ? Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 1000) / 10 : null);
    const userRows = [];
    for (const [uid, u] of [...users.entries()].sort((a, b) => b[1].all.imp - a[1].all.imp).slice(0, 60)) {
      const pu = await publicUser(Number(uid));
      const early = u.list.length >= 60 ? rate(u.list.slice(0, 50)) : null, recent = u.list.length >= 60 ? rate(u.list.slice(-50)) : null;
      userRows.push({ name: pu.name, username: pu.username, ...view(u.all), early, recent, change: early != null ? Math.round((recent - early) * 10) / 10 : null,
        loves: Object.entries(u.topics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t) });
    }
    const totalImp = all.imp || 1, totalEng = all.eng || 1;
    // Plain-language verdict for the owner.
    const notes = [];
    if (lift != null) notes.push(lift >= 1.1 ? `Personal picks get engagement ${lift}× as often as trending stories — the algorithm is learning what people like.` : lift >= 0.9 ? `Personal picks perform about the same as trending (${lift}×) — it needs more signals (likes, reading) to pull ahead.` : `Personal picks are doing worse than trending (${lift}×) — tastes may have shifted; explore slots will help it relearn.`);
    if (curveOut.length >= 2) { const f = curveOut[0], l = curveOut[curveOut.length - 1]; if (f.engagedRate != null && l.engagedRate != null) notes.push(l.engagedRate > f.engagedRate ? `Suggestions improve with use: ${f.engagedRate}% engaged in someone's first stories → ${l.engagedRate}% after ${l.bucket.toLowerCase()} stories.` : `Engagement doesn't rise with use yet (${f.engagedRate}% → ${l.engagedRate}%).`); }
    if (slots.r?.imp) notes.push(`"More like this" stories: ${pct(slots.r.eng, slots.r.imp)}% engaged.`);
    if (slots.x?.imp) { const xr = pct(slots.x.eng, slots.x.imp); notes.push(`Explore picks: ${xr}% engaged — ${xr > 0 && xr >= (tRate || 0) ? 'people are discovering new interests' : 'mostly ignored so far, which is normal for discovery'}.`); }
    if (lift == null && pi + ti > 0) notes.unshift(`Still collecting data: ${pi} personal and ${ti} trending stories seen so far (needs 10+ of each to compare).`);
    notes.push(n(rep.r) ? `${n(rep.r)} stories were shown again to someone who had already seen them (${pct(n(rep.r), all.imp + n(rep.r))}%).` : 'No story was shown twice to the same person.');
    res.json({
      summary: { ...view(all), users: users.size, personalRate: pRate, trendingRate: tRate, lift, repeats: n(rep.r), repeatRate: pct(n(rep.r), all.imp + n(rep.r)), chatOptIn: n(opt.c) },
      notes,
      slots: Object.entries(slots).map(([k, b]) => ({ slot: k, name: SLOT_NAMES[k] || k, share: pct(b.imp, totalImp), ...view(b) })).sort((a, b) => b.impressions - a.impressions),
      daily: [...daily.entries()].map(([day, d]) => ({ day, overall: pct(d.all.eng, d.all.imp) || 0, personal: pct(d.p.eng, d.p.imp) || 0, trending: pct(d.t.eng, d.t.imp) || 0, skip: pct(d.all.skip, d.all.imp) || 0, impressions: d.all.imp })),
      curve: curveOut,
      topics: Object.entries(topics).map(([t, b]) => ({ topic: t, share: pct(b.imp, totalImp), engagedShare: pct(b.eng, totalEng), ...view(b) })).sort((a, b) => b.impressions - a.impressions),
      users: userRows,
    });
  }));

  app.get('/api/admin/live', adminOnly, wrap(async (req, res) => {
    const byUser = new Map();
    for (const [, s] of io.sockets.sockets) {
      if (!s.uid) continue;
      const prev = byUser.get(s.uid);
      if (!prev || (s.data.screenAt || 0) > (prev.screenAt || 0)) byUser.set(s.uid, { userId: s.uid, screen: s.data.screen || 'chats', platform: s.data.platform || 'other', installed: !!s.data.standalone, screenAt: s.data.screenAt || null });
    }
    const list = [];
    for (const x of byUser.values()) { const u = await publicUser(x.userId); list.push({ ...x, name: u.name, username: u.username }); }
    list.sort((a, b) => (b.screenAt || 0) - (a.screenAt || 0));
    const screens = {};
    for (const x of list) screens[x.screen] = (screens[x.screen] || 0) + 1;
    res.json({ online: list, screens });
  }));

  app.get('/api/admin/users', adminOnly, wrap(async (req, res) => {
    const rows = await db.q(`SELECT u.id, u.created_at, d.days30, d.last_day, d.secs7, d.buzz_days, dv.platform, dv.standalone
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) days30, MAX(day) last_day, SUM(CASE WHEN day >= ? THEN secs ELSE 0 END) secs7, SUM(buzz) buzz_days FROM user_days WHERE day >= ? GROUP BY user_id) d ON d.user_id=u.id
      LEFT JOIN user_devices dv ON dv.user_id=u.id
      ORDER BY COALESCE(d.last_day, '1970-01-01') DESC, u.created_at DESC LIMIT 150`, [daysAgo(6), daysAgo(29)]);
    const msgs = await db.q('SELECT sender_id, COUNT(*) c FROM messages WHERE created_at >= ? AND kind NOT IN (\'system\',\'call\') GROUP BY sender_id', [new Date(Date.now() - 7 * 86400e3)]);
    const m = new Map(msgs.map((r) => [Number(r.sender_id), n(r.c)]));
    const out = [];
    for (const r of rows) {
      const u = await publicUser(Number(r.id));
      out.push({ id: Number(r.id), name: u.name, username: u.username, joined: r.created_at, lastActive: r.last_day ? String(r.last_day instanceof Date ? r.last_day.toISOString().slice(0, 10) : r.last_day) : null,
        activeDays30: n(r.days30), minutes7d: Math.round(n(r.secs7) / 6) / 10, buzzDays30: n(r.buzz_days), messages7d: m.get(Number(r.id)) || 0,
        platform: r.platform || '—', installed: !!r.standalone, online: online.has(Number(r.id)) });
    }
    res.json({ users: out });
  }));

  // Keep raw events for 120 days (the daily summaries stay).
  setInterval(() => {
    db.q('DELETE FROM analytics_events WHERE created_at < ?', [new Date(Date.now() - 120 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM feed_seen WHERE seen_at < ?', [new Date(Date.now() - 120 * 86400e3)]).catch(() => {});
  }, 6 * 3600e3).unref();

  return { isAdmin };
};
