// Small DOM + UI toolkit shared by the app (no framework, no build step).

// Let append()/replaceChildren() skip null/undefined/false so optional UI pieces can be
// written inline (`cond ? el : null`) without rendering the text "null".
for (const name of ['append', 'replaceChildren', 'prepend']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...nodes) {
    return orig.apply(this, nodes.filter((n) => n !== null && n !== undefined && n !== false));
  };
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  xc: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M15 9l-6 6M9 9l6 6" stroke="var(--bg)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0014 0v-1M12 18v4"/>',
  micoff: '<path d="M2 2l20 20"/><path d="M9 9v2a3 3 0 005.1 2.1M15 9.3V5a3 3 0 00-5.9-.7"/><path d="M17 16.9A7 7 0 015 11v-1M19 10v1c0 .8-.1 1.5-.4 2.2M12 18v4"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3z"/>',
  videooff: '<path d="M2 2l20 20"/><path d="M16 16v1a1 1 0 01-1 1H4a2 2 0 01-2-2V8a2 2 0 012-2h2M10 6h5a1 1 0 011 1v3.3l1 1 4-3.3v10"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>',
  phoneoff: '<path d="M10.7 13.3a16 16 0 003.4 2.6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1M5.2 13.4A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8"/><path d="M23 1L1 23"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  edit: '<path d="M17 3a2.8 2.8 0 014 4L7.5 20.5 2 22l1.5-5.5z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
  fwd: '<path d="M15 17l5-5-5-5"/><path d="M4 18v-2a4 4 0 014-4h12"/>',
  pin: '<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z"/>',
  bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
  belloff: '<path d="M13.7 21a2 2 0 01-3.4 0M18.6 13A17.9 17.9 0 0118 8M6.3 6.3A5.9 5.9 0 006 8c0 7-3 9-3 9h14M18 8a6 6 0 00-9.3-5M1 1l22 22"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  map: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  poll: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  useradd: '<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
  archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  share: '<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  iosshare: '<path d="M8 8H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2h-2M16 5l-4-4-4 4M12 1v14"/>',
  addsq: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  dots: '<circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/><circle cx="5" cy="12" r="1.3"/>',
  dotsv: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  flip: '<path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2M14 9v2h-2M10 17v-2h2"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  min: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1"/>',
  speaker: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  scan: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 000 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2a5.6 5.6 0 005.5-5.5C22 6 17.5 2 12 2z"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  speak: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  vol: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M19 5a10 10 0 010 14"/>',
  unread: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  msg: '<path d="M21 11.5a8.4 8.4 0 01-9 8.5 9 9 0 01-4-.9L3 21l1.9-5A8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z"/>',
  shieldcheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10"/>',
  alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3L2 6M22 6l-3-3"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h13l-2.5 4L17 12H4"/>',
  badgecheck: '<circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.8 2.8L16 9.5"/>',
  note: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  whisper: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M2 9v4M22 9v4"/>',
  rewind: '<path d="M11 19l-9-7 9-7v14zM22 19l-9-7 9-7v14z"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1v-6h3zM3 19a2 2 0 002 2h1v-6H3z"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M4.9 4.9l4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  paw: '<circle cx="11" cy="4.5" r="2"/><circle cx="18" cy="8.5" r="2"/><circle cx="4" cy="8.5" r="2"/><path d="M8 15c0-2.2 1.8-4.5 4-4.5s4 2.3 4 4.5c0 1 1 2 1.8 3 .9 1.3 0 3.5-1.8 3.5-1 0-2-.5-4-.5s-3 .5-4 .5c-1.8 0-2.7-2.2-1.8-3.5C7 17 8 16 8 15z"/>',
  gift: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>',
  scale: '<path d="M12 3v18M7 21h10M4 7h16"/><path d="M7 7l-3 7a3 3 0 006 0zM17 7l-3 7a3 3 0 006 0z"/>',
  camcheck: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><path d="M9 13.5l2 2 4-4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  presence: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
  cloud: '<path d="M18 10h-1.3A8 8 0 109 20h9a5 5 0 000-10z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><path d="M7 7h.01"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-.5 2-1.5 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5H3v8h4c0 4-2 5-4 5M14 21c3 0 7-1 7-8V5h-7v8h4c0 4-2 5-4 5"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  bubbles: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  hand: '<path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8"/><path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 012.8-2.8L6 14"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───── formatting ─────

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  if (sameDay(d, n)) return fmtTime(ts);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  if (n - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export function fmtDay(ts) {
  const d = new Date(ts), n = new Date();
  const time = fmtTime(ts);
  if (sameDay(d, n)) return `<b>Today</b> ${time}`;
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return `<b>Yesterday</b> ${time}`;
  if (n - d < 6 * 86400000) return `<b>${d.toLocaleDateString([], { weekday: 'long' })}</b> ${time}`;
  return `<b>${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' })}</b> ${time}`;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
}

export function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function lastSeenText(u) {
  if (!u) return '';
  if (u.online) return 'Online';
  if (!u.lastSeen) return '';
  const diff = Date.now() - u.lastSeen;
  if (diff < 60000) return 'Last seen just now';
  if (diff < 3600000) return `Last seen ${Math.floor(diff / 60000)}m ago`;
  const d = new Date(u.lastSeen);
  if (sameDay(d, new Date())) return `Last seen today at ${fmtTime(u.lastSeen)}`;
  return `Last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${fmtTime(u.lastSeen)}`;
}

export function disappearLabel(s) {
  return { [-1]: 'After read', 0: 'Off', 30: '30 seconds', 300: '5 minutes', 3600: '1 hour', 86400: '24 hours', 604800: '7 days', 7776000: '90 days' }[s] || 'Off';
}

const EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}])*|[\u{1F1E6}-\u{1F1FF}]{2}|\s)+$/u;
export function emojiCount(text) {
  if (!text || text.length > 40 || !EMOJI_RE.test(text)) return 0;
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(text.replace(/\s/g, ''))].length : text.length / 2;
  return seg <= 3 ? seg : 0;
}

// Safe rich text: escape first, then apply light formatting.
export function richText(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```([\s\S]+?)```/g, (_, c) => { blocks.push(`<pre>${c.replace(/^\n/, '')}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { blocks.push(`<code>${c}</code>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?])/g, '$1<b>$2</b>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?])/g, '$1<s>$2</s>');
  s = s.replace(/(^|\s)(@[a-z0-9_.]{3,24})/gi, '$1<span class="mention">$2</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
  return s;
}

// ───── avatars ─────

const GRADS = [
  ['#ff9a8b', '#ff6a88'], ['#7f7fd5', '#5b6cf9'], ['#43cea2', '#185a9d'], ['#f7971e', '#ffd200'],
  ['#ee9ca7', '#c85a8a'], ['#56ccf2', '#2f80ed'], ['#a8e063', '#56ab2f'], ['#c471f5', '#fa71cd'],
];

export function initials(name) {
  const all = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const words = all.filter((p) => /^[\p{L}\p{N}]/u.test(p));
  const parts = words.length ? words : all;
  const chars = parts.length > 1 ? [parts[0], parts[parts.length - 1]].map((p) => [...p][0]) : [...(parts[0] || '?')].slice(0, 1);
  return chars.join('').toUpperCase();
}

export function avatar({ id = 0, name = '', src = null, size = 44, online = false, group = false, zoom = false } = {}) {
  const el = h('div', { class: 'av' + (group ? ' av-group' : ''), style: { '--s': size + 'px' } });
  // zoom: tapping the photo opens it full screen (like WhatsApp / iMessage).
  if (zoom && src) {
    el.classList.add('av-zoom');
    el.addEventListener('click', (e) => { if (!el.querySelector('img')) return; e.stopPropagation(); e.preventDefault(); viewPhoto(src, name); });
  }
  if (!src) {
    const g = GRADS[Math.abs(Number(id) || 0) % GRADS.length];
    el.style.background = `linear-gradient(180deg, ${g[0]}, ${g[1]})`;
  }
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
    img.onerror = () => { img.remove(); el.textContent = group ? '' : initials(name); if (group) el.append(icon('users')); };
    el.append(img);
  } else if (group && !name) el.append(icon('users'));
  else el.textContent = initials(name);
  if (!online) return el;
  return h('div', { class: 'av-wrap' }, el, h('span', { class: 'dot' }));
}

// Full-screen profile photo. Back / tap / swipe down closes it.
export function viewPhoto(src, name = '') {
  const img = h('img', { src, alt: name });
  let startY = null;
  const close = () => { unregister(); root.classList.add('out'); setTimeout(() => root.remove(), 180); };
  const root = h('div', { class: 'photo-view', role: 'dialog', 'aria-label': name || 'Photo', onclick: close },
    h('div', { class: 'pv-top' }, h('button', { class: 'pv-x', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); close(); } }, icon('x')), h('b', null, name)),
    img);
  root.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchmove', (e) => { if (startY !== null) img.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - startY)}px)`; }, { passive: true });
  root.addEventListener('touchend', (e) => { const dy = (e.changedTouches[0]?.clientY || 0) - (startY ?? 0); startY = null; if (dy > 90) close(); else img.style.transform = ''; });
  const unregister = registerLayer(close);
  document.body.append(root);
}

// ───── toasts ─────

export function toast(msg, { error = false, timeout = 3200, onClick, node } = {}) {
  const t = h('div', { class: 'toast' + (error ? ' err' : '') }, node || msg);
  const close = () => { t.style.transition = 'opacity .25s, transform .25s'; t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 260); };
  t.onclick = () => { onClick?.(); close(); };
  document.getElementById('toasts').append(t);
  setTimeout(close, timeout);
  return close;
}

// ───── layers: sheets, action sheets, dialogs ─────

const layer = () => document.getElementById('layer');
// Every open sheet / menu / viewer gets its own history entry, so the phone's Back button (or swipe
// back) closes just that layer — never the whole app.
const stack = [];
let popping = false;   // closing because the user pressed Back (entry already gone)
let skipPops = 0;      // Back steps we triggered ourselves after closing a layer from the UI
const settled = [];

export function closeTop() {
  const top = stack[stack.length - 1];
  if (top) { top.closer(); return true; }
  return false;
}

// Called from the app's popstate handler. Returns true if a layer handled this Back press.
export function handleLayerPop() {
  if (skipPops > 0) {
    skipPops--;
    if (!skipPops) settled.splice(0).forEach((fn) => fn());
    return true;
  }
  const top = stack[stack.length - 1];
  if (!top) return false;
  popping = true;
  try { top.closer(); } finally { popping = false; }
  return true;
}

// Run fn once our own history.back() calls have landed (avoids racing with pushState).
export function whenHistorySettled(fn) { if (!skipPops) fn(); else settled.push(fn); }

export function registerLayer(closer) { return pushLayer(closer); }

function pushLayer(closer) {
  const entry = { closer, pushed: false };
  stack.push(entry);
  try { history.pushState({ pmLayer: stack.length }, ''); entry.pushed = true; } catch {}
  return () => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    if (entry.pushed && !popping) { skipPops++; history.back(); }
  };
}

export function openSheet({ title = '', left, right, body, full = false, onClose, className = '' } = {}) {
  const bd = h('div', { class: 'backdrop' });
  const bodyEl = h('div', { class: 'sheet-body' });
  const leftBtn = h('button', { class: 'hb' }, left?.label ?? 'Close');
  const rightBtn = h('button', { class: 'hb r' }, right?.label ?? '');
  const titleEl = h('h2', null, title);
  const sheet = h('div', { class: `sheet ${full ? 'full' : ''} ${className}`, role: 'dialog', 'aria-label': title },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' }, leftBtn, titleEl, rightBtn),
    bodyEl);
  let closed = false;
  const unregister = pushLayer(() => close());
  function close() {
    if (closed) return;
    closed = true;
    unregister();
    sheet.style.transition = 'transform .25s ease, opacity .25s';
    sheet.style.transform = matchMedia('(min-width: 761px)').matches ? 'translate(-50%, 50%) scale(.96)' : 'translateY(100%)';
    sheet.style.opacity = matchMedia('(min-width: 761px)').matches ? '0' : '1';
    bd.style.transition = 'opacity .25s'; bd.style.opacity = '0';
    setTimeout(() => { sheet.remove(); bd.remove(); }, 260);
    onClose?.();
  }
  leftBtn.onclick = () => (left?.onClick ? left.onClick(close) : close());
  if (right) rightBtn.onclick = () => right.onClick(close); else rightBtn.style.visibility = 'hidden';
  bd.onclick = close;
  // Swipe down on the header to dismiss (mobile).
  let sy = null;
  sheet.querySelector('.sheet-head').addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  sheet.querySelector('.sheet-head').addEventListener('touchmove', (e) => {
    if (sy === null) return; const dy = e.touches[0].clientY - sy;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.querySelector('.sheet-head').addEventListener('touchend', (e) => {
    const dy = (e.changedTouches[0].clientY - (sy ?? 0)); sy = null;
    if (dy > 90) close(); else sheet.style.transform = '';
  });
  if (body) append(bodyEl, [typeof body === 'function' ? body(close) : body]);
  layer().append(bd, sheet);
  return { close, sheet, body: bodyEl, setTitle: (t) => { titleEl.textContent = t; }, rightBtn, leftBtn };
}

export function actionSheet({ title, actions, align = 'center' }) {
  return new Promise((resolve) => {
    const bd = h('div', { class: 'backdrop' });
    let done = false;
    const unregister = pushLayer(() => finish(null));
    const finish = (val) => {
      if (done) return; done = true; unregister();
      wrap.style.transition = 'transform .22s, opacity .22s'; wrap.style.transform = 'translateY(30px)'; wrap.style.opacity = '0';
      bd.style.transition = 'opacity .22s'; bd.style.opacity = '0';
      setTimeout(() => { wrap.remove(); bd.remove(); }, 230);
      resolve(val);
    };
    const wrap = h('div', { class: 'actions' + (align === 'left' ? ' left' : '') },
      h('div', { class: 'grp' },
        title ? h('div', { class: 'ttl' }, title) : null,
        actions.filter(Boolean).map((a) => h('button', {
          class: a.danger ? 'danger' : '',
          onclick: () => { finish(a.value ?? a.label); a.onClick?.(); },
        }, a.icon ? icon(a.icon) : null, a.label))),
      h('div', { class: 'grp' }, h('button', { class: 'cancel', onclick: () => finish(null) }, 'Cancel')));
    bd.onclick = () => finish(null);
    layer().append(bd, wrap);
  });
}

export async function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  const r = await actionSheet({ title: message, actions: [{ label: ok, danger, value: 'ok' }] });
  return r === 'ok';
}

export function promptDialog({ title, value = '', placeholder = '', type = 'text', ok = 'Done', multiline = false, maxlength = 200, note = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = multiline
      ? h('textarea', { class: 'field', placeholder, maxlength, rows: 3 })
      : h('input', { class: 'field', type, placeholder, maxlength, autocomplete: type === 'password' ? 'current-password' : 'off' });
    input.value = value;
    const s = openSheet({
      title,
      left: { label: 'Cancel' },
      right: { label: ok, onClick: (close) => { result = input.value; close(); } },
      body: h('div', null, input, note ? h('p', { class: 'muted small' }, note) : null),
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { result = input.value; s.close(); } });
    setTimeout(() => input.focus(), 320);
  });
}

export function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.onchange = () => onChange(input.checked, input);
  return h('label', { class: 'toggle', onclick: (e) => e.stopPropagation() }, input, h('span'));
}

export function cell({ icon: ic, iconHtml, color, label, sub, value, chevron = false, onClick, danger, accent, right, cls = '' }) {
  const hasIcon = ic || iconHtml;
  return h('button', { class: `cell ${hasIcon ? 'ic' : ''} ${danger ? 'danger' : ''} ${accent ? 'accent' : ''} ${cls}`, onclick: onClick, type: 'button' },
    iconHtml ? h('span', { class: 'ci', style: color ? { background: color } : null, html: iconHtml })
      : ic ? h('span', { class: 'ci', style: color ? { background: color } : null }, icon(ic)) : null,
    h('span', { class: 'lb' }, label, sub ? h('small', null, sub) : null),
    value !== undefined ? h('span', { class: 'val' }, value, chevron ? icon('chev') : null) : chevron ? h('span', { class: 'val' }, icon('chev')) : null,
    right || null);
}

export function longPress(el, fn, ms = 420) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('touchstart', (e) => {
    fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    t = setTimeout(() => { fired = true; navigator.vibrate?.(10); fn(e); }, ms);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) clearTimeout(t);
  }, { passive: true });
  el.addEventListener('touchend', (e) => { clearTimeout(t); if (fired) { e.preventDefault(); } });
  el.addEventListener('touchcancel', () => clearTimeout(t));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(t);
    // Some Android browsers fire contextmenu before our timer — make sure fn runs exactly once.
    if (!fired) { fired = true; fn(e); }
    setTimeout(() => { fired = false; }, 600);
  });
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isMobile = () => isIOS() || isAndroid() || matchMedia('(pointer: coarse)').matches;
// Launched from the home screen? Covers installed apps (standalone/fullscreen/minimal-ui), iOS,
// Android TWA, and plain home-screen shortcuts (which open start_url with ?source=homescreen).
export const isStandalone = () =>
  ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia(`(display-mode: ${m})`).matches)
  || navigator.standalone === true
  || document.referrer.startsWith('android-app://')
  || new URLSearchParams(location.search).get('source') === 'homescreen'
  || sessionStorage.getItem('pm:homescreen') === '1';
// Remember a home-screen launch for the rest of this session (the URL is cleaned up later).
if (new URLSearchParams(location.search).get('source') === 'homescreen') { try { sessionStorage.setItem('pm:homescreen', '1'); localStorage.setItem('mm:installed', 'true'); } catch {} }
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) { try { localStorage.setItem('mm:installed', 'true'); } catch {} }

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mm:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mm:' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('mm:' + k); } catch {} },
};
