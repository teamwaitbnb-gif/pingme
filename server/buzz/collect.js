// Collectors: fetch configured publisher feeds on the server (never from the browser), parse RSS/Atom
// and the Hacker News API, and read a missing image/description from the article page itself —
// only on the publisher's own site. No open "fetch any URL" endpoint exists.
const { XMLParser } = require('fast-xml-parser');
const N = require('./normalize');

const UA = 'Mozilla/5.0 (compatible; PingMeBuzz/1.0; +https://pingme.app)';
const MAX_FEED_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 700 * 1024;
const MAX_ITEMS = 60;

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
  processEntities: true, htmlEntities: true, trimValues: true, parseTagValue: false,
  isArray: (name) => ['item', 'entry', 'link', 'media:content', 'media:thumbnail', 'enclosure', 'category'].includes(name),
});

class FetchError extends Error { constructor(msg, status, retryAfter) { super(msg); this.status = status; this.retryAfter = retryAfter; } }

// GET with timeout, size cap, manual redirects (http/https only, max 3) and conditional headers.
async function safeGet(url, { timeout = 9000, maxBytes = MAX_FEED_BYTES, etag, lastModified, accept } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol)) throw new FetchError('Blocked URL scheme');
    const headers = { 'user-agent': UA, accept: accept || 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5' };
    if (hop === 0 && etag) headers['if-none-match'] = etag;
    if (hop === 0 && lastModified) headers['if-modified-since'] = lastModified;
    const r = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (r.status >= 300 && r.status < 400 && r.status !== 304) {
      const loc = r.headers.get('location');
      if (!loc) throw new FetchError('Redirect without location', r.status);
      current = new URL(loc, current).toString();
      continue;
    }
    if (r.status === 304) return { notModified: true, headers: r.headers };
    if (!r.ok) throw new FetchError(`HTTP ${r.status}`, r.status, Number(r.headers.get('retry-after')) || null);
    // Read with a size cap.
    const reader = r.body.getReader(); const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); if (maxBytes === MAX_PAGE_BYTES) break; throw new FetchError('Response too large'); }
      parts.push(value);
    }
    return { body: Buffer.concat(parts).toString('utf8'), headers: r.headers, finalUrl: current };
  }
  throw new FetchError('Too many redirects');
}

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const attr = (o, k) => (o && typeof o === 'object' ? o['@_' + k] : undefined);

function mediaOf(it, base) {
  let image = null, video = null;
  const consider = (url, type, medium) => {
    const u = N.httpUrl(url, base);
    if (!u) return;
    const t = String(type || medium || '');
    if (/video/.test(t) || /\.(mp4|webm|m3u8)(\?|$)/i.test(u)) { video = video || u; return; }
    if (/image/.test(t) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) || !t) image = image || u;
  };
  const groups = [it, ...arr(it['media:group'])];
  for (const g of groups) {
    for (const m of arr(g['media:content'])) consider(attr(m, 'url'), attr(m, 'type'), attr(m, 'medium'));
    for (const m of arr(g['media:thumbnail'])) consider(attr(m, 'url'), 'image');
  }
  for (const e of arr(it.enclosure)) consider(attr(e, 'url'), attr(e, 'type'));
  for (const l of arr(it.link)) if (attr(l, 'rel') === 'enclosure') consider(attr(l, 'href'), attr(l, 'type'));
  if (it.image) consider(typeof it.image === 'string' ? it.image : it.image.url || attr(it.image, 'href'), 'image');
  if (!image) {
    const html = String(it['content:encoded']?.['#text'] ?? it['content:encoded'] ?? it.description?.['#text'] ?? it.description ?? it.content?.['#text'] ?? it.content ?? '');
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    if (m && !/(pixel|tracker|feedburner|1x1|spacer)/i.test(m[1])) consider(N.decode(m[1]), 'image');
  }
  return { image, video };
}

// RSS 2.0 items and Atom entries → raw stories.
function parseFeed(xml, src) {
  if (/<!DOCTYPE[^>[]*\[/i.test(xml)) xml = xml.replace(/<!DOCTYPE[\s\S]*?\]>/i, ''); // no inline entity definitions
  let doc;
  try { doc = parser.parse(xml); } catch { throw new FetchError('Invalid XML'); }
  const channel = doc.rss?.channel || doc['rdf:RDF'] || null;
  const feed = doc.feed || null;
  const items = channel ? arr(channel.item || doc['rdf:RDF']?.item) : feed ? arr(feed.entry) : null;
  if (!items) throw new FetchError('Not an RSS or Atom feed');
  const base = src.url;
  return items.slice(0, MAX_ITEMS).map((it, rank) => {
    let link = null;
    if (feed) {
      const links = arr(it.link);
      const alt = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') || links[0];
      link = attr(alt, 'href') || (typeof alt === 'string' ? alt : null);
    } else {
      const l = arr(it.link)[0];
      link = typeof l === 'string' ? l : l?.['#text'] || attr(l, 'href') || (typeof it.guid === 'string' && /^https?:/.test(it.guid) ? it.guid : it.guid?.['#text']);
    }
    let title = N.text(it.title);
    let sourceName = null;
    // Google News: "Headline - Publisher" with a <source> element naming the real publisher.
    if (src.aggregator) {
      const s = it.source; sourceName = N.text(s) || null;
      if (sourceName && title.endsWith(' - ' + sourceName)) title = title.slice(0, -(sourceName.length + 3));
    }
    const { image, video } = mediaOf(it, base);
    const desc = it.description ?? it.summary ?? it['content:encoded'] ?? it.content;
    return {
      title, url: N.httpUrl(link, base),
      description: src.aggregator ? null : N.summarize(desc, title),
      image, video,
      publishedAt: N.date(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']),
      via: sourceName, rank,
    };
  }).filter((s) => s.title && s.url);
}

// Hacker News: real points + comment counts (a genuine popularity signal).
async function collectHN(src) {
  const { body } = await safeGet(src.url, { timeout: src.timeout, accept: 'application/json' });
  const ids = JSON.parse(body).slice(0, 30);
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const { body: b } = await safeGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 6000, accept: 'application/json' });
        const it = JSON.parse(b);
        if (!it || it.dead || it.deleted || it.type !== 'story') continue;
        const discuss = `https://news.ycombinator.com/item?id=${id}`;
        out.push({
          title: N.text(it.title), url: N.httpUrl(it.url || discuss) || discuss, discussUrl: discuss,
          description: it.text ? N.summarize(it.text, it.title) : null, image: null, video: null,
          publishedAt: it.time ? it.time * 1000 : null,
          engagement: { platform: 'Hacker News', points: it.score || 0, comments: it.descendants || 0 },
          rank: ids.indexOf(id),
        });
      } catch {}
    }
  }));
  return out.sort((a, b) => a.rank - b.rank);
}

async function collect(src, state = {}) {
  if (src.adapter === 'hn') return { items: await collectHN(src) };
  if (src.adapter !== 'rss') throw new FetchError('Adapter not configured');
  const r = await safeGet(src.url, { timeout: src.timeout, etag: state.etag, lastModified: state.lastModified });
  if (r.notModified) return { notModified: true };
  return { items: parseFeed(r.body, src), etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified') };
}

// Missing image or summary: read the article's own Open Graph tags — only on the publisher's site.
const sameSite = (url, site) => { try { const h = new URL(url).hostname; return h === site || h.endsWith('.' + site); } catch { return false; } };
async function enrich(url, site) {
  if (!site || !sameSite(url, site)) return null;
  const r = await safeGet(url, { timeout: 6000, maxBytes: MAX_PAGE_BYTES, accept: 'text/html' });
  if (!r.body || (r.finalUrl && !sameSite(r.finalUrl, site))) return null;
  const head = r.body.slice(0, 300000);
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
    const tag = re.exec(head)?.[0];
    const c = tag && /content=["']([^"']*)["']/i.exec(tag);
    return c ? N.decode(c[1]).trim() : null;
  };
  const image = N.httpUrl(meta('og:image') || meta('twitter:image') || '', url);
  const description = N.summarize(meta('og:description') || meta('description') || meta('twitter:description') || '', '');
  return { image: image && !/(logo|default|placeholder)/i.test(image) ? image : null, description };
}

module.exports = { collect, enrich, parseFeed, safeGet, FetchError };
