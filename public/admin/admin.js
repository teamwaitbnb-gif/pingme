// Ping Me admin portal — the owner's view of users, screens, retention and Buzz.
const root = document.getElementById('root');
const H = { 'content-type': 'application/json', 'x-pingme': '1' };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Request failed'); e.status = r.status; throw e; }
  return d;
};
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const fmt = (x) => (x == null ? '—' : Number(x).toLocaleString('en-IN'));
const SCREEN_NAMES = { chats: 'Chats list', chat: 'One-to-one chat', group: 'Group chat', buzz: 'Buzz', call: 'Call', camera: 'Camera', settings: 'Settings', auth: 'Sign in', install: 'Install screen', other: 'Other' };
const ago = (t) => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'moments' : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
let range = Number(localStorage.getItem('pmAdminRange') || 30), liveTimer = null;

// ───── login ─────
async function boot() {
  const me = await api('/api/admin/me').catch(() => ({ admin: false, configured: false }));
  if (me.admin) return route();
  const input = el('input', { type: 'password', placeholder: 'Admin key', autocomplete: 'current-password', autofocus: 'true' });
  const err = el('div', { class: 'err' }, me.configured ? '' : 'The admin key isn’t set up on the server yet (ADMIN_KEY in .env).');
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ key: input.value.trim() }) }); route(); }
    catch (ex) { err.textContent = ex.message; input.select(); }
  } }, el('img', { src: '/icons/icon-192.png', alt: '' }), el('h1', null, 'Ping Me Admin'), el('p', null, 'Owner access only'), input, el('button', { type: 'submit' }, 'Open dashboard'), err);
  root.replaceChildren(el('div', { class: 'login' }, form));
}

// ───── charts (plain SVG) ─────
function chart(days, series, { type = 'line' } = {}) {
  const W = 640, Hh = 190, P = { l: 34, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...series.flatMap((s) => days.map((d) => d[s.key] || 0)));
  const nice = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 10 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 5 : 2);
  const top = Math.max(nice, 1);
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, days.length - 1);
  const y = (v) => Hh - P.b - (v / top) * (Hh - P.t - P.b);
  const parts = [];
  for (let k = 0; k <= 4; k++) { const v = (top * k) / 4; parts.push(`<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`); }
  const step = Math.ceil(days.length / 7);
  days.forEach((d, i) => { if (i % step === 0 || i === days.length - 1) parts.push(`<text x="${x(i)}" y="${Hh - 6}" text-anchor="middle">${d.day.slice(5).replace('-', '/')}</text>`); });
  series.forEach((s, si) => {
    if (type === 'bar') {
      const bw = Math.max(2, ((W - P.l - P.r) / days.length) * (0.7 / series.length));
      days.forEach((d, i) => { const v = d[s.key] || 0; const bx = x(i) - (bw * series.length) / 2 + si * bw; parts.push(`<rect x="${bx}" y="${y(v)}" width="${bw}" height="${Math.max(0, Hh - P.b - y(v))}" rx="2" fill="${s.color}"><title>${d.day}: ${v} ${s.label}</title></rect>`); });
    } else {
      const pts = days.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
      days.forEach((d, i) => parts.push(`<circle cx="${x(i)}" cy="${y(d[s.key] || 0)}" r="2.6" fill="${s.color}"><title>${d.day}: ${d[s.key] || 0} ${s.label}</title></circle>`));
    }
  });
  return el('div', null, el('div', { html: `<svg class="chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${parts.join('')}</svg>` }),
    el('div', { class: 'legend' }, series.map((s) => el('span', null, el('i', { style: `background:${s.color}` }), s.label))));
}
const heat = (v) => {
  if (v == null) return el('span', { class: 'heat', style: 'color:var(--text2)' }, '—');
  const a = Math.min(1, v / 60);
  return el('span', { class: 'heat', style: `background:rgba(48,209,88,${0.12 + a * 0.5});` }, v + '%');
};

// ───── dashboard ─────
// /admin → full dashboard · /admin#algorithm → the Buzz suggestion algorithm on its own page.
// Pages: #overview (default) · #speed · #errors · #users · #user/<id> · #calls · #activity · #algorithm
const PAGES = [['overview', 'Overview'], ['speed', 'Speed'], ['errors', 'Errors'], ['users', 'Users'], ['calls', 'Calls'], ['pets', 'Pets'], ['activity', 'Activity'], ['algorithm', 'Buzz algorithm'], ['notify', 'Notifications'], ['ads', 'Ads']];
const route = () => {
  clearInterval(liveTimer);
  const [page, arg] = location.hash.replace(/^#/, '').split('/');
  const fn = { speed: speedPage, errors: errorsPage, users: usersPage, user: () => userPage(arg), calls: callsPage, pets: petsPage, activity: activityPage, algorithm: algorithmPage, notify: notifyPage, ads: adsPage }[page] || dashboard;
  window.scrollTo(0, 0);
  return fn();
};
addEventListener('hashchange', () => route());
// Shared top bar: page tabs + refresh + lock.
function nav(active, sub, extra = []) {
  return el('div', null,
    el('header', { class: 'top' }, el('img', { src: '/icons/icon-192.png', alt: '' }),
      el('div', null, el('h1', null, (PAGES.find((p) => p[0] === active) || [, 'Ping Me Admin'])[1]), el('div', { class: 'sub' }, sub || `Updated ${new Date().toLocaleTimeString()} · India time`)),
      el('div', { class: 'spacer' }), ...extra,
      el('button', { class: 'btn-ghost', onclick: route }, 'Refresh'),
      el('button', { class: 'btn-ghost', onclick: async () => { await api('/api/admin/logout', { method: 'POST' }); boot(); } }, 'Lock')),
    el('nav', { class: 'tabs' }, PAGES.map(([k, l]) => el('a', { href: '#' + k, class: k === active ? 'on' : '' }, l))));
}
const loading = (t) => root.replaceChildren(el('div', { class: 'loading' }, t));
const fail = (e) => { if (e.status === 401) return boot(); root.replaceChildren(el('div', { class: 'loading' }, e.message)); };
const kpiBox = (l, v, s, cls) => el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), s ? el('div', { class: 's' }, s) : null);
const msFmt = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms');
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const durFmt = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const speedCls = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'good');
const table = (head, rows, empty = 'Nothing yet') => (rows.length ? el('div', { class: 'tablewrap' }, el('table', null, el('tr', null, head.map((h) => (Array.isArray(h) ? el('th', { class: h[1] }, h[0]) : el('th', null, h)))), rows)) : el('div', { class: 'empty' }, empty));

// ───── Speed: where the app is slow ─────
async function speedPage() {
  loading('Measuring speed…');
  let d; try { d = await api('/api/admin/perf'); } catch (e) { return fail(e); }
  const s = d.server;
  const up = s.uptimeSec > 86400 ? `${Math.round(s.uptimeSec / 86400)} days` : s.uptimeSec > 3600 ? `${Math.round(s.uptimeSec / 3600)} h` : `${Math.round(s.uptimeSec / 60)} min`;
  const reqs = s.routes.reduce((a, r) => a + r.n, 0), errs = s.routes.reduce((a, r) => a + r.errors, 0);
  const hours = d.hours.map((h) => ({ ...h, day: new Date(h.t).toISOString().slice(0, 13).replace('T', ' ') }));
  const minutes = s.minutes.slice(-180).map((m) => ({ ...m, day: new Date(m.t).toTimeString().slice(0, 5).padStart(10, '0') }));
  root.replaceChildren(el('div', { class: 'wrap' }, nav('speed', `Server up ${up} · ${s.node} · updated ${new Date().toLocaleTimeString()}`),
    el('h2', null, 'Where it’s slow', el('small', null, 'worst first — fix these to make the app feel faster')),
    el('div', { class: 'card verdict' }, d.hotspots.length ? el('ul', { class: 'hot' }, d.hotspots.map((h) => el('li', { class: h.level }, h.text))) : el('div', { class: 'empty' }, '✓ Nothing slow right now — server, database and phones are all quick')),
    el('h2', null, 'Server right now'),
    el('div', { class: 'kpis' },
      kpiBox('Requests (since start)', fmt(reqs), `${errs} failed`, errs ? 'bad' : ''),
      kpiBox('Event-loop delay', msFmt(s.loopLagMs.p99), `p50 ${msFmt(s.loopLagMs.p50)} · max ${msFmt(s.loopLagMs.max)}`, speedCls(s.loopLagMs.p99, 50, 200)),
      kpiBox('CPU', s.cpuPct + '%', 'last minute', speedCls(s.cpuPct, 60, 90)),
      kpiBox('Memory', s.memMb.rss + ' MB', `heap ${s.memMb.heap} / ${s.memMb.heapTotal} MB`, speedCls(s.memMb.rss, 700, 1000)),
      kpiBox('Connections', fmt(s.sockets), `${fmt(s.onlineUsers)} people online`, 'live'),
      kpiBox('Calls now', fmt(s.activeCalls)),
      kpiBox('Phone samples', fmt(d.phones.samples), 'speed reports, 7 days')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Last 3 hours (per minute)'), el('div', { class: 'hint' }, 'Average and slowest request time; server delay'), minutes.length > 1 ? chart(minutes, [{ key: 'avg', label: 'avg ms', color: 'var(--blue)' }, { key: 'max', label: 'slowest ms', color: 'var(--orange)' }, { key: 'lag', label: 'server delay ms', color: 'var(--pink)' }]) : el('div', { class: 'empty' }, 'Collecting… (one point per minute)')),
      el('div', { class: 'card' }, el('h3', null, 'Last 7 days (per hour)'), el('div', { class: 'hint' }, 'Requests and the slowest-5% time'), hours.length > 1 ? chart(hours, [{ key: 'p95', label: 'p95 ms', color: 'var(--orange)' }, { key: 'avg', label: 'avg ms', color: 'var(--blue)' }]) : el('div', { class: 'empty' }, 'Builds up hour by hour'))),
    el('h2', null, 'On people’s phones', el('small', null, 'real speed measured in the app · 7 days')),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', null, 'App opening time'), el('div', { class: 'hint' }, 'From tap to chats on screen'), table(['Device', ['Typical', 'num'], ['Slowest 5%', 'num'], ['Opens', 'num']], d.phones.boot.map((b) => el('tr', null, el('td', null, b.key), el('td', { class: 'num ' + speedCls(b.p50, 2500, 5000) }, msFmt(b.p50)), el('td', { class: 'num' }, msFmt(b.p95)), el('td', { class: 'num' }, fmt(b.n)))))),
      el('div', { class: 'card' }, el('h3', null, 'Message send time'), el('div', { class: 'hint' }, 'Tap send → server confirmed'), table(['Device', ['Typical', 'num'], ['Slowest 5%', 'num'], ['Messages', 'num']], d.phones.send.map((b) => el('tr', null, el('td', null, b.key), el('td', { class: 'num ' + speedCls(b.p50, 400, 1200) }, msFmt(b.p50)), el('td', { class: 'num' }, msFmt(b.p95)), el('td', { class: 'num' }, fmt(b.n))))))),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', null, 'Requests that felt slow on phones'), el('div', { class: 'hint' }, 'Over 0.7 s, by address'), table(['Request', ['Times', 'num'], ['Typical', 'num'], ['Slowest 5%', 'num'], ['Worst', 'num']], d.phones.slowApi.map((a) => el('tr', null, el('td', { class: 'mono' }, a.key), el('td', { class: 'num' }, fmt(a.n)), el('td', { class: 'num' }, msFmt(a.p50)), el('td', { class: 'num' }, msFmt(a.p95)), el('td', { class: 'num' }, msFmt(a.max)))), 'No slow requests reported — great')),
    el('h2', null, 'Server routes', el('small', null, 'since the server started · slowest first')),
    el('div', { class: 'card' }, table(['Route', ['Requests', 'num'], ['Avg', 'num'], ['Typical', 'num'], ['Slowest 5%', 'num'], ['Worst', 'num'], ['Failed', 'num'], ['Rejected', 'num']],
      s.routes.slice(0, 60).map((r) => el('tr', null, el('td', { class: 'mono' }, r.route), el('td', { class: 'num' }, fmt(r.n)), el('td', { class: 'num' }, msFmt(r.avg)), el('td', { class: 'num' }, msFmt(r.p50)), el('td', { class: 'num ' + speedCls(r.p95, 500, 1500) }, msFmt(r.p95)), el('td', { class: 'num' }, msFmt(r.max)), el('td', { class: 'num' + (r.errors ? ' bad' : '') }, fmt(r.errors)), el('td', { class: 'num' }, fmt(r.c4xx)))))),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Realtime events'), el('div', { class: 'hint' }, 'Messages, calls, typing… received → answered'), table(['Event', ['Count', 'num'], ['Typical', 'num'], ['Slowest 5%', 'num'], ['Failed', 'num']], s.events.slice(0, 30).map((r) => el('tr', null, el('td', { class: 'mono' }, r.event), el('td', { class: 'num' }, fmt(r.n)), el('td', { class: 'num' }, msFmt(r.p50)), el('td', { class: 'num ' + speedCls(r.p95, 300, 1000) }, msFmt(r.p95)), el('td', { class: 'num' }, fmt(r.errors)))))),
      el('div', { class: 'card' }, el('h3', null, 'Routes over 7 days'), el('div', { class: 'hint' }, 'By total time spent'), table(['Route', ['Requests', 'num'], ['Avg', 'num'], ['p95', 'num'], ['Failed', 'num']], d.history.slice(0, 25).map((r) => el('tr', null, el('td', { class: 'mono' }, r.route), el('td', { class: 'num' }, fmt(r.n)), el('td', { class: 'num' }, msFmt(r.avg)), el('td', { class: 'num' }, msFmt(r.p95)), el('td', { class: 'num' }, fmt(r.errors)))), 'Saved once per hour'))),
    el('h2', null, 'Database', el('small', null, 'time spent per query shape · since start')),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', null, 'Where database time goes'), table(['Query', ['Count', 'num'], ['Avg', 'num'], ['Worst', 'num'], ['Total', 'num']], s.queries.slice(0, 25).map((q) => el('tr', null, el('td', { class: 'mono sql', title: q.sql }, q.sql), el('td', { class: 'num' }, fmt(q.n)), el('td', { class: 'num' }, msFmt(q.avg)), el('td', { class: 'num ' + speedCls(q.max, 200, 1000) }, msFmt(q.max)), el('td', { class: 'num' }, msFmt(q.total)))))),
      el('div', { class: 'card' }, el('h3', null, 'Slow queries'), el('div', { class: 'hint' }, 'Each one over 250 ms, newest first'), table(['When', 'Query', ['Time', 'num']], s.slowQueries.map((q) => el('tr', null, el('td', null, ago(q.at)), el('td', { class: 'mono sql', title: q.sql }, q.sql), el('td', { class: 'num bad' }, msFmt(q.ms)))), 'No slow queries'))),
    el('p', { class: 'foot' }, 'Typical = median (half are faster). Slowest 5% = 95th percentile. Event-loop delay = how long the server was too busy to start new work. Phone numbers come from the app itself: opening time, requests over 0.7 s (address shape only) and message send time.')));
}

// ───── Errors ─────
async function errorsPage() {
  loading('Loading errors…');
  let d; try { d = await api('/api/admin/errors-all'); } catch (e) { return fail(e); }
  const days = []; for (let i = 13; i >= 0; i--) { const k = new Date(Date.now() + 5.5 * 3600e3 - i * 86400e3).toISOString().slice(0, 10); days.push({ day: k, phone: d.daily.find((x) => x.day === k && x.src === 'phone')?.count || 0, server: d.daily.find((x) => x.day === k && x.src === 'server')?.count || 0 }); }
  const rows = (list, phone) => list.map((x) => el('tr', { class: 'clickable', onclick: (e) => { const n = e.currentTarget.nextSibling; if (n?.classList.contains('stack-row')) n.hidden = !n.hidden; } },
    el('td', null, el('span', { class: 'chip' }, x.where)), el('td', { class: 'title-cell' }, x.msg), el('td', { class: 'num' }, fmt(x.count)), el('td', { class: 'num' }, fmt(x.users)), phone ? el('td', null, x.platforms || '—') : null, el('td', null, ago(x.last) + ' ago')))
    .flatMap((tr, i) => [tr, el('tr', { class: 'stack-row', hidden: true }, el('td', { colspan: phone ? 6 : 5 }, el('pre', null, list[i].stack || 'No details')))]);
  root.replaceChildren(el('div', { class: 'wrap' }, nav('errors'),
    el('div', { class: 'kpis' }, kpiBox('Phone errors (14d)', fmt(d.client.reduce((a, x) => a + x.count, 0)), `${d.client.length} kinds`, d.client.length ? 'bad' : 'good'), kpiBox('Server errors (14d)', fmt(d.server.reduce((a, x) => a + x.count, 0)), `${d.server.length} kinds`, d.server.length ? 'bad' : 'good')),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', null, 'Errors per day'), chart(days, [{ key: 'phone', label: 'on phones', color: 'var(--pink)' }, { key: 'server', label: 'on the server', color: 'var(--orange)' }], { type: 'bar' })),
    el('h2', null, 'On phones', el('small', null, 'tap a row for details')),
    el('div', { class: 'card' }, table(['Where', 'Error', ['Times', 'num'], ['People', 'num'], 'Devices', 'Last'], rows(d.client, true), 'No phone errors')),
    el('h2', null, 'On the server', el('small', null, 'tap a row for details')),
    el('div', { class: 'card' }, table(['Where', 'Error', ['Times', 'num'], ['People', 'num'], 'Last'], rows(d.server, false), 'No server errors'))));
}

// ───── Users ─────
async function usersPage() {
  loading('Loading users…');
  let d; try { d = await api('/api/admin/users-all'); } catch (e) { return fail(e); }
  const box = el('div');
  const search = el('input', { class: 'search', type: 'search', placeholder: 'Search name or @username', oninput: () => draw() });
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(/^@/, '');
    const list = d.users.filter((u) => !q || `${u.name} ${u.username}`.toLowerCase().includes(q));
    box.replaceChildren(table(['', 'Person', 'Joined', 'Last seen', ['Messages', 'num'], ['7 days', 'num'], ['Active days', 'num'], ['Min (7d)', 'num'], 'Photo', ['Photo views', 'num'], 'Device'],
      list.map((u) => el('tr', { class: 'clickable', onclick: () => { location.hash = 'user/' + u.id; } },
        el('td', null, el('span', { class: 'dot' + (u.online ? '' : ' off') })),
        el('td', null, el('div', { class: 'who' }, u.photo ? el('img', { class: 'av', src: `/api/admin/avatar/${u.id}`, alt: '' }) : el('span', { class: 'av ph' }, (u.name || '?')[0]), el('div', null, el('b', null, u.name), el('small', null, u.username ? '@' + u.username : 'guest')))),
        el('td', null, when(u.joined)), el('td', null, u.online ? 'online' : u.lastSeen ? ago(u.lastSeen) + ' ago' : '—'),
        el('td', { class: 'num' }, fmt(u.messages)), el('td', { class: 'num' }, fmt(u.messages7d)), el('td', { class: 'num' }, fmt(u.activeDays30)), el('td', { class: 'num' }, u.minutes7d),
        el('td', null, u.photo ? `uploaded ${when(u.photoAt)}` : '—'), el('td', { class: 'num' }, fmt(u.photoViews)),
        el('td', null, u.platform ? `${u.platform}${u.installed ? ' · app' : ' · browser'}` : '—'))), 'No one matches'));
  };
  const withPhoto = d.users.filter((u) => u.photo).length;
  root.replaceChildren(el('div', { class: 'wrap' }, nav('users'),
    el('div', { class: 'kpis' }, kpiBox('People', fmt(d.users.length)), kpiBox('Online now', fmt(d.users.filter((u) => u.online).length), '', 'live'),
      kpiBox('With a profile photo', fmt(withPhoto), d.users.length ? Math.round((withPhoto / d.users.length) * 100) + '%' : ''), kpiBox('Installed the app', fmt(d.users.filter((u) => u.installed).length))),
    el('div', { class: 'card', style: 'margin-top:14px' }, search, box)));
  draw();
}

// ───── One person ─────
const ACT = { pet: '🐾 Group pet', 'pet-own': '🐶 Own pet', signup: '🎉 Signed up', signin: '🔑 Signed in', open: '📱 Opened the app', photo: '🖼️ Profile photo', name: '✏️ Changed name', bio: '✏️ Changed bio', username: '@ Changed username', privacy: '🔒 Privacy setting', block: '⛔ Blocked someone', group: '👥 Created a group', call: '📞 Call', incognito: '🕶️ Incognito chat', deleted: '🗑️ Deleted account' };
function actText(a) {
  const m = a.meta || {};
  switch (a.kind) {
    case 'signin': return `${ACT.signin} · ${m.device || ''}`;
    case 'signup': return `${ACT.signup}${m.method ? ' · ' + m.method : ''}`;
    case 'photo': return `${ACT.photo} ${m.action === 'removed' ? 'removed' : 'uploaded'}`;
    case 'name': return `${ACT.name}: “${m.from}” → “${m.to}”`;
    case 'username': return `${ACT.username} → @${m.to}`;
    case 'privacy': return `${ACT.privacy}: ${Object.entries(m).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}`;
    case 'block': return `${ACT.block}${m.userName ? ': ' + m.userName : ''}`;
    case 'group': return `${ACT.group} (${m.members} people)`;
    case 'pet': return `${ACT.pet}: ${PET_ACTIONS[m.action] || m.action}`;
    case 'pet-own': return `${ACT['pet-own']}: ${m.action}${m.kind ? ' · ' + m.kind : ''}`;
    case 'call': return `${ACT.call} · ${m.video ? 'video' : 'audio'}${m.group ? ' · group' : ''} · ${m.caller ? 'made' : 'received'} · ${m.missed ? 'missed' : durFmt(m.dur || 0)}`;
    default: return ACT[a.kind] || a.kind;
  }
}
async function userPage(id) {
  loading('Loading person…');
  let d; try { d = await api('/api/admin/user/' + id); } catch (e) { return fail(e); }
  const u = d.user;
  const days = []; for (let i = 29; i >= 0; i--) { const k = new Date(Date.now() + 5.5 * 3600e3 - i * 86400e3).toISOString().slice(0, 10); days.push({ day: k, count: d.messages.perDay.find((x) => x.day === k)?.count || 0 }); }
  root.replaceChildren(el('div', { class: 'wrap' }, nav('users', 'One person · metadata only, never message text'),
    el('a', { class: 'btn-ghost', href: '#users' }, '← All users'),
    el('div', { class: 'card person' },
      u.photo ? el('img', { class: 'big-av', src: `/api/admin/avatar/${u.id}`, alt: '' }) : el('div', { class: 'big-av ph' }, (u.name || '?')[0]),
      el('div', null, el('h2', { style: 'margin:0' }, u.name, u.online ? el('span', { class: 'chip s-call' }, 'online') : null, u.guest ? el('span', { class: 'chip' }, 'guest') : null),
        el('div', { class: 'sub' }, [u.username ? '@' + u.username : null, u.email, `joined ${when(u.joined)}`, u.online ? null : `last seen ${u.lastSeen ? ago(u.lastSeen) + ' ago' : '—'}`].filter(Boolean).join(' · ')),
        u.bio ? el('div', { class: 'bio' }, u.bio) : null,
        el('div', { class: 'chips' }, u.photo ? el('span', { class: 'chip' }, `photo uploaded ${when(u.photoAt)}`) : el('span', { class: 'chip' }, 'no photo'),
          Object.entries(u.privacy).map(([k, v]) => el('span', { class: 'chip' + (v ? '' : ' off') }, `${k}: ${v ? 'on' : 'off'}`))))),
    el('div', { class: 'kpis', style: 'margin-top:14px' },
      kpiBox('Messages sent', fmt(d.messages.total), Object.entries(d.messages.kinds).filter(([k]) => k !== 'call').map(([k, v]) => `${v} ${k}`).join(' · ')),
      kpiBox('Calls (90d)', fmt(d.calls.total), `${d.calls.minutes} min · ${d.calls.missed} missed · ${d.calls.video} video`),
      kpiBox('Buzz (30d)', fmt(d.buzz.opens), `opened · ${fmt(d.buzz.seen)} seen · ${d.buzz.watchMinutes} min video`),
      kpiBox('Photo views (90d)', fmt(d.photoViews.received), `${d.photoViews.people} people · viewed others ${d.photoViews.made}×`),
      kpiBox('App speed', msFmt(d.speed.bootP50 || null), `to open · send ${msFmt(d.speed.sendP50 || null)} · ${d.speed.slowRequests} slow requests`),
      kpiBox('Errors', fmt(d.errors.length), 'on their phone', d.errors.length ? 'bad' : 'good')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Messages per day'), el('div', { class: 'hint' }, 'Counts only'), chart(days, [{ key: 'count', label: 'messages', color: 'var(--purple)' }], { type: 'bar' })),
      el('div', { class: 'card' }, el('h3', null, 'Time in each screen (30 days)'), d.screens.length ? el('div', { class: 'bars' }, d.screens.map((s) => el('div', { class: 'bar' }, el('span', null, SCREEN_NAMES[s.screen] || s.screen), el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, (s.minutes / Math.max(...d.screens.map((x) => x.minutes))) * 100)}%` })), el('span', { class: 'val' }, s.minutes + ' min')))) : el('div', { class: 'empty' }, 'No screen time yet')),
      el('div', { class: 'card' }, el('h3', null, 'Conversations'), el('div', { class: 'hint' }, 'Messages they sent in each'), table(['Chat', 'Type', ['Their messages', 'num'], 'Last activity'], d.messages.chats.map((c) => el('tr', null, el('td', null, c.title), el('td', null, c.type), el('td', { class: 'num' }, fmt(c.mine)), el('td', null, c.last ? ago(c.last) + ' ago' : '—'))))),
      el('div', { class: 'card' }, el('h3', null, 'Devices & sign-ins'), el('div', { class: 'hint' }, d.device ? `Main device: ${d.device.platform}${d.device.installed ? ' · installed app' : ' · browser'}` : ''), table(['Device', 'Signed in', 'Last used'], d.sessions.map((s) => el('tr', null, el('td', null, s.device), el('td', null, when(s.signedIn)), el('td', null, ago(s.lastUsed) + ' ago'))))),
      el('div', { class: 'card' }, el('h3', null, 'Recent calls'), table(['When', 'Type', 'Role', 'Result'], d.calls.recent.map((c) => el('tr', null, el('td', null, when(c.at)), el('td', null, c.video ? 'video' : 'audio'), el('td', null, c.caller ? 'made' : 'received'), el('td', null, c.missed ? 'missed' : durFmt(c.dur)))), 'No calls')),
      el('div', { class: 'card' }, el('h3', null, 'Buzz'), el('div', { class: 'hint' }, `${d.buzz.likes} likes · ${d.buzz.comments} comments · ${d.buzz.reposts} reposts · ${d.buzz.plays} videos watched`), d.buzz.topics.length ? el('div', { class: 'bars' }, d.buzz.topics.map((t) => el('div', { class: 'bar' }, el('span', null, t.topic), el('div', { class: 'track' }, el('i', { style: `width:${(t.n / d.buzz.topics[0].n) * 100}%;background:var(--orange)` })), el('span', { class: 'val' }, t.n)))) : el('div', { class: 'empty' }, 'No Buzz activity'))),
    el('h2', null, 'Timeline', el('small', null, 'everything they did, newest first')),
    el('div', { class: 'card' }, d.timeline.length ? el('div', { class: 'timeline' }, d.timeline.map((t) => el('div', { class: 'ev k-' + t.kind }, el('span', { class: 't' }, when(t.at)), el('span', null, actText(t))))) : el('div', { class: 'empty' }, 'No activity recorded yet (the activity log started with this release)')),
    d.errors.length ? el('div', null, el('h2', null, 'Errors on their phone'), el('div', { class: 'card' }, table(['When', 'Where', 'Error'], d.errors.map((e) => el('tr', null, el('td', null, when(e.at)), el('td', null, el('span', { class: 'chip' }, e.where)), el('td', { class: 'title-cell' }, e.msg)))))) : null));
}

// ───── Calls ─────
async function callsPage() {
  loading('Loading calls…');
  let d; try { d = await api(`/api/admin/calls?days=${range}`); } catch (e) { return fail(e); }
  const seg = el('div', { class: 'seg' }, [7, 30, 90].map((x) => el('button', { class: x === range ? 'on' : '', onclick: () => { range = x; localStorage.setItem('pmAdminRange', x); callsPage(); } }, `${x} days`)));
  const s = d.summary;
  root.replaceChildren(el('div', { class: 'wrap' }, nav('calls', null, [seg]),
    el('div', { class: 'kpis' }, kpiBox('Calls', fmt(s.total), `${s.video} video · ${s.group} group`), kpiBox('Answered', s.total ? Math.round((s.answered / s.total) * 100) + '%' : '—', `${fmt(s.answered)} calls`, 'good'),
      kpiBox('Missed', s.total ? Math.round((s.missed / s.total) * 100) + '%' : '—', `${fmt(s.missed)} calls`, s.missed > s.answered ? 'bad' : ''), kpiBox('Talk time', `${fmt(s.minutes)} min`, `avg ${durFmt(s.avgSecs)} · median ${durFmt(s.medianSecs)}`), kpiBox('On a call now', fmt(d.live), '', 'live')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Calls per day'), chart(d.days, [{ key: 'answered', label: 'answered', color: 'var(--accent)' }, { key: 'missed', label: 'missed', color: 'var(--pink)' }], { type: 'bar' })),
      el('div', { class: 'card' }, el('h3', null, 'Minutes per day'), chart(d.days, [{ key: 'minutes', label: 'minutes', color: 'var(--blue)' }])),
      barsCard('How calls ended', Object.entries(d.reasons).sort((a, b) => b[1] - a[1]), 'calls')),
    el('h2', null, 'Recent calls'),
    el('div', { class: 'card' }, table(['When', 'Caller', 'With', 'Type', 'Result'], d.recent.map((c) => el('tr', { class: 'clickable', onclick: () => { location.hash = 'user/' + c.callerId; } }, el('td', null, when(c.at)), el('td', null, c.caller), el('td', null, c.with.join(', ') || '—'), el('td', null, `${c.video ? 'video' : 'audio'}${c.group ? ' · group' : ''}`), el('td', { class: c.missed ? 'bad' : '' }, c.missed ? `missed${c.reason ? ' · ' + c.reason : ''}` : durFmt(c.dur)))), 'No calls yet'))));
}

// ───── Pets ─────
const PET_ACTIONS = { feed: '🍖 Feed', play: '🎾 Play', poke: '🤚 Pet', rename: '✏️ Rename', outfit: '🎀 Outfit', cage: '🔒 Cage', release: '🔓 Let out' };
// ───── Ads: photo/video ads in Buzz and above the chat list ─────
async function adsPage(editing = null) {
  loading('Loading ads…');
  let d; try { d = await api('/api/admin/ads'); } catch (e) { return fail(e); }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const f = editing || { placement: 'buzz', region: 'all', cta: 'Learn more', every: 8, weight: 1, active: true };
  const inp = (key, attrs = {}) => { const i = el('input', { class: 'search', value: f[key] ?? '', ...attrs }); i.oninput = () => { f[key] = i.value; draw(); }; return i; };
  const sel = (key, opts) => { const s = el('select', { class: 'search' }, opts.map(([v, l]) => el('option', { value: v, selected: String(f[key]) === String(v) }, l))); s.onchange = () => { f[key] = s.value; draw(); }; return s; };
  const local = (t) => (t ? new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const dateInp = (key) => { const i = el('input', { class: 'search', type: 'datetime-local', value: local(f[key]) }); i.onchange = () => { f[key] = i.value ? new Date(i.value).getTime() : null; }; return i; };
  const status = el('div', { class: 'hint' });
  const preview = el('div', { class: 'ad-prev' });
  const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime', hidden: true, onchange: async () => {
    const x = file.files[0]; if (!x) return;
    if (x.size > 40 * 1024 * 1024) { status.textContent = 'Files up to 40 MB'; return; }
    status.textContent = `Uploading ${x.name}…`;
    try {
      const r = await fetch('/api/admin/ads/upload', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': x.type, 'x-file-name': encodeURIComponent(x.name), 'x-pingme': '1' }, body: x }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Upload failed'); return j; });
      Object.assign(f, { mediaId: r.mediaId, kind: r.kind, mediaUrl: r.url }); status.textContent = 'Uploaded.'; draw();
    } catch (e) { status.textContent = e.message; }
  } });
  function draw() {
    const m = f.mediaUrl ? (f.kind === 'video' ? el('video', { src: f.mediaUrl, muted: true, autoplay: true, loop: true, playsinline: true }) : el('img', { src: f.mediaUrl, alt: '' })) : el('div', { class: 'ad-prev-empty' }, 'No photo or video yet');
    preview.replaceChildren(el('div', { class: 'ad-prev-card' }, el('div', { class: 'ad-prev-media' }, m),
      el('div', { class: 'ad-prev-body' }, el('span', { class: 'ad-prev-tag' }, 'Sponsored' + (f.advertiser ? ' · ' + f.advertiser : '')), el('b', null, f.headline || 'Your headline'), f.text ? el('p', null, f.text) : null,
        f.url ? el('span', { class: 'ad-prev-cta' }, f.cta || 'Learn more') : null)));
  }
  const save = el('button', { class: 'nf-btn', onclick: async () => {
    try { save.disabled = true; await post('/api/admin/ads', f); status.textContent = 'Saved.'; adsPage(); }
    catch (e) { status.textContent = e.message; } finally { save.disabled = false; }
  } }, f.id ? 'Save changes' : 'Create ad');
  draw();
  const ctr = (a) => (a.views ? ((a.clicks / a.views) * 100).toFixed(1) + '%' : '—');
  const totals = d.ads.reduce((t, a) => ({ v: t.v + a.views, c: t.c + a.clicks, live: t.live + (a.active ? 1 : 0) }), { v: 0, c: 0, live: 0 });
  root.replaceChildren(el('div', { class: 'wrap' }, nav('ads', `${totals.live} running · last 30 days: ${fmt(totals.v)} views, ${fmt(totals.c)} taps`),
    el('div', { class: 'kpis' },
      kpiBox('Ads running', fmt(totals.live), `${fmt(d.ads.length)} in total`),
      kpiBox('Views (30 days)', fmt(totals.v), 'half on screen for a second'),
      kpiBox('Taps (30 days)', fmt(totals.c), 'on the ad or its button'),
      kpiBox('Tap rate', totals.v ? ((totals.c / totals.v) * 100).toFixed(1) + '%' : '—', 'taps ÷ views')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, f.id ? 'Edit ad' : 'New ad'), el('div', { class: 'hint' }, 'Photo or video, a headline, a short line and a button. Always shown as “Sponsored”.'),
        el('div', { class: 'nf-row' }, el('button', { class: 'nf-btn ghost', onclick: () => file.click() }, f.mediaId ? 'Change photo / video' : 'Upload photo / video'), file, status),
        inp('headline', { maxlength: 90, placeholder: 'Headline' }), inp('text', { maxlength: 180, placeholder: 'Short text (optional)' }),
        inp('advertiser', { maxlength: 40, placeholder: 'Advertiser name (shown next to “Sponsored”)' }),
        el('div', { class: 'nf-grid' }, inp('cta', { maxlength: 24, placeholder: 'Button text' }), inp('url', { placeholder: 'Link — https://…' })),
        el('div', { class: 'nf-grid' },
          el('label', { class: 'nf-field' }, el('span', null, 'Where'), sel('placement', [['buzz', 'In the Buzz feed'], ['chats', 'Banner above chats']])),
          el('label', { class: 'nf-field' }, el('span', null, 'Who'), sel('region', d.cities.map((c) => [c.id, c.name]))),
          el('label', { class: 'nf-field' }, el('span', null, 'In Buzz, one every'), sel('every', [4, 6, 8, 10, 12, 15, 20].map((n) => [n, `${n} stories`]))),
          el('label', { class: 'nf-field' }, el('span', null, 'Weight'), sel('weight', [1, 2, 3, 5, 10].map((n) => [n, n === 1 ? 'Normal' : `${n}× more often`])))),
        el('div', { class: 'nf-grid' }, el('label', { class: 'nf-field' }, el('span', null, 'Starts (optional)'), dateInp('startAt')), el('label', { class: 'nf-field' }, el('span', null, 'Ends (optional)'), dateInp('endAt'))),
        el('div', { class: 'nf-row' }, save, f.id ? el('button', { class: 'nf-btn ghost', onclick: () => adsPage() }, 'Cancel') : null)),
      el('div', { class: 'card' }, el('h3', null, 'Preview'), el('div', { class: 'hint' }, 'How it looks in the app'), preview)),
    el('h2', null, 'All ads', el('small', null, 'last 30 days')),
    el('div', { class: 'card' }, table(['', 'Ad', 'Where', 'Who', 'Runs', ['Views', 'num'], ['Taps', 'num'], ['Tap rate', 'num'], ['Today', 'num'], 'On', ''],
      d.ads.map((a) => el('tr', null,
        el('td', null, a.mediaUrl ? (a.kind === 'video' ? el('video', { class: 'ad-row-media', src: a.mediaUrl, muted: true }) : el('img', { class: 'ad-row-media', src: a.mediaUrl, alt: '' })) : '—'),
        el('td', null, el('b', null, a.headline), el('div', { class: 'hint' }, a.advertiser || a.url || '')),
        el('td', null, a.placement === 'buzz' ? `Buzz · every ${a.every}` : 'Chats banner'),
        el('td', null, (d.cities.find((c) => c.id === a.region) || {}).name || a.region),
        el('td', null, a.startAt || a.endAt ? `${a.startAt ? when(a.startAt) : 'now'} → ${a.endAt ? when(a.endAt) : 'no end'}` : 'Always'),
        el('td', { class: 'num' }, fmt(a.views)), el('td', { class: 'num' }, fmt(a.clicks)), el('td', { class: 'num' }, ctr(a)),
        el('td', { class: 'num' }, `${fmt(a.todayViews)} / ${fmt(a.todayClicks)}`),
        el('td', null, (() => { let on = a.active; const b = el('button', { class: 'nf-switch' + (on ? ' on' : ''), role: 'switch', onclick: async () => { on = !on; b.classList.toggle('on', on); await post(`/api/admin/ads/${a.id}/active`, { active: on }); } }, el('i')); return b; })()),
        el('td', null, el('button', { class: 'chip', onclick: () => adsPage({ ...a }) }, 'Edit'), ' ',
          el('button', { class: 'chip', onclick: async () => { if (confirm(`Delete “${a.headline}”? Its numbers are deleted too.`)) { await post(`/api/admin/ads/${a.id}/delete`, {}); adsPage(); } } }, 'Delete')))), 'No ads yet — create your first one above'))));
}

// ───── Notifications: send your own, and control the automatic ones ─────
async function notifyPage() {
  loading('Loading notifications…');
  let d; try { d = await api('/api/admin/notify'); } catch (e) { return fail(e); }
  const c = d.config;
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const field = (label, input, hint) => el('label', { class: 'nf-field' }, el('span', null, label), input, hint ? el('small', null, hint) : null);
  // Compose
  const title = el('input', { class: 'search', maxlength: 80, placeholder: 'Title — e.g. New in Ping Me' });
  const body = el('textarea', { class: 'search nf-body', maxlength: 300, rows: 3, placeholder: 'Message (up to 300 characters)' });
  const link = el('input', { class: 'search', placeholder: 'Optional link: /?chat=123 or https://…' });
  const to = el('select', { class: 'search' }, [['all', 'Everyone'], ['active', 'Active in the last 7 days'], ['city', 'People in a city'], ['users', 'Specific usernames']].map(([v, l]) => el('option', { value: v }, l)));
  const city = el('select', { class: 'search', hidden: true }, d.cities.map((x) => el('option', { value: x.id }, x.name)));
  const users = el('input', { class: 'search', hidden: true, placeholder: 'Usernames, comma separated — e.g. vijay, asha' });
  const status = el('div', { class: 'hint' });
  to.onchange = () => { city.hidden = to.value !== 'city'; users.hidden = to.value !== 'users'; status.textContent = ''; };
  const payload = (preview) => ({ title: title.value, body: body.value, url: link.value, to: to.value, city: city.value, usernames: users.value, preview });
  const send = el('button', { class: 'nf-btn', onclick: async () => {
    try {
      const p = await post('/api/admin/notify/send', payload(true));
      if (!confirm(`Send “${title.value.trim()}” to ${p.recipients} ${p.recipients === 1 ? 'person' : 'people'} (${p.audience})?`)) return;
      send.disabled = true; status.textContent = 'Sending…';
      const r = await post('/api/admin/notify/send', payload(false));
      status.textContent = `Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}.`;
      title.value = ''; body.value = ''; link.value = '';
      setTimeout(notifyPage, 1200);
    } catch (e) { status.textContent = e.message; } finally { send.disabled = false; }
  } }, 'Send notification');
  // Automatic
  const sw = (on, fn) => { const b = el('button', { class: 'nf-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), onclick: () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); fn(on); } }, el('i')); return b; };
  const num = (v, min, max, fn) => { const i = el('input', { type: 'number', class: 'search nf-num', value: v, min, max }); i.onchange = () => fn(Number(i.value)); return i; };
  const save = async (patch) => { try { const r = await post('/api/admin/notify/config', patch); Object.assign(c, r.config); savedNote.textContent = 'Saved'; setTimeout(() => (savedNote.textContent = ''), 1500); } catch (e) { savedNote.textContent = e.message; } };
  const savedNote = el('span', { class: 'hint' });
  // Run an automatic notification by hand, and say plainly what happened (and why anyone was skipped).
  const explain = (r) => {
    if (r.busy) return 'Already running — try again in a minute.';
    const s = r.skipped || {}, parts = [];
    if (s.optedOut) parts.push(`${s.optedOut} turned these alerts off`);
    if (s.alreadyGot) parts.push(`${s.alreadyGot} already got this story`);
    if (s.dailyLimit) parts.push(`${s.dailyLimit} reached today’s limit`);
    if (s.noStory) parts.push(`${s.noStory} have no Indian/local story in the last 24 hours`);
    if (s.notHungry) parts.push(`${s.notHungry} groups’ pets aren’t hungry (below ${c.pets.below} needed)`);
    if (s.recentlyReminded) parts.push(`${s.recentlyReminded} groups were reminded in the last ${c.pets.gapHours} h`);
    if (s.noPet) parts.push(`${s.noPet} groups have no hatched pet yet (or it’s caged)`);
    const head = r.recipients ? `Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}${r.groups ? ` in ${r.groups} group${r.groups === 1 ? '' : 's'}` : ''}${r.story ? ` — “${r.story}”` : ''}.`
      : r.checked === 0 ? 'No groups chatted recently, so there were no pets to check.' : 'Nobody was sent anything.';
    return head + (parts.length ? ' ' + parts.join(' · ') + '.' : '');
  };
  const runNow = (path, label) => {
    const out = el('div', { class: 'hint nf-result' });
    const b = el('button', { class: 'nf-btn ghost', onclick: async () => {
      b.disabled = true; b.textContent = 'Working…'; out.textContent = '';
      try { out.textContent = explain(await post(path, {})); } catch (er) { out.textContent = er.message; }
      b.textContent = label; b.disabled = false;
    } }, label);
    return el('div', null, b, out);
  };
  const today = d.last24h || {};
  root.replaceChildren(el('div', { class: 'wrap' }, nav('notify', `${fmt(d.reachable)} people can get notifications · last 24 h: ${fmt(today.people || 0)} sent`),
    el('div', { class: 'kpis' },
      kpiBox('Notifications on', `${fmt(d.pushOn)} / ${fmt(d.reachable)}`, 'people whose phone allows Ping Me notifications', d.pushOn < d.reachable / 2 ? 'warn' : 'good'),
      d.delivery ? kpiBox('Message delivery (since start)', fmt(d.delivery.confirmed), `confirmed by phones · ${fmt(d.delivery.sent)} sent · ${fmt(d.delivery.retried)} re-sent`) : null,
      kpiBox('Buzz alerts (24 h)', fmt(today.buzz || 0), `${fmt(d.optedOut.buzz)} turned them off`),
      kpiBox('Pet alerts (24 h)', fmt(today.pets || 0), `${fmt(d.optedOut.pets)} turned them off`),
      kpiBox('Your messages (24 h)', fmt(today.admin || 0), 'sent from this page')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Send a notification'), el('div', { class: 'hint' }, 'Arrives as a phone notification, and as a banner if the app is open.'),
        title, body, link, to, city, users, el('div', { class: 'nf-row' }, send, status)),
      el('div', { class: 'card' }, el('h3', null, 'Automatic notifications', savedNote),
        el('div', { class: 'nf-auto' },
          el('div', { class: 'nf-head' }, el('b', null, 'Trending on Buzz'), sw(c.buzz.on, (v) => save({ buzz: { on: v } }))),
          el('div', { class: 'hint' }, d.nextBuzz ? `Top viral story now: “${d.nextBuzz.title}” (${d.nextBuzz.outlets} outlet${d.nextBuzz.outlets === 1 ? '' : 's'}). Tapping a notification opens that story in Buzz.` : 'No fresh stories right now.'),
          el('div', { class: 'nf-grid' },
            field('Per person per day', num(c.buzz.perDay, 0, 30, (v) => save({ buzz: { perDay: v } })), 'different stories'),
            field('Minutes between', num(c.buzz.gapMinutes, 15, 600, (v) => save({ buzz: { gapMinutes: v } }))),
            field('Covered by at least', num(c.buzz.minOutlets, 1, 10, (v) => save({ buzz: { minOutlets: v } })), 'outlets (or trending)'),
            field('From (IST hour)', num(c.buzz.from, 0, 23, (v) => save({ buzz: { from: v } }))),
            field('Until (IST hour)', num(c.buzz.to, 1, 24, (v) => save({ buzz: { to: v } })))),
          runNow('/api/admin/notify/buzz-now', 'Send the top story now')),
        el('div', { class: 'nf-auto' },
          el('div', { class: 'nf-head' }, el('b', null, 'Hungry group pets'), sw(c.pets.on, (v) => save({ pets: { on: v } }))),
          el('div', { class: 'hint' }, 'Reminds a group when its pet’s hunger drops low. Only groups that chatted recently.'),
          el('div', { class: 'nf-grid' },
            field('Hunger below', num(c.pets.below, 5, 60, (v) => save({ pets: { below: v } })), 'out of 100'),
            field('Hours between', num(c.pets.gapHours, 2, 48, (v) => save({ pets: { gapHours: v } })), 'per group'),
            field('Chatted in last', num(c.pets.activeDays, 1, 30, (v) => save({ pets: { activeDays: v } })), 'days'),
            field('From (IST hour)', num(c.pets.from, 0, 23, (v) => save({ pets: { from: v } }))),
            field('Until (IST hour)', num(c.pets.to, 1, 24, (v) => save({ pets: { to: v } })))),
          runNow('/api/admin/notify/pets-now', 'Check pets and remind now')))),
    el('h2', null, 'Sent', el('small', null, 'newest first')),
    el('div', { class: 'card' }, table(['When', 'Kind', 'Title', 'Message', 'To', ['People', 'num']],
      d.history.map((x) => el('tr', null, el('td', null, when(x.createdAt)), el('td', null, { admin: 'You', buzz: 'Buzz', pet: 'Pets' }[x.kind] || x.kind),
        el('td', null, el('b', null, x.title)), el('td', null, x.body), el('td', null, x.audience), el('td', { class: 'num' }, fmt(x.recipients)))), 'Nothing sent yet'))));
}

async function petsPage() {
  loading('Loading pets…');
  let d; try { d = await api(`/api/admin/pets?days=${range}`); } catch (e) { return fail(e); }
  const seg = el('div', { class: 'seg' }, [7, 30, 90].map((x) => el('button', { class: x === range ? 'on' : '', onclick: () => { range = x; localStorage.setItem('pmAdminRange', x); petsPage(); } }, `${x} days`)));
  const s = d.summary, p = d.personal;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  root.replaceChildren(el('div', { class: 'wrap' }, nav('pets', `Group pets and personal companions · last ${d.days} days`, [seg]),
    el('h2', null, 'Group pets'),
    el('div', { class: 'kpis' },
      kpiBox('Groups using their pet', fmt(s.groupsUsingPet), `${pct(s.groupsUsingPet, s.groups)} of ${fmt(s.groups)} groups · ${fmt(s.hatched)} hatched`, s.groupsUsingPet ? 'good' : ''),
      kpiBox('People playing with pets', fmt(s.people), `${fmt(s.peopleLast7)} in the last 7 days`),
      kpiBox('Pet interactions', fmt(s.interactions), Object.entries(s.byAction).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none yet'),
      kpiBox('Messages to the pet', fmt(s.mentions), `${fmt(s.talkers)} people said its name in chat`)),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Pet interactions per day'), el('div', { class: 'hint' }, 'Feeding, playing fetch, petting and the rest'),
        chart(d.series, [{ key: 'feed', label: 'feed', color: 'var(--orange)' }, { key: 'play', label: 'play', color: 'var(--accent)' }, { key: 'poke', label: 'pet', color: 'var(--pink)' }, { key: 'other', label: 'rename/outfit/cage', color: 'var(--purple)' }], { type: 'bar' })),
      barsCard('What people do with pets', Object.entries(s.byAction).sort((a, b) => b[1] - a[1]).map(([k, v]) => [PET_ACTIONS[k] || k, v]), 'times')),
    el('h2', null, 'Every group and its pet', el('small', null, 'most used first')),
    el('div', { class: 'card' }, table(['Group', 'Pet', 'Stage', 'Mood', ['Members', 'num'], ['Messages', 'num'], ['Interactions', 'num'], ['People', 'num'], ['Said its name', 'num'], 'Loves most', 'Last played'],
      d.groups.map((g) => el('tr', null,
        el('td', null, g.title),
        el('td', null, g.pet ? `${g.pet.emoji} ${g.pet.level ? g.pet.name : 'Egg'}${g.pet.outfit ? ' · ' + g.pet.outfit : ''}${g.pet.caged ? ' · caged' : ''}` : '—'),
        el('td', null, g.pet ? `${g.pet.stage} · ${g.pet.rarity}` : '—'),
        el('td', null, g.pet ? `${g.pet.moodEmoji} ${g.pet.mood}` : '—'),
        el('td', { class: 'num' }, fmt(g.members)), el('td', { class: 'num' }, fmt(g.messages)),
        el('td', { class: 'num' + (g.interactions ? ' good' : '') }, fmt(g.interactions)), el('td', { class: 'num' }, fmt(g.people)), el('td', { class: 'num' }, fmt(g.mentions)),
        el('td', null, g.pet?.favorite || '—'), el('td', null, g.lastInteraction ? ago(g.lastInteraction) + ' ago' : '—'))), 'No groups yet')),
    el('h2', null, 'Who plays with pets the most'),
    el('div', { class: 'card' }, table(['Person', ['Interactions', 'num'], 'What they do', ['Groups', 'num'], 'Last'],
      d.people.map((u) => el('tr', { class: 'clickable', onclick: () => { location.hash = 'user/' + u.userId; } },
        el('td', null, el('b', null, u.name), u.username ? el('small', { style: 'color:var(--text2);margin-left:6px' }, '@' + u.username) : null),
        el('td', { class: 'num' }, fmt(u.interactions)),
        el('td', null, Object.entries(u.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${(PET_ACTIONS[k] || k).split(' ')[0]} ${v}`).join('  ')),
        el('td', { class: 'num' }, fmt(u.groups)), el('td', null, ago(u.last) + ' ago'))), 'Nobody has played with a pet yet in this period')),
    el('h2', null, 'Personal pets & PingCoins'),
    el('div', { class: 'kpis' },
      kpiBox('People with a companion', fmt(p.withPet), `${fmt(p.adoptions)} adoptions · ${fmt(p.wallets)} wallets`),
      kpiBox('PingCoins held', fmt(p.coins), `${fmt(p.earnedToday)} earned today`),
      kpiBox('Spent on pets', fmt(p.spent), 'coins'),
      kpiBox('Back-pay given', fmt(p.backpay), 'for chats before the shop'),
      kpiBox('Companion actions', fmt(p.actions), `in the last ${d.days} days`)),
    el('div', { class: 'grid2', style: 'margin-top:14px' }, barsCard('Companions adopted', Object.entries(p.byKind).sort((a, b) => b[1] - a[1]), 'adopted')),
    el('p', { class: 'foot' }, '“Messages to the pet” counts group messages that mention the pet’s name (the text itself is never shown or stored here). Interactions come from the pet menu: feed, play fetch, pet, rename, outfit and cage. Recording of interactions starts with this release.')));
}

// ───── Activity ─────
async function activityPage(kind = '') {
  loading('Loading activity…');
  let d; try { d = await api('/api/admin/activity' + (kind ? '?kind=' + kind : '')); } catch (e) { return fail(e); }
  const filters = el('div', { class: 'chips' }, el('button', { class: 'chip' + (kind ? '' : ' on'), onclick: () => activityPage('') }, 'All'),
    Object.keys(ACT).filter((k) => k !== 'open').map((k) => el('button', { class: 'chip' + (kind === k ? ' on' : ''), onclick: () => activityPage(k) }, `${ACT[k]}${d.counts[k] ? ' · ' + d.counts[k] : ''}`)));
  root.replaceChildren(el('div', { class: 'wrap' }, nav('activity', 'What accounts did · counts are last 7 days'), filters,
    el('div', { class: 'card', style: 'margin-top:14px' }, d.events.length ? el('div', { class: 'timeline' }, d.events.map((t) => el('div', { class: 'ev clickable k-' + t.kind, onclick: () => t.userId && (location.hash = 'user/' + t.userId) }, el('span', { class: 't' }, when(t.at)), el('b', null, t.name), el('span', null, actText(t))))) : el('div', { class: 'empty' }, 'No activity yet — it’s recorded from this release on'))));
}

async function algorithmPage() {
  clearInterval(liveTimer);
  root.replaceChildren(el('div', { class: 'loading' }, 'Loading algorithm performance…'));
  let algo;
  try { algo = await api(`/api/admin/algo?days=${range}`); } catch (e) { if (e.status === 401) return boot(); root.replaceChildren(el('div', { class: 'loading' }, e.message)); return; }
  const seg = el('div', { class: 'seg' }, [7, 30, 90].map((d) => el('button', { class: d === range ? 'on' : '', onclick: () => { range = d; localStorage.setItem('pmAdminRange', d); algorithmPage(); } }, `${d} days`)));
  const kpi = (l, v, s2, cls) => el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), s2 ? el('div', { class: 's' }, s2) : null);
  root.replaceChildren(el('div', { class: 'wrap' },
    nav('algorithm', `How well For You suggestions work · updated ${new Date().toLocaleTimeString()}`, [seg]),
    ...algoSection(algo, kpi),
    el('p', { class: 'foot' }, '“Engaged” = opened, liked, commented, reposted, or read at least 60% of the story. Lift = how much more often people engage with stories picked for them than with trending stories (above 1× means personalisation works). Learning curve = engagement as people see more stories — rising means suggestions get better with use.')));
}

async function dashboard() {
  root.replaceChildren(el('div', { class: 'loading' }, 'Loading dashboard…'));
  const [ov, ts, ret, scr, bz, live, users, algo, errs] = await Promise.all([
    api('/api/admin/overview'), api(`/api/admin/timeseries?days=${range}`), api('/api/admin/retention'),
    api(`/api/admin/screens?days=${range}`), api(`/api/admin/buzz?days=${range}`), api('/api/admin/live'), api('/api/admin/users'), api(`/api/admin/algo?days=${range}`), api('/api/admin/errors'),
  ]).catch((e) => { if (e.status === 401) { boot(); return []; } root.replaceChildren(el('div', { class: 'loading' }, e.message)); return []; });
  if (!ov) return;
  const seg = el('div', { class: 'seg' }, [7, 30, 90].map((d) => el('button', { class: d === range ? 'on' : '', onclick: () => { range = d; localStorage.setItem('pmAdminRange', d); dashboard(); } }, `${d} days`)));
  const kpi = (l, v, s, cls) => el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), s ? el('div', { class: 's' }, s) : null);
  const installed = ov.devices.filter((d) => d.installed).reduce((a, d) => a + d.users, 0);
  const deviceTotal = ov.devices.reduce((a, d) => a + d.users, 0);
  const liveBox = el('div');
  const page = el('div', { class: 'wrap' },
    nav('overview', null, [seg]),
    el('div', { class: 'kpis' },
      kpi('Total users', fmt(ov.totalUsers), `+${fmt(ov.new7d)} in 7 days`),
      kpi('New today', fmt(ov.newToday)),
      kpi('Online now', fmt(ov.onlineNow), 'connected right now', 'live'),
      kpi('Active today', fmt(ov.dau), `${fmt(ov.wau)} this week · ${fmt(ov.mau)} this month`),
      kpi('Stickiness', ov.mau ? Math.round((ov.dau / ov.mau) * 100) + '%' : '—', 'daily ÷ monthly active'),
      kpi('Avg time today', `${ov.avgMinutesToday} min`, 'per active user'),
      kpi('Messages today', fmt(ov.messagesToday), `${fmt(ov.callsToday)} calls`),
      kpi('Buzz today', fmt(ov.buzzUsersToday), `${ov.buzzMinutesToday} min per Buzz user`),
      kpi('Installed app', deviceTotal ? Math.round((installed / deviceTotal) * 100) + '%' : '—', `${fmt(installed)} of ${fmt(deviceTotal)} devices`)),

    el('h2', null, 'Live now', el('small', null, 'refreshes every 10 seconds')),
    el('div', { class: 'card' }, liveBox),

    el('h2', null, 'Growth & activity', el('small', null, `last ${range} days`)),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', null, 'Daily active users'), el('div', { class: 'hint' }, 'People who opened Ping Me that day'), chart(ts.days, [{ key: 'dau', label: 'active users', color: 'var(--accent)' }, { key: 'buzzUsers', label: 'used Buzz', color: 'var(--orange)' }])),
      el('div', { class: 'card' }, el('h3', null, 'New users'), el('div', { class: 'hint' }, 'Sign-ups per day'), chart(ts.days, [{ key: 'newUsers', label: 'new users', color: 'var(--blue)' }], { type: 'bar' })),
      el('div', { class: 'card' }, el('h3', null, 'Messages & calls'), el('div', { class: 'hint' }, 'Sent per day'), chart(ts.days, [{ key: 'messages', label: 'messages', color: 'var(--purple)' }, { key: 'calls', label: 'calls', color: 'var(--accent)' }], { type: 'bar' })),
      el('div', { class: 'card' }, el('h3', null, 'Time spent'), el('div', { class: 'hint' }, 'Average minutes per active user'), chart(ts.days, [{ key: 'avgMinutes', label: 'minutes / user', color: 'var(--pink)' }]))),

    el('h2', null, 'Retention', el('small', null, 'of people who started that week, how many came back')),
    el('div', { class: 'grid2' }, retentionCard('Ping Me (by sign-up week)', ret.app), retentionCard('Buzz (by first Buzz week)', ret.buzz)),

    el('h2', null, 'Where people spend time', el('small', null, `last ${range} days`)),
    el('div', { class: 'grid2' }, screensCard(scr.screens), devicesCard(ov.devices)),

    el('h2', null, 'Buzz', el('small', null, `last ${range} days`)),
    el('div', { class: 'kpis' },
      kpi('Buzz readers', fmt(bz.users)), kpi('Stories seen', fmt(bz.seen)), kpi('Stories opened', fmt(bz.opens), `${bz.ctr}% of seen`),
      kpi('Likes', fmt(bz.likes)), kpi('Comments', fmt(bz.comments)), kpi('Reposts', fmt(bz.reposts))),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Stories opened per day'), chart(ts.days, [{ key: 'buzzOpens', label: 'opens', color: 'var(--orange)' }], { type: 'bar' })),
      barsCard('Cities chosen in Buzz', Object.entries(bz.regions).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]), 'readers'),
      barsCard('Most-opened sources', bz.sources.map((s) => [s.source, s.opens]), 'opens')),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', null, 'Top stories'), el('div', { class: 'hint' }, 'Ranked by opens, comments, reposts and likes'),
      bz.top.length ? el('div', { class: 'tablewrap' }, el('table', null,
        el('tr', null, el('th', null, 'Story'), el('th', null, 'Source'), el('th', { class: 'num' }, 'Opens'), el('th', { class: 'num' }, 'Likes'), el('th', { class: 'num' }, 'Comments'), el('th', { class: 'num' }, 'Reposts')),
        bz.top.map((t) => el('tr', null, el('td', { class: 'title-cell', title: t.title }, t.title), el('td', null, t.source), el('td', { class: 'num' }, fmt(t.opens)), el('td', { class: 'num' }, fmt(t.likes)), el('td', { class: 'num' }, fmt(t.comments)), el('td', { class: 'num' }, fmt(t.reposts))))))
        : el('div', { class: 'empty' }, 'No story activity yet')),

    ...algoSection(algo, kpi),

    el('h2', null, 'App errors', el('small', null, 'crashes on people’s phones · last 14 days')),
    el('div', { class: 'card' }, errs.errors.length ? el('div', { class: 'tablewrap' }, el('table', null,
      el('tr', null, el('th', null, 'Where'), el('th', null, 'Error'), el('th', { class: 'num' }, 'Times'), el('th', { class: 'num' }, 'People'), el('th', null, 'Devices'), el('th', null, 'Last')),
      errs.errors.map((x) => el('tr', { title: x.stack || '' }, el('td', null, el('span', { class: 'chip' }, x.where)), el('td', { class: 'title-cell' }, x.msg), el('td', { class: 'num' }, fmt(x.count)), el('td', { class: 'num' }, fmt(x.users)), el('td', null, x.platforms || '—'), el('td', null, ago(x.last) + ' ago'))))) : el('div', { class: 'empty' }, 'No app errors — everything is running smoothly')),

    el('h2', null, 'Users', el('small', null, 'most recently active first')),
    el('div', { class: 'card' }, el('div', { class: 'tablewrap' }, el('table', null,
      el('tr', null, el('th', null, ''), el('th', null, 'Name'), el('th', null, 'Username'), el('th', null, 'Last active'), el('th', { class: 'num' }, 'Active days (30d)'), el('th', { class: 'num' }, 'Minutes (7d)'), el('th', { class: 'num' }, 'Messages (7d)'), el('th', { class: 'num' }, 'Buzz days'), el('th', null, 'Device')),
      users.users.map((u) => el('tr', null, el('td', null, el('span', { class: 'dot' + (u.online ? '' : ' off'), title: u.online ? 'online' : 'offline' })), el('td', null, u.name), el('td', null, u.username ? '@' + u.username : '—'),
        el('td', null, u.lastActive || '—'), el('td', { class: 'num' }, fmt(u.activeDays30)), el('td', { class: 'num' }, u.minutes7d), el('td', { class: 'num' }, fmt(u.messages7d)), el('td', { class: 'num' }, fmt(u.buzzDays30)),
        el('td', null, `${u.platform}${u.installed ? ' · app' : u.platform !== '—' ? ' · browser' : ''}`)))))),
    el('p', { class: 'foot' }, 'Ping Me records activity only — which screen is open and for how long, app opens, and which Buzz stories were seen or opened. Message text and calls are never recorded. Raw events are kept for 120 days; daily summaries stay.'));
  root.replaceChildren(page);
  renderLive(liveBox, live);
  clearInterval(liveTimer);
  liveTimer = setInterval(async () => { try { renderLive(liveBox, await api('/api/admin/live')); } catch {} }, 10000);
}

// ───── suggestion algorithm ─────
const P = (v) => (v == null ? '—' : v + '%');
const delta = (v) => (v == null ? el('span', { style: 'color:var(--text2)' }, '—') : el('b', { class: v > 0 ? 'up' : v < 0 ? 'down' : '' }, (v > 0 ? '+' : '') + v + ' pts'));
function algoSection(a, kpi) {
  const s = a.summary;
  const liftCls = s.lift == null ? '' : s.lift >= 1.1 ? 'good' : s.lift >= 0.9 ? '' : 'bad';
  return [
    el('h2', null, 'Suggestion algorithm', el('small', null, `how well For You is working · last ${range} days`)),
    el('div', { class: 'card verdict' }, el('h3', null, 'How it’s doing'),
      a.notes.length && s.impressions ? el('ul', null, a.notes.map((t) => el('li', null, t))) : el('div', { class: 'empty' }, 'No Buzz impressions recorded yet — numbers appear once people scroll Buzz on the new version.')),
    el('div', { class: 'kpis', style: 'margin-top:14px' },
      kpi('Engagement rate', P(s.engagedRate), `of ${fmt(s.impressions)} stories seen by ${fmt(s.users)} people`),
      kpi('Personal picks', P(s.personalRate), 'engaged when chosen for the person'),
      kpi('Trending picks', P(s.trendingRate), 'engaged when chosen by popularity'),
      kpi('Personalisation lift', s.lift == null ? '—' : s.lift + '×', 'personal ÷ trending (above 1 = it works)', liftCls),
      kpi('Skip rate', P(s.skipRate), 'flicked past in under a second'),
      kpi('Avg reading', s.avgRead == null ? '—' : s.avgRead + '%', 'of a story’s reading time'),
      kpi('Repeats', fmt(s.repeats), s.repeats ? `${s.repeatRate}% shown twice` : 'no story shown twice', s.repeats ? 'bad' : 'good'),
      kpi('Learn from chats', fmt(s.chatOptIn), 'people opted in')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Engagement per day'), el('div', { class: 'hint' }, '% of seen stories people engaged with (opened, liked, commented, reposted or read 60%+)'),
        chart(a.daily, [{ key: 'personal', label: 'personal picks %', color: 'var(--accent)' }, { key: 'trending', label: 'trending picks %', color: 'var(--orange)' }, { key: 'skip', label: 'skip %', color: 'var(--pink)' }])),
      el('div', { class: 'card' }, el('h3', null, 'Learning curve'), el('div', { class: 'hint' }, 'Engagement by how many stories a person has already seen — rising bars mean suggestions get better the more someone uses Buzz'),
        a.curve.length ? curveBars(a.curve) : el('div', { class: 'empty' }, 'Not enough data yet'))),
    el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', null, 'Each part of the algorithm'), el('div', { class: 'hint' }, 'Every story is chosen by one part; this is how each part performs'),
      a.slots.length ? el('div', { class: 'tablewrap' }, el('table', null,
        el('tr', null, el('th', null, 'Part'), el('th', { class: 'num' }, 'Share of feed'), el('th', { class: 'num' }, 'Seen'), el('th', { class: 'num' }, 'Engaged'), el('th', { class: 'num' }, 'Opened'), el('th', { class: 'num' }, 'Liked'), el('th', { class: 'num' }, 'Skipped'), el('th', { class: 'num' }, 'Avg reading')),
        a.slots.map((r) => el('tr', null, el('td', null, r.name), el('td', { class: 'num' }, P(r.share)), el('td', { class: 'num' }, fmt(r.impressions)), el('td', { class: 'num' }, heat(r.engagedRate == null ? null : Math.round(r.engagedRate))), el('td', { class: 'num' }, P(r.openRate)), el('td', { class: 'num' }, P(r.likeRate)), el('td', { class: 'num' }, P(r.skipRate)), el('td', { class: 'num' }, r.avgRead == null ? '—' : r.avgRead + '%')))))
        : el('div', { class: 'empty' }, 'No data yet')),
    el('div', { class: 'grid2', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h3', null, 'Topics: shown vs loved'), el('div', { class: 'hint' }, 'If a topic’s share of engagement is bigger than its share of the feed, people want more of it'),
        a.topics.length ? el('div', { class: 'tablewrap' }, el('table', null,
          el('tr', null, el('th', null, 'Topic'), el('th', { class: 'num' }, 'Share shown'), el('th', { class: 'num' }, 'Share engaged'), el('th', { class: 'num' }, 'Engaged')),
          a.topics.map((t) => el('tr', null, el('td', null, t.topic[0].toUpperCase() + t.topic.slice(1)), el('td', { class: 'num' }, P(t.share)), el('td', { class: 'num' }, el('b', { class: t.engagedShare > t.share + 2 ? 'up' : t.engagedShare < t.share - 2 ? 'down' : '' }, P(t.engagedShare))), el('td', { class: 'num' }, P(t.engagedRate))))))
          : el('div', { class: 'empty' }, 'No data yet')),
      el('div', { class: 'card' }, el('h3', null, 'Per person'), el('div', { class: 'hint' }, 'Engagement in their first 50 stories vs their latest 50'),
        a.users.length ? el('div', { class: 'tablewrap' }, el('table', null,
          el('tr', null, el('th', null, 'Person'), el('th', { class: 'num' }, 'Seen'), el('th', { class: 'num' }, 'Engaged'), el('th', { class: 'num' }, 'First → latest'), el('th', null, 'Loves')),
          a.users.map((u) => el('tr', null, el('td', null, u.name), el('td', { class: 'num' }, fmt(u.impressions)), el('td', { class: 'num' }, P(u.engagedRate)),
            el('td', { class: 'num' }, u.early == null ? el('span', { style: 'color:var(--text2)' }, 'needs 60+') : el('span', null, `${u.early}% → ${u.recent}% `, delta(u.change))), el('td', null, u.loves.join(', ') || '—')))))
          : el('div', { class: 'empty' }, 'No data yet'))),
  ];
}
function curveBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.engagedRate || 0));
  return el('div', { class: 'bars', style: 'margin-top:10px' }, rows.map((r) => el('div', { class: 'bar' }, el('span', null, r.bucket),
    el('div', { class: 'track' }, el('i', { style: `width:${((r.engagedRate || 0) / max) * 100}%` })), el('span', { class: 'val', title: `${r.users} people · ${r.impressions} stories · skip ${r.skipRate}%` }, P(r.engagedRate)))));
}

function renderLive(box, live) {
  const chips = Object.entries(live.screens).sort((a, b) => b[1] - a[1]).map(([s, c]) => el('span', { class: 'chip s-' + s }, `${SCREEN_NAMES[s] || s} · ${c}`));
  box.replaceChildren(
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' }, chips.length ? chips : el('span', { class: 'empty', style: 'padding:0' }, 'Nobody online right now')),
    live.online.length ? el('div', { class: 'tablewrap' }, el('table', null,
      el('tr', null, el('th', null, 'Name'), el('th', null, 'Screen'), el('th', null, 'Device'), el('th', { class: 'num' }, 'On this screen')),
      live.online.map((u) => el('tr', null, el('td', null, el('b', null, u.name), u.username ? el('span', { style: 'color:var(--text2)' }, ' @' + u.username) : null),
        el('td', null, el('span', { class: 'chip s-' + u.screen }, SCREEN_NAMES[u.screen] || u.screen)),
        el('td', null, `${u.platform}${u.installed ? ' · app' : ' · browser'}`), el('td', { class: 'num' }, ago(u.screenAt)))))) : null);
}

function retentionCard(title, rows) {
  return el('div', { class: 'card' }, el('h3', null, title), el('div', { class: 'hint' }, 'Day 1 · days 7–13 · days 30–36'),
    rows.length ? el('div', { class: 'tablewrap' }, el('table', null,
      el('tr', null, el('th', null, 'Week of'), el('th', { class: 'num' }, 'People'), el('th', { class: 'num' }, 'Day 1'), el('th', { class: 'num' }, 'Week 2'), el('th', { class: 'num' }, 'Month 2')),
      rows.map((r) => el('tr', null, el('td', null, new Date(r.week + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })), el('td', { class: 'num' }, fmt(r.size)), el('td', { class: 'num' }, heat(r.d1)), el('td', { class: 'num' }, heat(r.d7)), el('td', { class: 'num' }, heat(r.d30)))))) : el('div', { class: 'empty' }, 'Not enough data yet'));
}

function screensCard(screens) {
  const max = Math.max(1, ...screens.map((s) => s.minutes));
  return el('div', { class: 'card' }, el('h3', null, 'Time by screen'), el('div', { class: 'hint' }, 'Total minutes · people · average per person'),
    screens.length ? el('div', { class: 'bars' }, screens.map((s) => el('div', { class: 'bar' }, el('span', null, SCREEN_NAMES[s.screen] || s.screen),
      el('div', { class: 'track' }, el('i', { style: `width:${(s.minutes / max) * 100}%` })), el('span', { class: 'val', title: `${s.users} people · ${s.avgMinutesPerUser} min each` }, `${s.minutes} min`))))
      : el('div', { class: 'empty' }, 'No screen time recorded yet'),
    screens.length ? el('div', { class: 'tablewrap', style: 'margin-top:12px' }, el('table', null, el('tr', null, el('th', null, 'Screen'), el('th', { class: 'num' }, 'People'), el('th', { class: 'num' }, 'Visits'), el('th', { class: 'num' }, 'Min / person')),
      screens.map((s) => el('tr', null, el('td', null, SCREEN_NAMES[s.screen] || s.screen), el('td', { class: 'num' }, fmt(s.users)), el('td', { class: 'num' }, fmt(s.visits)), el('td', { class: 'num' }, s.avgMinutesPerUser))))) : null);
}

function devicesCard(devices) {
  const rows = {};
  for (const d of devices) { rows[d.platform] = rows[d.platform] || { app: 0, browser: 0 }; rows[d.platform][d.installed ? 'app' : 'browser'] += d.users; }
  const names = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer', other: 'Other' };
  return barsCard('Devices', Object.entries(rows).map(([k, v]) => [`${names[k] || k}`, v.app + v.browser, `${v.app} app · ${v.browser} browser`]), 'people');
}

function barsCard(title, items, unit) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return el('div', { class: 'card' }, el('h3', null, title),
    items.length ? el('div', { class: 'bars', style: 'margin-top:10px' }, items.map(([k, v, note]) => el('div', { class: 'bar' }, el('span', { title: k, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, k),
      el('div', { class: 'track' }, el('i', { style: `width:${(v / max) * 100}%` })), el('span', { class: 'val', title: note || '' }, `${fmt(v)} ${unit}`))))
      : el('div', { class: 'empty' }, 'No data yet'));
}

boot();
