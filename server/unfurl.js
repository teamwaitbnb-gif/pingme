// Link previews for links shared in chats: title, description, picture and site name, read by our
// server (never by the recipient's phone, so a link can't reveal their IP address). Pictures are
// served through a signed proxy. Every fetch goes through the Buzz collector's safeGet: public
// addresses only, size and redirect caps, short timeouts.
const net = require('net');
const dns = require('dns').promises;
const { safeGet } = require('./buzz/collect');
const N = require('./buzz/normalize');
const { byId } = require('./buzz/sources');

const PAGE_BYTES = 1200 * 1024; // safeGet keeps the first part of a larger page instead of failing
const IMG_BYTES = 4 * 1024 * 1024;
const TTL = 12 * 3600e3, FAIL_TTL = 15 * 60e3, MAX_CACHE = 2000;
// Many sites (BookMyShow, District, Instagram…) only give their preview tags to link-preview bots.
const UA_BOT = 'WhatsApp/2.24.6.77 A';
const UA_BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IMG_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/i;

const clip = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || null; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// <meta> tags in any attribute order → { 'og:title': '…', … } (first value wins).
function parseMeta(html) {
  const head = html.slice(0, 400000);
  const out = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/\bcontent\s*=\s*"([^"]*)"/i.exec(tag) || /\bcontent\s*=\s*'([^']*)'/i.exec(tag) || [])[1];
    if (key && val != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = N.decode(val).trim();
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (t) out._title = N.decode(t[1]).trim();
  return out;
}

function fromMeta(meta, url) {
  const title = meta['og:title'] || meta['twitter:title'] || meta._title;
  return {
    title: clip(title, 160),
    description: clip(meta['og:description'] || meta['twitter:description'] || meta.description, 220),
    image: imgUrl(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'], url),
    site: clip(meta['og:site_name'] || meta['application-name'], 40) || hostOf(url),
  };
}

// Resolve a picture address; an empty value must stay empty (not become the page itself).
const imgUrl = (raw, base) => (raw && String(raw).trim() ? N.httpUrl(String(raw).trim(), base) : null);

// Sites that hide their preview tags from servers: a readable title from the address itself
// (".../movies/kalki-2898-ad/ET00352941" → "Kalki 2898 Ad").
function titleFromPath(url) {
  try {
    const segs = new URL(url).pathname.split('/').map((x) => decodeURIComponent(x)).filter((x) => /[a-z]{3}/i.test(x) && /[-_ ]/.test(x) && !/^(explore|home|buytickets|movies|events|en|in)$/i.test(x));
    const best = segs.sort((a, b) => b.length - a.length)[0];
    return best ? clip(best.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), 120) : null;
  } catch { return null; }
}

const json = async (url) => JSON.parse((await safeGet(url, { timeout: 6000, maxBytes: PAGE_BYTES, accept: 'application/json' })).body);

// Sites with a proper preview API (their pages often hide preview tags from servers).
const OEMBED = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`, 'YouTube'],
  [/(^|\.)spotify\.com$/, (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`, 'Spotify'],
  [/(^|\.)(twitter\.com|x\.com)$/, (u) => `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(u)}`, 'X'],
];

async function viaOembed(url, host) {
  const hit = OEMBED.find(([re]) => re.test(host));
  if (!hit) return null;
  try {
    const o = await json(hit[1](url));
    // X returns the post as HTML: keep its text.
    const text = o.html ? N.decode(String(o.html).replace(/<a[^>]*>pic\.twitter[^<]*<\/a>/gi, '').replace(/<p[^>]*>([\s\S]*?)<\/p>[\s\S]*/i, '$1').replace(/<[^>]+>/g, ' ')) : null;
    const title = hit[2] === 'X' ? (o.author_name ? `${o.author_name} on X` : 'Post on X') : o.title;
    return { title: clip(title, 160), description: clip(hit[2] === 'X' ? text : o.author_name, 220), image: imgUrl(o.thumbnail_url, url), site: hit[2] };
  } catch { return null; }
}

// Google Maps (including maps.app.goo.gl short links): place name and coordinates from the address.
function mapsInfo(finalUrl) {
  try {
    const u = new URL(finalUrl);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || !/\/maps/.test(u.pathname + u.hostname)) return null;
    const place = /\/maps\/place\/([^/@]+)/.exec(u.pathname);
    const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u.pathname) || /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(u.pathname);
    const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination');
    const name = place ? decodeURIComponent(place[1].replace(/\+/g, ' ')) : q && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(q) ? q : null;
    const ll = at ? [Number(at[1]), Number(at[2])] : q && /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(q) ? q.split(',').map(Number) : null;
    return { name, ll };
  } catch { return null; }
}

module.exports = function unfurl({ app, db, C, auth, wrap, bad, rateLimit, publicOrigin }) {
  const cache = new Map(); // url → { at, data }
  const inflight = new Map();
  const remember = (url, data) => {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), data });
  };
  const sign = (u) => C.hmac('unfurl-img:' + u).slice(0, 32);
  const proxied = (u) => (u ? `/api/unfurl/img?u=${encodeURIComponent(u)}&s=${sign(u)}` : null);

  // Our own Buzz share links: <origin>/b/<story id>.
  async function buzzCard(id) {
    const r = await db.one('SELECT id, title, summary, ai_summary, image_url, url, source_id, via FROM feed_items WHERE id=?', [id]);
    if (!r) return null;
    return { kind: 'buzz', buzzId: r.id, url: r.url, title: clip(r.title, 200), description: clip(r.ai_summary || r.summary, 220), image: r.image_url, site: r.via || byId(r.source_id)?.name || hostOf(r.url) };
  }

  async function fetchPreview(url) {
    const host = hostOf(url);
    const o = await viaOembed(url, host);
    if (o?.title) return { kind: 'link', ...o };
    let page = null, meta = {};
    for (const ua of [UA_BOT, UA_BROWSER]) {
      try {
        page = await safeGet(url, { timeout: 7000, maxBytes: PAGE_BYTES, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ua });
        const type = page.headers.get('content-type') || '';
        if (IMG_TYPES.test(type.split(';')[0])) return { kind: 'image', title: null, image: page.finalUrl || url, site: hostOf(page.finalUrl || url) };
        meta = parseMeta(page.body || '');
        if (meta['og:title'] || meta['og:image'] || meta['twitter:title']) break;
      } catch { page = null; }
    }
    const finalUrl = page?.finalUrl || url;
    const p = fromMeta(meta, finalUrl);
    const maps = mapsInfo(finalUrl);
    if (maps) {
      // Google's own title is often just "Google Maps"; the place name from the address is better.
      const t = p.title && !/^google maps$/i.test(p.title) ? p.title.replace(/\s*·\s*Google Maps$/i, '') : null;
      const generic = (d) => (d && /find local businesses|view maps and get driving directions/i.test(d) ? null : d);
      return { kind: 'map', title: clip(maps.name || t || 'Location', 160), description: generic(maps.name && t && t !== maps.name ? clip(t, 220) : p.description), image: p.image, site: 'Google Maps', ll: maps.ll };
    }
    const host2 = hostOf(finalUrl);
    if (/^(maps\.app\.goo\.gl|goo\.gl)$/.test(host2) || /^maps\.google\./.test(host2)) return { kind: 'map', title: 'Location on Google Maps', description: null, image: null, site: 'Google Maps' };
    // Blocked by the site (or not a page): a small card with the site's icon and a title from the address.
    const icon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host2)}&sz=128`;
    if (!p.title && !p.image) return page || /[a-z]/i.test(host2.split('.').slice(-1)[0] || '') && !net.isIP(host2) && !/^localhost$/i.test(host2) ? { kind: 'link', title: titleFromPath(finalUrl), description: null, image: null, icon, site: host2 } : null;
    return { kind: 'link', ...p, icon: p.image ? null : icon, site: p.site || host2 };
  }

  async function preview(url, req) {
    const own = new URL(publicOrigin(req));
    const u = new URL(url);
    const bm = /^\/b\/([a-f0-9]{24})$/.exec(u.pathname);
    if (bm && (u.host === own.host || u.host === req.get('host'))) return buzzCard(bm[1]);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < (hit.data ? TTL : FAIL_TTL)) return hit.data;
    if (!inflight.has(url)) inflight.set(url, fetchPreview(url).catch(() => null).then((d) => { remember(url, d); inflight.delete(url); return d; }));
    return inflight.get(url);
  }

  app.get('/api/unfurl', auth, wrap(async (req, res) => {
    rateLimit('unfurl:' + req.uid, 120, 60000);
    const raw = String(req.query.url || '');
    let url;
    try { url = new URL(raw); } catch { throw bad('Bad link'); }
    if (!/^https?:$/.test(url.protocol) || raw.length > 2000) throw bad('Bad link');
    const d = await preview(url.toString(), req);
    res.set('Cache-Control', 'private, max-age=3600');
    if (!d) return res.json({ preview: null });
    res.json({ preview: { ...d, url: d.url || url.toString(), image: proxied(d.image), icon: proxied(d.icon) } });
  }));

  // Signed image proxy: only pictures our previews pointed at, public addresses only, images only.
  app.get('/api/unfurl/img', auth, wrap(async (req, res) => {
    rateLimit('unfurl-img:' + req.uid, 300, 60000);
    let current = String(req.query.u || '');
    if (!current || sign(current) !== String(req.query.s || '')) return res.status(403).end();
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port))) return res.status(400).end();
      const hostname = u.hostname.replace(/^\[|\]$/g, '');
      const addrs = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true }).catch(() => []);
      if (!addrs.length || addrs.some((a) => privateIp(a.address))) return res.status(400).end();
      const r = await fetch(current, { headers: { 'user-agent': UA_BROWSER, accept: 'image/avif,image/webp,image/*' }, redirect: 'manual', signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!r) return res.status(502).end();
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { current = new URL(r.headers.get('location'), current).toString(); continue; }
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!r.ok || !IMG_TYPES.test(type)) return res.status(404).end();
      const reader = r.body.getReader(); const parts = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > IMG_BYTES) { reader.cancel().catch(() => {}); return res.status(413).end(); }
        parts.push(value);
      }
      res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      return res.end(Buffer.concat(parts));
    }
    res.status(508).end();
  }));

  // Buzz share links open the story itself (also outside the app).
  app.get('/b/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{24}$/.test(id)) return res.redirect('/');
    const r = await db.one('SELECT url FROM feed_items WHERE id=?', [id]);
    res.redirect(r && /^https?:\/\//.test(r.url) ? r.url : '/');
  }));
};

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
}

module.exports.parseMeta = parseMeta;
module.exports.mapsInfo = mapsInfo;
module.exports.titleFromPath = titleFromPath;
