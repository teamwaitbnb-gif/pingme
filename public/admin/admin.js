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
const ago = (t) => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
let range = Number(localStorage.getItem('pmAdminRange') || 30), liveTimer = null;

// ───── login ─────
async function boot() {
  const me = await api('/api/admin/me').catch(() => ({ admin: false, configured: false }));
  if (me.admin) return dashboard();
  const input = el('input', { type: 'password', placeholder: 'Admin key', autocomplete: 'current-password', autofocus: 'true' });
  const err = el('div', { class: 'err' }, me.configured ? '' : 'The admin key isn’t set up on the server yet (ADMIN_KEY in .env).');
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ key: input.value.trim() }) }); dashboard(); }
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
    el('header', { class: 'top' }, el('img', { src: '/icons/icon-192.png', alt: '' }), el('div', null, el('h1', null, 'Ping Me Admin'), el('div', { class: 'sub' }, `Updated ${new Date().toLocaleTimeString()} · India time`)),
      el('div', { class: 'spacer' }), seg, el('button', { class: 'btn-ghost', onclick: dashboard }, 'Refresh'),
      el('button', { class: 'btn-ghost', onclick: async () => { await api('/api/admin/logout', { method: 'POST' }); boot(); } }, 'Lock')),
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
