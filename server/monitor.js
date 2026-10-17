// Monitoring for the admin portal: how fast every server route, database query and realtime event
// is, server health (event-loop lag, memory, CPU, connections), server errors, and an activity log
// of what each account did. Metadata only — never message text, call content or passwords.
const { monitorEventLoopDelay } = require('perf_hooks');

const RESERVOIR = 400;   // recent durations kept per route for percentiles
const HOUR = 3600e3;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// "/api/chats/123/messages" → "/api/chats/:id/messages" so routes group together.
function routeKey(req) {
  const p = (req.baseUrl || '') + (req.route?.path || req.path || req.originalUrl.split('?')[0]);
  return `${req.method} ${String(p).replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:hex').replace(/\/\d+(?=\/|$)/g, '/:id').slice(0, 100)}`;
}

// Query shape: literals and lists stripped, whitespace collapsed.
function sqlKey(sql) {
  return String(sql).replace(/\s+/g, ' ').replace(/'[^']*'/g, "'?'").replace(/\b\d+\b/g, 'N').replace(/\(\?(,\s*\?)+\)/g, '(?…)').trim().slice(0, 140);
}

module.exports = function monitor({ db, C }) {
  const started = Date.now();
  const RES = 10; // ms between checks; reported delay = how much later than that the check ran
  const loop = monitorEventLoopDelay({ resolution: RES });
  const lagMs = (ns) => Math.max(0, Math.round(ns / 1e6 - RES));
  loop.enable();

  const routes = new Map();   // key → { n, errors, c4xx, total, max, recent[] }
  const queries = new Map();  // sql shape → { n, total, max }
  const slowQueries = [];     // last slow queries (> 250ms)
  const events = new Map();   // socket event → { n, errors, total, max, recent[] }
  const hourly = new Map();   // route → durations this hour (flushed to perf_hourly)
  const minutes = [];         // last 24h: { t, n, errors, total, max, lag }
  let cpuPrev = process.cpuUsage(), cpuAt = Date.now(), cpuPct = 0;

  const bump = (map, key, ms, error) => {
    let r = map.get(key);
    if (!r) { r = { n: 0, errors: 0, total: 0, max: 0, recent: [] }; map.set(key, r); }
    r.n++; r.total += ms; if (ms > r.max) r.max = ms; if (error) r.errors++;
    r.recent.push(ms); if (r.recent.length > RESERVOIR) r.recent.shift();
    return r;
  };
  const minute = () => {
    const t = Math.floor(Date.now() / 60000) * 60000;
    let m = minutes[minutes.length - 1];
    if (!m || m.t !== t) { m = { t, n: 0, errors: 0, total: 0, max: 0, lag: 0 }; minutes.push(m); if (minutes.length > 1440) minutes.shift(); }
    return m;
  };

  // ── HTTP timing ──
  function middleware(req, res, next) {
    if (!req.path.startsWith('/api/') || req.path === '/api/t') return next();
    const t = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const key = routeKey(req);
      const err = res.statusCode >= 500;
      const r = bump(routes, key, ms, err);
      if (res.statusCode >= 400 && res.statusCode < 500) r.c4xx = (r.c4xx || 0) + 1;
      const m = minute(); m.n++; m.total += ms; if (ms > m.max) m.max = ms; if (err) m.errors++;
      if (!hourly.has(key)) hourly.set(key, { d: [], errors: 0 });
      const hr = hourly.get(key); hr.d.push(ms); if (err) hr.errors++;
    });
    next();
  }

  // ── Database timing ──
  db.hooks.onQuery = (sql, ms) => {
    const k = sqlKey(sql);
    let r = queries.get(k);
    if (!r) { r = { n: 0, total: 0, max: 0 }; queries.set(k, r); if (queries.size > 600) queries.delete(queries.keys().next().value); }
    r.n++; r.total += ms; if (ms > r.max) r.max = ms;
    if (ms > 250) { slowQueries.push({ sql: k, ms: Math.round(ms), at: Date.now() }); if (slowQueries.length > 50) slowQueries.shift(); }
  };

  // ── Realtime (socket.io) timing: from event received to its reply ──
  function socketUse(socket) {
    socket.use((packet, next) => {
      const [name] = packet;
      const last = packet.length - 1;
      if (typeof packet[last] === 'function') {
        const ack = packet[last];
        const t = process.hrtime.bigint();
        packet[last] = (resp) => { try { bump(events, String(name).slice(0, 40), Number(process.hrtime.bigint() - t) / 1e6, resp && resp.ok === false && /went wrong/.test(resp.error || '')); } catch {} ack(resp); };
      } else bump(events, String(name).slice(0, 40), 0, false);
      next();
    });
  }

  // ── Server errors ──
  function serverError(err, where, uid = null) {
    db.q('INSERT INTO server_errors (where_at, msg, stack, user_id) VALUES (?,?,?,?)',
      [String(where || 'server').slice(0, 120), String(err?.message || err).slice(0, 300), String(err?.stack || '').slice(0, 2000) || null, uid]).catch(() => {});
  }

  // ── Activity log ──
  function log(uid, kind, meta = null) {
    db.q('INSERT INTO activity_log (user_id, kind, meta_enc) VALUES (?,?,?)', [uid || null, String(kind).slice(0, 24), meta ? C.enc(meta) : null]).catch(() => {});
  }

  // Every minute: CPU %, event-loop lag. Every hour: route percentiles saved for history.
  setInterval(() => {
    const now = Date.now(), c = process.cpuUsage(cpuPrev);
    cpuPct = Math.round(((c.user + c.system) / 1000 / (now - cpuAt)) * 1000) / 10;
    cpuPrev = process.cpuUsage(); cpuAt = now;
    const m = minute(); m.lag = lagMs(loop.percentile(99)); m.cpu = cpuPct;
    loop.reset(); // lag figures are per minute, not since start
  }, 60000).unref();
  let hourStart = Math.floor(Date.now() / HOUR) * HOUR;
  setInterval(async () => {
    const h = Math.floor(Date.now() / HOUR) * HOUR;
    if (h === hourStart) return;
    const at = new Date(hourStart); hourStart = h;
    const rows = [];
    for (const [route, v] of hourly) {
      const d = v.d.sort((a, b) => a - b);
      rows.push([at, route.slice(0, 120), d.length, v.errors, Math.round(pct(d, 50)), Math.round(pct(d, 95)), Math.round(d[d.length - 1] || 0), Math.round(d.reduce((a, b) => a + b, 0))]);
    }
    hourly.clear();
    if (rows.length) await db.q('INSERT INTO perf_hourly (hour, route, n, errors, p50, p95, mx, total_ms) VALUES ? ON DUPLICATE KEY UPDATE n=n+VALUES(n), errors=errors+VALUES(errors), p95=GREATEST(p95, VALUES(p95)), mx=GREATEST(mx, VALUES(mx)), total_ms=total_ms+VALUES(total_ms)', [rows]).catch(() => {});
    db.q('DELETE FROM perf_hourly WHERE hour < ?', [new Date(Date.now() - 90 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM server_errors WHERE created_at < ?', [new Date(Date.now() - 30 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM client_perf WHERE created_at < ?', [new Date(Date.now() - 30 * 86400e3)]).catch(() => {});
    db.q('DELETE FROM activity_log WHERE created_at < ?', [new Date(Date.now() - 365 * 86400e3)]).catch(() => {});
  }, 60000).unref();

  // Everything the Speed page shows about this server right now.
  function snapshot() {
    const stat = (r) => { const d = [...r.recent].sort((a, b) => a - b); return { n: r.n, errors: r.errors, avg: Math.round(r.total / Math.max(1, r.n)), p50: Math.round(pct(d, 50)), p95: Math.round(pct(d, 95)), max: Math.round(r.max) }; };
    const mem = process.memoryUsage();
    return {
      startedAt: started, uptimeSec: Math.round((Date.now() - started) / 1000), node: process.version,
      cpuPct, memMb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), heapTotal: Math.round(mem.heapTotal / 1048576) },
      loopLagMs: { p50: lagMs(loop.percentile(50)), p99: lagMs(loop.percentile(99)), max: lagMs(loop.max) },
      routes: [...routes].map(([k, r]) => ({ route: k, c4xx: r.c4xx || 0, ...stat(r) })).sort((a, b) => b.p95 - a.p95),
      events: [...events].map(([k, r]) => ({ event: k, ...stat(r) })).sort((a, b) => b.p95 - a.p95),
      queries: [...queries].map(([k, r]) => ({ sql: k, n: r.n, avg: Math.round((r.total / r.n) * 10) / 10, max: Math.round(r.max), total: Math.round(r.total) })).sort((a, b) => b.total - a.total).slice(0, 40),
      slowQueries: [...slowQueries].reverse(),
      minutes: minutes.map((m) => ({ t: m.t, n: m.n, errors: m.errors, avg: m.n ? Math.round(m.total / m.n) : 0, max: Math.round(m.max), lag: m.lag || 0, cpu: m.cpu || 0 })),
    };
  }

  return { middleware, socketUse, serverError, log, snapshot };
};
