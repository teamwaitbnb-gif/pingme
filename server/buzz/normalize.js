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
function summarize(desc, title, max = 380) {
  let s = text(desc);
  for (const re of BOILER) s = s.replace(re, '').trim();
  if (!s || s.length < 25) return null;
  const t = text(title).toLowerCase();
  if (t && s.toLowerCase().startsWith(t) && s.length - t.length < 25) return null; // just repeats the headline
  if (s.length <= max) return s;
  const sentences = s.match(/[^.!?।]+[.!?।]+["’”)]?\s*/g) || [s];
  let out = '';
  for (const x of sentences) { if ((out + x).length > max && out.length >= 140) break; out += x; }
  if (out.length < 80) out = s.slice(0, max - 20).replace(/\s+\S*$/, '') + '…';
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

// ───── HD images ─────
// Ask publishers' image servers for a large version where their URL scheme allows it.
function upgradeImage(u) {
  if (!u) return u;
  let x = u.replace(/^http:\/\//i, 'https://');
  x = x.replace(/(ichef\.bbci\.co\.uk\/(?:ace|news)\/(?:standard|ws)\/)\d{2,4}\//i, '$11024/');           // BBC
  x = x.replace(/\/alternates\/(LANDSCAPE|SQUARE|PORTRAIT|FREE)_\d{2,4}\//i, '/alternates/$1_1200/');      // The Hindu
  x = x.replace(/(static\.toiimg\.com\/thumb\/[^/]*?)width-\d+,height-\d+/i, '$1width-1200,height-675');  // Times of India
  x = x.replace(/(img\.etimg\.com\/thumb\/[^/]*?)width-\d+,height-\d+/i, '$1width-1200,height-675');      // ET
  // WordPress resized copies ("photo-768x450.jpg") → the original upload.
  if (/\/wp-content\/uploads\//.test(x)) x = x.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?|$)/i, '$1$2');
  return x;
}

// Small or placeholder images that should be replaced by the article's own share image.
function lowRes(u) {
  if (!u) return true;
  if (/^http:\/\//i.test(u)) return true;                       // phones block insecure images
  if (/(encrypted-tbn\d*\.gstatic\.com|\/thumb\/|thumbnail|_thumb|-150x|-300x|default|placeholder|og-image|newmintdefault|logo|android-chrome|apple-touch|favicon)/i.test(u)) return true;
  const m = /[?&](?:w|width|resize|s)=(\d{2,4})/i.exec(u) || /[_/-](\d{2,3})x\d{2,3}[._/-]/.exec(u) || /\/standard\/(\d{2,3})\//.exec(u);
  return !!m && Number(m[1]) < 700;
}

// The article's own opening paragraphs (a fuller summary than most feeds give): first real paragraphs
// of the story body, skipping bylines, "also read", subscription prompts and ads.
const BOILERPLATE = /(subscribe|sign up|sign in|log in|download the app|follow us|click here|also read|read more|read also|advertisement|©|copyright|all rights reserved|cookie|newsletter|whatsapp channel|join our|for more updates|updated on|published on|trending now|watch:|recommended|catch all the|first published|disclaimer|subscription|premium stories|unlock these)/i;
function leadParagraphs(html, title, max = 560) {
  let body = String(html);
  const art = /<article[\s\S]*?<\/article>/i.exec(body);
  if (art && art[0].length > 800) body = art[0];
  body = body.replace(/<(script|style|nav|aside|footer|header|figure|figcaption|form|noscript|button)[\s\S]*?<\/\1>/gi, ' ');
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body)) && paras.length < 12) {
    const t = text(m[1]);
    if (t.length < 70 || BOILERPLATE.test(t) || /^[^a-z]*$/.test(t) || t.split(' ').length < 12) continue;
    // Skip a paragraph that mostly repeats one already taken (standfirst + first paragraph).
    const words = new Set(t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
    if (paras.some((p) => { const w = new Set(p.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []); let n = 0; for (const x of words) if (w.has(x)) n++; return n / Math.max(1, Math.min(words.size, w.size)) > 0.55; })) continue;
    paras.push(t);
    if (paras.join(' ').length > max * 1.4) break;
  }
  if (!paras.length) return null;
  return summarize(paras.join(' '), title, max);
}

// The story body as plain text (for the AI description): the article's real paragraphs, in order.
function articleText(html, max = 4000) {
  let body = String(html);
  const art = /<article[\s\S]*?<\/article>/i.exec(body);
  if (art && art[0].length > 800) body = art[0];
  body = body.replace(/<(script|style|nav|aside|footer|header|figure|figcaption|form|noscript|button)[\s\S]*?<\/\1>/gi, ' ');
  const out = [];
  let len = 0;
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body)) && len < max) {
    const t = text(m[1]);
    if (t.length < 50 || BOILERPLATE.test(t) || t.split(' ').length < 9 || out.includes(t)) continue;
    out.push(t); len += t.length + 1;
  }
  return out.join('\n').slice(0, max) || null;
}

module.exports = { text, summarize, canonical, httpUrl, idFor, date, decode, upgradeImage, lowRes, leadParagraphs, articleText };
