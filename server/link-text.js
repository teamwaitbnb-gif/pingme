// Text decoding and URL normalization for chat link previews.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', rupee: '₹' };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
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
module.exports = { decode, httpUrl };
