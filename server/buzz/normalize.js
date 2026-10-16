// One story format for every source. Missing fields stay missing — nothing is invented.
const crypto = require('crypto');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', rupee: '₹' };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

// Plain text only (the client renders it as text, never HTML).
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = v['#text'] ?? v.__cdata ?? '';
  let s = String(v);
  for (let i = 0; i < 2 && /&(lt|gt|amp|#\d+);/.test(s); i++) s = decode(s); // some feeds double-escape
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decode(s).replace(/\s+/g, ' ').trim();
}

const BOILER = [/The post .{0,200} appeared first on .{0,120}\.?$/i, /Continue reading\.{0,3}$/i, /Read more\.{0,3}$/i, /\[(…|\.\.\.)\]$/, /Comments$/, /…\s*$/];

// A readable summary: 2–3 complete sentences from the publisher's own description (≈ 200–380 chars).
function summarize(desc, title) {
  let s = text(desc);
  for (const re of BOILER) s = s.replace(re, '').trim();
  if (!s || s.length < 25) return null;
  const t = text(title).toLowerCase();
  if (t && s.toLowerCase().startsWith(t) && s.length - t.length < 25) return null; // just repeats the headline
  if (s.length <= 380) return s;
  const sentences = s.match(/[^.!?।]+[.!?।]+["’”)]?\s*/g) || [s];
  let out = '';
  for (const x of sentences) { if ((out + x).length > 380 && out.length >= 140) break; out += x; }
  if (out.length < 80) out = s.slice(0, 360).replace(/\s+\S*$/, '') + '…';
  return out.trim();
}

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|ito|_ga|yclid|spm|from|ocid|taid|src|source|smid|CMP|at_medium|at_campaign)$/i;
function canonical(raw, base) {
  try {
    const u = new URL(String(raw).trim(), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\?$/, '');
  } catch { return null; }
}
const httpUrl = (raw, base) => { const c = canonical(raw, base); return c && c.length <= 1000 ? c : null; };
const idFor = (url) => crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);

function date(v) {
  const s = text(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return t > Date.now() + 3600000 ? null : t; // never accept dates in the future
}

module.exports = { text, summarize, canonical, httpUrl, idFor, date, decode };
