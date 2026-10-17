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

module.exports = function admin({ app, io, db, C, auth, wrap, bad, rateLimit, publicUser, getUser, parseCookies, online, buzz, monitor, activeCalls }) {
  const buzzMod = buzz;
  // ───── collection ─────
  app.post('/api/t', auth, wrap(async (req, res) => {
    rateLimit('t:' + req.uid, 120, 60000);
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 60) : [];
    const sid = String(req.body?.sid || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || null;
    const day = istDay();
    let secs = 0, buzzSecs = 0, buzz = 0, opens = 0;
    const rows = [], perf = [];
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
      } else if (type === 'perf_boot' || type === 'perf_api' || type === 'perf_send') {
        // Speed measured on the phone: app start, slow requests (address shape only), message send time.
        const v = Math.max(0, Math.min(120000, Math.round(Number(e.v) || 0)));
        if (v) perf.push([req.uid, type.slice(5), type === 'perf_api' ? String(e.p || '').replace(/[^\w\s/:.-]/g, '').slice(0, 80) : null, v]);
      } else if (type === 'buzz_play' || type === 'buzz_autoplay') {
        // Video watched: seconds (with sound = tapped to watch; autoplay = muted while scrolling).
        const item = String(e.i || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
        const v = Math.max(1, Math.min(1800, Math.round(Number(e.v) || 0)));
        if (item) { rows.push([req.uid, sid, type, 'buzz', item, v]); buzz = 1; }
      } else if (type === 'buzz_open') {
        const item = String(e.i || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
        if (item) { rows.push([req.uid, sid, 'buzz_open', 'buzz', item, 1]); buzz = 1; }
      }
    }
    if (rows.length) await db.q('INSERT INTO analytics_events (user_id, sid, type, screen, item, value) VALUES ?', [rows]);
    if (perf.length) {
      const pl = (await db.one('SELECT platform FROM user_devices WHERE user_id=?', [req.uid]).catch(() => null))?.platform || 'other';
      await db.q('INSERT INTO client_perf (user_id, kind, path, ms, platform) VALUES ?', [perf.map((p) => [...p, pl])]).catch(() => {});
    }
    await db.q(`INSERT INTO user_days (user_id, day, secs, buzz, buzz_secs, opens) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE secs=secs+VALUES(secs), buzz=GREATEST(buzz, VALUES(buzz)), buzz_secs=buzz_secs+VALUES(buzz_secs), opens=opens+VALUES(opens)`,
    [req.uid, day, secs, buzz, buzzSecs, opens]);
    res.json({ ok: true });
  }));

  // App crash reports from phones (what broke and where — never message text).
  app.post('/api/client-error', auth, wrap(async (req, res) => {
    rateLimit('cerr:' + req.uid, 30, 3600e3);
    const b = req.body || {};
    const str = (v, n) => String(v || '').slice(0, n);
    await db.q('INSERT INTO client_errors (user_id, where_at, msg, stack, screen, platform, ua) VALUES (?,?,?,?,?,?,?)',
      [req.uid, str(b.where, 60) || 'unknown', str(b.msg, 300) || 'error', str(b.stack, 1500) || null, SCREENS.has(b.screen) ? b.screen : 'other', PLATFORMS.has(b.platform) ? b.platform : 'other', str(req.headers['user-agent'], 300)]);
    console.warn('client error', b.where, str(b.msg, 200));
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
  const ms0 = (d) => (d ? new Date(d).getTime() : null);
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

  app.get('/api/admin/errors', adminOnly, wrap(async (req, res) => {
    const rows = await db.q(`SELECT where_at, msg, MAX(stack) stack, COUNT(*) n, COUNT(DISTINCT user_id) users, MAX(created_at) last, GROUP_CONCAT(DISTINCT platform) platforms
      FROM client_errors WHERE created_at >= ? GROUP BY where_at, msg ORDER BY last DESC LIMIT 40`, [new Date(Date.now() - 14 * 86400e3)]);
    res.json({ errors: rows.map((r) => ({ where: r.where_at, msg: r.msg, stack: r.stack, count: n(r.n), users: n(r.users), last: ms0(r.last), platforms: r.platforms })) });
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
    const rows = await db.q(`SELECT u.id, u.created_at, u.name_enc, u.uname_enc, d.days30, d.last_day, d.secs7, d.buzz_days, dv.platform, dv.standalone
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) days30, MAX(day) last_day, SUM(CASE WHEN day >= ? THEN secs ELSE 0 END) secs7, SUM(buzz) buzz_days FROM user_days WHERE day >= ? GROUP BY user_id) d ON d.user_id=u.id
      LEFT JOIN user_devices dv ON dv.user_id=u.id
      ORDER BY COALESCE(d.last_day, '1970-01-01') DESC, u.created_at DESC LIMIT 150`, [daysAgo(6), daysAgo(29)]);
    const msgs = await db.q('SELECT sender_id, COUNT(*) c FROM messages WHERE created_at >= ? AND kind NOT IN (\'system\',\'call\') GROUP BY sender_id', [new Date(Date.now() - 7 * 86400e3)]);
    const m = new Map(msgs.map((r) => [Number(r.sender_id), n(r.c)]));
    const out = [];
    for (const r of rows) {
      const u = { name: C.dec(r.name_enc) || 'User', username: C.dec(r.uname_enc) };
      out.push({ id: Number(r.id), name: u.name, username: u.username, joined: r.created_at, lastActive: r.last_day ? String(r.last_day instanceof Date ? r.last_day.toISOString().slice(0, 10) : r.last_day) : null,
        activeDays30: n(r.days30), minutes7d: Math.round(n(r.secs7) / 6) / 10, buzzDays30: n(r.buzz_days), messages7d: m.get(Number(r.id)) || 0,
        platform: r.platform || '—', installed: !!r.standalone, online: online.has(Number(r.id)) });
    }
    res.json({ users: out });
  }));

  // ═════════ Speed, errors, users, calls, activity (multi-page admin) ═════════
  const pctl = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
  const device = (ua = '') => {
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
    const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? `${os} · ${br}` : os;
  };
  const dayKey = (d) => istDay(new Date(d).getTime());

  // Speed: where the app is slow — server routes, database, realtime, server health, and phones.
  app.get('/api/admin/perf', adminOnly, wrap(async (req, res) => {
    const snap = monitor.snapshot();
    const since7 = new Date(Date.now() - 7 * 86400e3);
    const hours = await db.q('SELECT hour, SUM(n) n, SUM(errors) errors, MAX(p95) p95, SUM(total_ms) total FROM perf_hourly WHERE hour >= ? GROUP BY hour ORDER BY hour', [since7]);
    const hist = await db.q('SELECT route, SUM(n) n, SUM(errors) errors, MAX(p95) p95, MAX(mx) mx, SUM(total_ms) total FROM perf_hourly WHERE hour >= ? GROUP BY route ORDER BY SUM(total_ms) DESC LIMIT 40', [since7]);
    const cp = await db.q('SELECT kind, path, ms, platform FROM client_perf WHERE created_at >= ? ORDER BY id DESC LIMIT 20000', [since7]);
    const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r.ms); } return m; };
    const summarize = (m) => [...m].map(([k, v]) => ({ key: k, n: v.length, p50: pctl(v, 50), p95: pctl(v, 95), max: Math.max(...v) })).sort((a, b) => b.p95 - a.p95);
    const boot = summarize(group(cp.filter((r) => r.kind === 'boot'), (r) => r.platform));
    const send = summarize(group(cp.filter((r) => r.kind === 'send'), (r) => r.platform));
    const slowApi = summarize(group(cp.filter((r) => r.kind === 'api'), (r) => r.path)).sort((a, b) => b.n - a.n).slice(0, 25);
    // Plain-language hotspots, worst first.
    const hot = [];
    for (const r of snap.routes.filter((x) => x.n >= 5 && x.p95 > 800).slice(0, 5)) hot.push({ level: r.p95 > 2000 ? 'bad' : 'warn', text: `Server: ${r.route} is slow — 95% of requests finish within ${r.p95} ms (avg ${r.avg} ms, ${r.n} requests)` });
    for (const r of snap.routes.filter((x) => x.errors > 0).slice(0, 5)) hot.push({ level: 'bad', text: `Server: ${r.route} failed ${r.errors} of ${r.n} times` });
    for (const q of snap.slowQueries.slice(0, 3)) hot.push({ level: q.ms > 1000 ? 'bad' : 'warn', text: `Database: a query took ${q.ms} ms — ${q.sql.slice(0, 90)}` });
    if (snap.loopLagMs.p99 > 100) hot.push({ level: snap.loopLagMs.p99 > 300 ? 'bad' : 'warn', text: `Server is busy: event-loop delay ${snap.loopLagMs.p99} ms (p99) — everything waits this long` });
    for (const b of boot.filter((x) => x.p50 > 3000)) hot.push({ level: b.p50 > 6000 ? 'bad' : 'warn', text: `Phones: the app takes ${(b.p50 / 1000).toFixed(1)} s to open on ${b.key} (typical), ${(b.p95 / 1000).toFixed(1)} s for the slowest 5%` });
    for (const s of send.filter((x) => x.p95 > 1500)) hot.push({ level: 'warn', text: `Phones: sending a message takes up to ${(s.p95 / 1000).toFixed(1)} s on ${s.key} (95th percentile)` });
    for (const a of slowApi.slice(0, 3)) if (a.n >= 3) hot.push({ level: a.p50 > 2000 ? 'bad' : 'warn', text: `Phones: ${a.key} felt slow ${a.n} times (typical ${a.p50} ms)` });
    if (snap.memMb.rss > 900) hot.push({ level: 'warn', text: `Server memory is high: ${snap.memMb.rss} MB` });
    res.json({
      server: { ...snap, sockets: io.engine.clientsCount, onlineUsers: online.size, activeCalls: activeCalls() },
      hours: hours.map((h) => ({ t: ms0(h.hour), n: n(h.n), errors: n(h.errors), p95: n(h.p95), avg: n(h.n) ? Math.round(n(h.total) / n(h.n)) : 0 })),
      history: hist.map((h) => ({ route: h.route, n: n(h.n), errors: n(h.errors), p95: n(h.p95), max: n(h.mx), avg: n(h.n) ? Math.round(n(h.total) / n(h.n)) : 0 })),
      phones: { boot, send, slowApi, samples: cp.length },
      hotspots: hot,
    });
  }));

  // Errors: crashes on phones + errors on the server.
  app.get('/api/admin/errors-all', adminOnly, wrap(async (req, res) => {
    const since = new Date(Date.now() - 14 * 86400e3);
    const client = await db.q(`SELECT where_at, msg, MAX(stack) stack, COUNT(*) n, COUNT(DISTINCT user_id) users, MAX(created_at) last, GROUP_CONCAT(DISTINCT platform) platforms
      FROM client_errors WHERE created_at >= ? GROUP BY where_at, msg ORDER BY last DESC LIMIT 80`, [since]);
    const server = await db.q(`SELECT where_at, msg, MAX(stack) stack, COUNT(*) n, COUNT(DISTINCT user_id) users, MAX(created_at) last
      FROM server_errors WHERE created_at >= ? GROUP BY where_at, msg ORDER BY last DESC LIMIT 80`, [since]);
    const daily = await db.q(`SELECT ${DAYSQL('created_at')} d, COUNT(*) c, 'phone' src FROM client_errors WHERE created_at >= ? GROUP BY d
      UNION ALL SELECT ${DAYSQL('created_at')} d, COUNT(*) c, 'server' src FROM server_errors WHERE created_at >= ? GROUP BY d`, [since, since]);
    const map = (r) => ({ where: r.where_at, msg: r.msg, stack: r.stack, count: n(r.n), users: n(r.users), last: ms0(r.last), platforms: r.platforms || null });
    res.json({ client: client.map(map), server: server.map(map), daily: daily.map((d) => ({ day: d.d instanceof Date ? d.d.toISOString().slice(0, 10) : String(d.d), count: n(d.c), src: d.src })) });
  }));

  // Users: everyone, searchable.
  app.get('/api/admin/users-all', adminOnly, wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
    // One query for everyone (names decrypted here) — looking people up one by one took seconds.
    const rows = await db.q(`SELECT u.id, u.created_at, u.last_seen, u.avatar_v, u.name_enc, u.uname_enc, u.settings_enc, dv.platform, dv.standalone, d.days30, d.secs7
      FROM users u LEFT JOIN user_devices dv ON dv.user_id=u.id
      LEFT JOIN (SELECT user_id, COUNT(*) days30, SUM(CASE WHEN day >= ? THEN secs ELSE 0 END) secs7 FROM user_days WHERE day >= ? GROUP BY user_id) d ON d.user_id=u.id
      ORDER BY COALESCE(u.last_seen, u.created_at) DESC LIMIT 1000`, [daysAgo(6), daysAgo(29)]);
    const msgs = new Map((await db.q("SELECT sender_id, COUNT(*) c, SUM(created_at >= ?) c7 FROM messages WHERE kind NOT IN ('system','call') GROUP BY sender_id", [new Date(Date.now() - 7 * 86400e3)])).map((r) => [Number(r.sender_id), [n(r.c), n(r.c7)]]));
    const views = new Map((await db.q('SELECT owner_id, COUNT(*) c FROM avatar_views WHERE viewed_at >= ? GROUP BY owner_id', [new Date(Date.now() - 90 * 86400e3)])).map((r) => [Number(r.owner_id), n(r.c)]));
    const out = [];
    for (const r of rows) {
      const u = { id: Number(r.id), name: C.dec(r.name_enc) || 'User', username: C.dec(r.uname_enc), settings: { guest: !!C.decJson(r.settings_enc, {})?.guest } };
      if (q && !(`${u.name} ${u.username}`.toLowerCase().includes(q))) continue;
      const m = msgs.get(Number(r.id)) || [0, 0];
      out.push({ id: u.id, name: u.name, username: u.username, guest: u.settings.guest, joined: ms0(r.created_at), lastSeen: ms0(r.last_seen), online: online.has(u.id),
        photo: n(r.avatar_v) > 0, photoAt: n(r.avatar_v) || null, photoViews: views.get(u.id) || 0, messages: m[0], messages7d: m[1],
        activeDays30: n(r.days30), minutes7d: Math.round(n(r.secs7) / 6) / 10, platform: r.platform || null, installed: !!r.standalone });
    }
    res.json({ users: out, total: rows.length });
  }));

  app.get('/api/admin/avatar/:id', adminOnly, wrap(async (req, res) => {
    const r = await db.one('SELECT avatar_enc FROM users WHERE id=?', [Number(req.params.id) || 0]);
    const data = r?.avatar_enc && C.dec(r.avatar_enc);
    const m = data && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(data);
    if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.from(m[2], 'base64'));
  }));

  // One person: everything they did (metadata only — never message text or call content).
  app.get('/api/admin/user/:id', adminOnly, wrap(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const u = await getUser(id);
    const row = await db.one('SELECT created_at, last_seen, avatar_v, email_enc FROM users WHERE id=?', [id]);
    if (!u || !row) return res.status(404).json({ error: 'No such user' });
    const since30 = new Date(Date.now() - 30 * 86400e3), since90 = new Date(Date.now() - 90 * 86400e3);
    const email = row.email_enc ? C.dec(row.email_enc) : null;
    const sessions = (await db.q('SELECT ua_enc, created_at, last_used FROM sessions WHERE user_id=? ORDER BY last_used DESC LIMIT 20', [id])).map((s) => ({ device: device(C.dec(s.ua_enc) || ''), signedIn: ms0(s.created_at), lastUsed: ms0(s.last_used) }));
    const dev = await db.one('SELECT platform, standalone, updated_at FROM user_devices WHERE user_id=?', [id]);
    const perDay = await db.q(`SELECT ${DAYSQL('created_at')} d, COUNT(*) c FROM messages WHERE sender_id=? AND created_at >= ? AND kind NOT IN ('system','call') GROUP BY d ORDER BY d`, [id, since30]);
    const kinds = await db.q("SELECT kind, COUNT(*) c FROM messages WHERE sender_id=? AND kind NOT IN ('system') GROUP BY kind", [id]);
    const chats = await db.q(`SELECT c.id, c.type, c.title_enc, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.sender_id=? AND m.kind NOT IN ('system','call')) mine, (SELECT MAX(created_at) FROM messages m WHERE m.chat_id=c.id) last
      FROM chat_members cm JOIN chats c ON c.id=cm.chat_id WHERE cm.user_id=? AND cm.active=1 ORDER BY last DESC LIMIT 30`, [id, id]);
    const chatList = [];
    for (const c of chats) {
      let title = c.type === 'group' ? C.dec(c.title_enc) || 'Group' : null;
      if (!title) { const o = await db.one('SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>? LIMIT 1', [c.id, id]); title = o ? (await publicUser(Number(o.user_id))).name : 'Chat'; }
      chatList.push({ id: Number(c.id), type: c.type, title, mine: n(c.mine), last: ms0(c.last) });
    }
    const callRows = await db.q("SELECT body_enc, sender_id, created_at FROM messages WHERE kind='call' AND created_at >= ? AND chat_id IN (SELECT chat_id FROM chat_members WHERE user_id=?) ORDER BY id DESC LIMIT 300", [since90, id]);
    const calls = { total: 0, answered: 0, missed: 0, minutes: 0, video: 0, made: 0, recent: [] };
    for (const r of callRows) {
      const c = C.decJson(r.body_enc, {})?.call; if (!c) continue;
      const joined = (c.joined || []).includes(id), caller = Number(r.sender_id) === id;
      if (!joined && !caller && !c.missed) continue;
      calls.total++; if (caller) calls.made++; if (c.video) calls.video++;
      if (c.missed) calls.missed++; else { calls.answered++; calls.minutes += (c.dur || 0) / 60; }
      if (calls.recent.length < 15) calls.recent.push({ at: ms0(r.created_at), video: !!c.video, dur: c.dur || 0, missed: !!c.missed, caller });
    }
    calls.minutes = Math.round(calls.minutes);
    const screens = await db.q("SELECT screen, SUM(value) secs FROM analytics_events WHERE user_id=? AND type='screen' AND created_at >= ? GROUP BY screen ORDER BY secs DESC", [id, since30]);
    const bz = await db.one(`SELECT SUM(CASE WHEN type='buzz_seen' THEN value ELSE 0 END) seen, SUM(type='buzz_open') opens, SUM(type='buzz_play') plays,
      SUM(CASE WHEN type IN ('buzz_play','buzz_autoplay') THEN value ELSE 0 END) watch FROM analytics_events WHERE user_id=? AND created_at >= ?`, [id, since30]);
    const topics = await db.q("SELECT i.topic, COUNT(*) c FROM analytics_events e JOIN feed_items i ON i.id=e.item WHERE e.user_id=? AND e.type IN ('buzz_open','buzz_play') AND e.created_at >= ? GROUP BY i.topic ORDER BY c DESC LIMIT 6", [id, since30]);
    const [likes, comments, reposts] = await Promise.all(['feed_likes', 'feed_comments', 'feed_reposts'].map((t) => db.one(`SELECT COUNT(*) c FROM ${t} WHERE user_id=?`, [id])));
    const viewsIn = await db.one('SELECT COUNT(*) c, COUNT(DISTINCT viewer_id) p FROM avatar_views WHERE owner_id=? AND viewed_at >= ?', [id, since90]);
    const viewsOut = await db.one('SELECT COUNT(*) c FROM avatar_views WHERE viewer_id=? AND viewed_at >= ?', [id, since90]);
    const errors = await db.q('SELECT where_at, msg, created_at FROM client_errors WHERE user_id=? ORDER BY id DESC LIMIT 20', [id]);
    const perf = await db.q('SELECT kind, ms FROM client_perf WHERE user_id=? AND created_at >= ?', [id, since30]);
    // Timeline: activity log + app opens, newest first.
    const acts = (await db.q('SELECT kind, meta_enc, created_at FROM activity_log WHERE user_id=? ORDER BY id DESC LIMIT 200', [id])).map((a) => ({ at: ms0(a.created_at), kind: a.kind, meta: a.meta_enc ? C.decJson(a.meta_enc, {}) : {} }));
    const opens = (await db.q("SELECT created_at, screen FROM analytics_events WHERE user_id=? AND type='session' ORDER BY id DESC LIMIT 60", [id])).map((o) => ({ at: ms0(o.created_at), kind: 'open', meta: {} }));
    const timeline = [...acts, ...opens].sort((a, b) => b.at - a.at).slice(0, 250);
    for (const t of timeline) if (t.meta?.user) t.meta.userName = (await publicUser(Number(t.meta.user))).name;
    res.json({
      user: { id, name: u.name, username: u.username, bio: u.bio, guest: u.settings.guest, email: email ? email.replace(/^(.).*(@.*)$/, '$1•••$2') : null, joined: ms0(row.created_at), lastSeen: ms0(row.last_seen), online: online.has(id),
        photo: n(row.avatar_v) > 0, photoAt: n(row.avatar_v) || null, privacy: Object.fromEntries(['readReceipts', 'typing', 'lastSeen', 'previews', 'dpViews', 'buzzFromChats'].map((k) => [k, u.settings[k] !== false && (k !== 'buzzFromChats' || !!u.settings[k])])) },
      device: dev ? { platform: dev.platform, installed: !!dev.standalone, updated: ms0(dev.updated_at) } : null, sessions,
      messages: { total: kinds.reduce((a, k) => a + (k.kind === 'call' ? 0 : n(k.c)), 0), kinds: Object.fromEntries(kinds.map((k) => [k.kind, n(k.c)])), perDay: perDay.map((d) => ({ day: d.d instanceof Date ? d.d.toISOString().slice(0, 10) : String(d.d), count: n(d.c) })), chats: chatList },
      calls, screens: screens.map((s) => ({ screen: s.screen, minutes: Math.round(n(s.secs) / 6) / 10 })),
      buzz: { seen: n(bz?.seen), opens: n(bz?.opens), plays: n(bz?.plays), watchMinutes: Math.round(n(bz?.watch) / 6) / 10, likes: n(likes?.c), comments: n(comments?.c), reposts: n(reposts?.c), topics: topics.map((t) => ({ topic: t.topic, n: n(t.c) })) },
      photoViews: { received: n(viewsIn?.c), people: n(viewsIn?.p), made: n(viewsOut?.c) },
      errors: errors.map((e) => ({ where: e.where_at, msg: e.msg, at: ms0(e.created_at) })),
      speed: { bootP50: pctl(perf.filter((p) => p.kind === 'boot').map((p) => p.ms), 50), sendP50: pctl(perf.filter((p) => p.kind === 'send').map((p) => p.ms), 50), slowRequests: perf.filter((p) => p.kind === 'api').length },
      timeline,
    });
  }));

  // Calls: how many, how long, answered vs missed, recent calls.
  app.get('/api/admin/calls', adminOnly, wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400e3);
    const rows = await db.q("SELECT m.id, m.chat_id, m.sender_id, m.body_enc, m.created_at, c.type FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.kind='call' AND m.created_at >= ? ORDER BY m.id DESC LIMIT 5000", [since]);
    const byDay = {}, sum = { total: 0, answered: 0, missed: 0, video: 0, group: 0, minutes: 0, durs: [] }, reasons = {};
    const recent = [];
    for (const r of rows) {
      const c = C.decJson(r.body_enc, {})?.call; if (!c) continue;
      const d = dayKey(r.created_at);
      byDay[d] ||= { day: d, calls: 0, answered: 0, missed: 0, minutes: 0 };
      byDay[d].calls++; sum.total++;
      if (c.video) sum.video++; if (r.type === 'group') sum.group++;
      if (c.missed) { byDay[d].missed++; sum.missed++; } else { byDay[d].answered++; sum.answered++; byDay[d].minutes += (c.dur || 0) / 60; sum.minutes += (c.dur || 0) / 60; sum.durs.push(c.dur || 0); }
      reasons[c.reason || 'ended'] = (reasons[c.reason || 'ended'] || 0) + 1;
      if (recent.length < 60) {
        const caller = await publicUser(Number(r.sender_id));
        const others = (c.joined || []).filter((x) => x !== Number(r.sender_id));
        recent.push({ at: ms0(r.created_at), caller: caller.name, callerId: Number(r.sender_id), with: await Promise.all(others.slice(0, 4).map(async (x) => (await publicUser(x)).name)), video: !!c.video, group: r.type === 'group', dur: c.dur || 0, missed: !!c.missed, reason: c.reason || null });
      }
    }
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = daysAgo(i); const v = byDay[d] || { day: d, calls: 0, answered: 0, missed: 0, minutes: 0 }; series.push({ ...v, minutes: Math.round(v.minutes) }); }
    res.json({ summary: { total: sum.total, answered: sum.answered, missed: sum.missed, video: sum.video, group: sum.group, minutes: Math.round(sum.minutes), avgSecs: sum.durs.length ? Math.round(sum.durs.reduce((a, b) => a + b, 0) / sum.durs.length) : 0, medianSecs: pctl(sum.durs, 50) }, days: series, reasons, recent, live: activeCalls() });
  }));

  // Activity: what accounts did, newest first (sign-ups, sign-ins, photo/name changes, calls, groups…).
  app.get('/api/admin/activity', adminOnly, wrap(async (req, res) => {
    const kind = String(req.query.kind || '').replace(/[^a-z]/g, '').slice(0, 24);
    const rows = await db.q(`SELECT user_id, kind, meta_enc, created_at FROM activity_log ${kind ? 'WHERE kind=?' : ''} ORDER BY id DESC LIMIT 400`, kind ? [kind] : []);
    const counts = await db.q('SELECT kind, COUNT(*) c FROM activity_log WHERE created_at >= ? GROUP BY kind', [new Date(Date.now() - 7 * 86400e3)]);
    const out = [];
    for (const r of rows) {
      const u = r.user_id ? await publicUser(Number(r.user_id)) : null;
      const meta = r.meta_enc ? C.decJson(r.meta_enc, {}) : {};
      if (meta.user) meta.userName = (await publicUser(Number(meta.user))).name;
      out.push({ at: ms0(r.created_at), kind: r.kind, userId: r.user_id ? Number(r.user_id) : null, name: u?.name || '—', username: u?.username || null, meta });
    }
    res.json({ events: out, counts: Object.fromEntries(counts.map((c) => [c.kind, n(c.c)])) });
  }));

  // Keep raw events for 120 days (the daily summaries stay).
  setInterval(() => {
    db.q('DELETE FROM analytics_events WHERE created_at < ?', [new Date(Date.now() - 120 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM feed_seen WHERE seen_at < ?', [new Date(Date.now() - 120 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM client_errors WHERE created_at < ?', [new Date(Date.now() - 30 * 86400e3)]).catch(() => {});
  }, 6 * 3600e3).unref();

  return { isAdmin };
};
