// Buzz: one live feed of real stories, mixed for where you are (e.g. Hyderabad local + India + tech +
// business + world + cricket + cinema).
// Publisher feeds → server collectors (scheduled, per-source polling, backoff) → normalised rows in our
// database (durable, shared by everyone) → ranked per region → GET /api/feed → the app checks every 5s.
const { SOURCES, CITIES, byId } = require('./sources');
const { collect, enrich, fetchLogo } = require('./collect');
const N = require('./normalize');

module.exports = function buzz({ app, db, C, auth, wrap, bad, notFound, toInt, clampStr, rateLimit, publicUser, ms }) {
  const REGIONS = new Set([...Object.keys(CITIES), 'india']);
  const regionName = (r) => CITIES[r]?.name || 'India';

  // ───── collection ─────
  const state = new Map(); // source id → row from feed_sources
  let dirty = true;

  async function loadState() {
    for (const r of await db.q('SELECT * FROM feed_sources')) state.set(r.id, r);
  }

  async function saveState(id, patch) {
    const row = { ...(state.get(id) || { id, fails: 0, items: 0, status: 'pending' }), ...patch };
    state.set(id, row);
    await db.q(`INSERT INTO feed_sources (id, etag, last_modified, last_ok, last_attempt, next_try, fails, status, error, items)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE etag=VALUES(etag), last_modified=VALUES(last_modified), last_ok=VALUES(last_ok),
      last_attempt=VALUES(last_attempt), next_try=VALUES(next_try), fails=VALUES(fails), status=VALUES(status), error=VALUES(error), items=VALUES(items)`,
    [id, row.etag || null, row.last_modified || null, row.last_ok || null, row.last_attempt || null, row.next_try || null, row.fails || 0, row.status, row.error || null, row.items || 0]);
  }

  async function store(src, items) {
    let n = 0;
    // A site-wide default picture used on several stories is not the story's photo.
    const seen = new Map();
    for (const it of items) if (it.image) seen.set(it.image, (seen.get(it.image) || 0) + 1);
    for (const it of items) {
      if (it.image && seen.get(it.image) >= 3) it.image = null;
      if (it.image) it.image = N.upgradeImage(it.image);
    }
    for (const it of items) {
      const url = N.canonical(it.url);
      if (!url) continue;
      // Aggregators mix languages; keep the feed readable (English headlines from them).
      if (src.aggregator && !mostlyLatin(it.title)) continue;
      const id = N.idFor(url);
      await db.q(`INSERT INTO feed_items (id, source_id, region, topic, url, title, summary, image_url, video_url, via, discuss_url, engagement, src_rank, published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE title=VALUES(title), summary=COALESCE(VALUES(summary), summary), image_url=COALESCE(VALUES(image_url), image_url),
          video_url=COALESCE(VALUES(video_url), video_url),
          engagement=IF(source_id = VALUES(source_id), VALUES(engagement), COALESCE(engagement, VALUES(engagement))),
          src_rank=IF(source_id = VALUES(source_id), VALUES(src_rank), src_rank),
          published_at=COALESCE(published_at, VALUES(published_at))`,
      [id, src.id, src.region, src.topic, url, clampStr(it.title, 590), it.description || null, it.image || null, it.video || null,
        it.via ? clampStr(it.via, 150) : null, it.discussUrl || null, it.engagement ? JSON.stringify(it.engagement) : null,
        Number.isFinite(it.rank) ? it.rank : null, it.publishedAt ? new Date(it.publishedAt) : null]);
      n++;
    }
    return n;
  }

  function mostlyLatin(t) {
    const letters = String(t).match(/\p{L}/gu) || [];
    if (!letters.length) return false;
    return letters.filter((c) => /[A-Za-z\u00C0-\u024F]/.test(c)).length / letters.length >= 0.6;
  }

  async function runSource(src) {
    const st = state.get(src.id) || {};
    const at = new Date();
    try {
      const r = await collect(src, { etag: st.etag, lastModified: st.last_modified });
      if (r.notModified) return saveState(src.id, { last_ok: at, last_attempt: at, next_try: new Date(Date.now() + src.poll), fails: 0, status: 'ok', error: null });
      const n = await store(src, r.items);
      if (n) dirty = true;
      await saveState(src.id, { etag: r.etag || null, last_modified: r.lastModified || null, last_ok: at, last_attempt: at, next_try: new Date(Date.now() + src.poll), fails: 0, status: 'ok', error: null, items: n });
    } catch (e) {
      const fails = (st.fails || 0) + 1;
      const backoff = e.retryAfter ? e.retryAfter * 1000 : Math.min(6 * 3600e3, src.poll * 2 ** Math.min(fails, 6));
      await saveState(src.id, { last_attempt: at, next_try: new Date(Date.now() + backoff), fails, status: e.status === 429 ? 'rate-limited' : 'error', error: clampStr(e.message || 'Failed', 290) });
    }
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const due = SOURCES.filter((s) => s.enabled && (!state.get(s.id)?.next_try || ms(state.get(s.id).next_try) <= now));
      let i = 0; // bounded concurrency: 4 sources at a time
      await Promise.all(Array.from({ length: 4 }, async () => { while (i < due.length) await runSource(due[i++]); }));
      await enrichSome();
      await logosSome();
    } catch (e) { console.error('buzz tick', e.message); }
    ticking = false;
  }

  // Missing image / summary: read the article page's own Open Graph tags (publisher's site only).
  async function enrichSome() {
    // Every new story is checked once: missing summary, or a missing / small / placeholder image is
    // replaced with the article's own share image (usually 1200px) — so every photo is HD.
    // Stories people are about to see (the top of each city's feed) come first.
    const top = [...new Set([...cache.values()].flatMap((c) => c.list.slice(0, 72).map((x) => x.row.id)))];
    const pri = top.length ? await db.q('SELECT id, source_id, url, image_url, summary FROM feed_items WHERE enriched=0 AND id IN (?)', [top]) : [];
    const rest = await db.q(`SELECT id, source_id, url, image_url, summary FROM feed_items WHERE enriched=0 AND fetched_at > ?
      ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 40`, [new Date(Date.now() - 36 * 3600e3)]);
    const rows = [...pri, ...rest.filter((r) => !pri.some((p) => p.id === r.id))].filter((r) => !r.summary || N.lowRes(r.image_url));
    const skip = await db.q(`SELECT id FROM feed_items WHERE enriched=0 AND fetched_at > ? AND summary IS NOT NULL AND image_url IS NOT NULL LIMIT 200`, [new Date(Date.now() - 36 * 3600e3)]);
    const fine = skip.filter((r) => !rows.some((x) => x.id === r.id)).map((r) => r.id);
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < Math.min(rows.length, 24)) {
        const r = rows[i++];
        const src = byId(r.source_id);
        let got = null;
        // Google News links are redirects we can't follow; Trends links go straight to the article.
        if (src && (!src.aggregator || src.trends)) { try { got = await enrich(r.url, src.site, { anySite: !!src.trends }); } catch {} }
        // Better image found → use it. Otherwise keep a small real photo, but drop icons/placeholders.
        const junk = /(android-chrome|apple-touch|favicon|site-?icon|logo|placeholder|default|og-image|cropped-)/i.test(r.image_url || '');
        const img = got?.image && (N.lowRes(r.image_url) || !r.image_url) ? got.image : (junk || (N.lowRes(r.image_url) && !/^https:/.test(r.image_url || '')) ? null : r.image_url);
        await db.q('UPDATE feed_items SET enriched=1, image_url=?, summary=COALESCE(summary, ?) WHERE id=?', [img || null, got?.description || null, r.id]);
        if (got?.image || got?.description) dirty = true;
      }
    }));
    // Stories that already had a large image and a summary need no visit.
    for (let k = 0; k < fine.length; k += 100) {
      const chunk = (await db.q('SELECT id, image_url FROM feed_items WHERE id IN (?)', [fine.slice(k, k + 100)])).filter((r) => !N.lowRes(r.image_url)).map((r) => r.id);
      if (chunk.length) await db.q('UPDATE feed_items SET enriched=1 WHERE id IN (?)', [chunk]);
    }
  }

  // Publisher logos (one per website), refreshed weekly, stored in the database.
  const logoReady = new Set();
  async function logosSome() {
    const rows = await db.q('SELECT id, logo_at, logo IS NOT NULL has FROM feed_sources');
    const seen = new Map(rows.map((r) => [r.id, r]));
    const bySite = new Map();
    for (const s of SOURCES) if (s.enabled && !s.aggregator) bySite.set(s.site, [...(bySite.get(s.site) || []), s.id]);
    let done = 0;
    for (const [site, ids] of bySite) {
      const r = seen.get(ids[0]);
      if (r?.has) { ids.forEach((id) => logoReady.add(id)); }
      if (r?.logo_at && Date.now() - ms(r.logo_at) < 7 * 86400e3) continue;
      if (!r || done >= 6) continue; // a few per tick; the source row must exist first
      done++;
      const logo = await fetchLogo(site).catch(() => null);
      await db.q('UPDATE feed_sources SET logo=COALESCE(?, logo), logo_type=COALESCE(?, logo_type), logo_at=? WHERE id IN (?)', [logo?.data || null, logo?.type || null, new Date(), ids]);
      if (logo) { ids.forEach((id) => logoReady.add(id)); dirty = true; }
    }
  }

  app.get('/api/feed/logo/:id', wrap(async (req, res) => {
    const src = byId(String(req.params.id));
    if (!src) return res.status(404).end();
    // Every source on the same website shares one logo.
    const ids = SOURCES.filter((s) => s.site === src.site).map((s) => s.id);
    const r = await db.one('SELECT logo, logo_type FROM feed_sources WHERE id IN (?) AND logo IS NOT NULL LIMIT 1', [ids]);
    if (!r) return res.status(404).end();
    res.setHeader('Content-Type', /^image\//.test(r.logo_type) ? r.logo_type : 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(r.logo);
  }));

  async function cleanup() {
    await db.q(`DELETE FROM feed_items WHERE fetched_at < ? AND NOT EXISTS (SELECT 1 FROM feed_likes l WHERE l.item_id=feed_items.id)
      AND NOT EXISTS (SELECT 1 FROM feed_comments c WHERE c.item_id=feed_items.id) AND NOT EXISTS (SELECT 1 FROM feed_reposts p WHERE p.item_id=feed_items.id)`,
    [new Date(Date.now() - 4 * 86400e3)]).catch(() => {});
  }

  // ───── ranking ─────
  // Buckets and their share of a region's feed. Local first; everything interleaved.
  const MIX_CITY = [['local', 34], ['india', 18], ['tech', 14], ['business', 12], ['world', 10], ['sports', 6], ['entertainment', 6]];
  const MIX_INDIA = [['india', 32], ['tech', 18], ['business', 16], ['world', 14], ['sports', 10], ['entertainment', 10]];

  function bucketOf(row, region) {
    if (row.topic === 'local') return row.region === region ? 'local' : null;
    if (row.topic === 'entertainment') return row.region === 'india' || row.region === region ? 'entertainment' : null;
    return row.topic === 'video' ? 'entertainment' : row.topic;
  }

  const AREA = { hyderabad: 'Telangana', bengaluru: 'Karnataka', mumbai: 'Maharashtra', pune: 'Maharashtra', delhi: 'Delhi', chennai: 'Tamil Nadu', kolkata: 'West Bengal' };
  function score(row, eng, region) {
    const src = byId(row.source_id);
    const t = row.published_at ? ms(row.published_at) : ms(row.fetched_at);
    const ageH = Math.max(0, (Date.now() - t) / 3600e3);
    const recency = Math.exp(-ageH / 10);
    let viral = 0, label = { kind: 'latest', text: 'Latest' };
    let e = row.engagement ? JSON.parse(row.engagement) : null;
    // A trend from another state isn't a signal for this reader (all-India trends always count).
    if (e?.platform === 'Google Trends' && e.area && e.area !== 'India' && e.area !== AREA[region]) e = null;
    if (e?.platform === 'Google Trends') {
      viral = Math.min(1, 0.35 + Math.log10((e.searchesN || 0) + 1) / 6);
      label = { kind: 'trending', text: `Trending in ${e.area || 'India'}${e.searches ? ` · ${e.searches} searches` : ''}` };
    } else if (e?.points != null) {
      viral = Math.min(1, Math.log10(e.points + 1) / 3);
      label = { kind: 'trending', text: `${e.points} points · ${e.comments} comments on Hacker News` };
    } else if (src?.topList && row.src_rank != null) {
      viral = 0.6 * Math.max(0, 1 - row.src_rank / 40);
      if (row.src_rank < 10) label = { kind: 'top', text: 'Top story on Google News' };
    } else if (row.src_rank != null) {
      viral = (src?.aggregator ? 0.12 : 0.18) * Math.max(0, 1 - row.src_rank / 30);
    }
    const inApp = (eng?.likes || 0) + 2 * (eng?.comments || 0) + 3 * (eng?.reposts || 0);
    if (inApp) {
      viral += Math.min(1, Math.log2(1 + inApp) / 5);
      if (inApp >= 3) label = { kind: 'buzzing', text: 'Buzzing on Ping Me' };
    }
    return { score: 0.55 * recency + 0.45 * viral, label, ts: t };
  }

  // The same story reported by several outlets is a real "this is big" signal: group it into one card
  // (best photo/summary first), name the other outlets, and rank it higher.
  const STOP = new Set('that this with from have will after over into about says said their they them what when where which while would could should been being than then also just more most into amid after year years news live updates update today india indian'.split(' '));
  const tokens = (t) => new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
  function clusterStories(all) {
    const index = new Map(); // token → cluster ids
    const clusters = [];
    for (const x of all.sort((a, b) => b.ts - a.ts)) {
      const tk = tokens(x.row.title);
      if (tk.size < 3) continue;
      const counts = new Map();
      for (const t of tk) for (const c of index.get(t) || []) counts.set(c, (counts.get(c) || 0) + 1);
      let best = null;
      for (const [c, n] of counts) {
        const cl = clusters[c];
        const sim = n / (tk.size + cl.tk.size - n);
        if ((sim >= 0.42 || n >= 5) && Math.abs(cl.ts - x.ts) < 30 * 3600e3 && (!best || sim > best.sim)) best = { c, sim };
      }
      if (best) clusters[best.c].items.push(x);
      else { const id = clusters.length; clusters.push({ tk, ts: x.ts, items: [x] }); for (const t of tk) index.set(t, [...(index.get(t) || []), id]); }
    }
    for (const cl of clusters) {
      const outlets = new Map();
      for (const x of cl.items) { const name = x.row.via || byId(x.row.source_id)?.name?.split(' · ')[0] || x.row.source_id; if (!outlets.has(name)) outlets.set(name, x); }
      if (outlets.size < 2) continue;
      // Lead: has a photo + summary, not an aggregator, then the highest score.
      const lead = [...cl.items].sort((a, b) => (!!b.row.image_url - !!a.row.image_url) || (!!b.row.summary - !!a.row.summary) || ((!byId(a.row.source_id)?.aggregator) ? -1 : 1) || b.score - a.score)[0];
      for (const x of cl.items) if (x !== lead) x.hiddenBy = lead.row.id;
      const n = outlets.size;
      lead.coverage = n;
      lead.alsoBy = [...outlets.keys()].filter((k) => k !== (lead.row.via || byId(lead.row.source_id)?.name?.split(' · ')[0])).slice(0, 4);
      lead.score += Math.min(0.5, 0.18 * Math.log2(n));
      if (n >= 3 && lead.label.kind === 'latest') lead.label = { kind: 'top', text: `Covered by ${n} outlets` };
      if (!lead.row.engagement && cl.items.some((x) => x.row.engagement)) lead.extraEngagement = cl.items.find((x) => x.row.engagement)?.row.engagement;
    }
  }

  const cache = new Map(); // region → { at, version, list }
  async function engagementFor(ids, uid) {
    const out = new Map(ids.map((id) => [id, { likes: 0, comments: 0, reposts: 0, liked: false, reposted: false }]));
    if (!ids.length) return out;
    for (const [table, key] of [['feed_likes', 'likes'], ['feed_reposts', 'reposts'], ['feed_comments', 'comments']]) {
      for (const r of await db.q(`SELECT item_id, COUNT(*) n FROM ${table} WHERE item_id IN (?) GROUP BY item_id`, [ids])) out.get(r.item_id)[key] = Number(r.n);
    }
    if (uid) {
      for (const r of await db.q('SELECT item_id FROM feed_likes WHERE user_id=? AND item_id IN (?)', [uid, ids])) out.get(r.item_id).liked = true;
      for (const r of await db.q('SELECT item_id FROM feed_reposts WHERE user_id=? AND item_id IN (?)', [uid, ids])) out.get(r.item_id).reposted = true;
    }
    return out;
  }

  async function ranked(region) {
    const c = cache.get(region);
    if (c && !dirty && Date.now() - c.at < 20000) return c;
    if (c && Date.now() - c.at < 4000) return c;
    const rows = await db.q(`SELECT id, source_id, region, topic, url, title, summary, image_url, video_url, via, discuss_url, engagement, src_rank, published_at, fetched_at
      FROM feed_items WHERE (region IN (?, 'india', 'world')) AND COALESCE(published_at, fetched_at) > ? ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 1500`,
    [region, new Date(Date.now() - 48 * 3600e3)]);
    const eng = await engagementFor(rows.map((r) => r.id), null);
    const mix = region === 'india' ? MIX_INDIA : MIX_CITY;
    const buckets = new Map(mix.map(([b]) => [b, []]));
    for (const r of rows) {
      const b = bucketOf(r, region);
      if (!buckets.has(b)) continue;
      buckets.get(b).push({ row: r, ...score(r, eng.get(r.id), region) });
    }
    clusterStories([...buckets.values()].flat());
    for (const [b, list] of buckets) buckets.set(b, list.filter((x) => !x.hiddenBy).sort((a, b2) => b2.score - a.score));
    // Weighted round-robin across buckets; avoid the same publisher twice in a row.
    const out = [], credit = new Map(mix.map(([b]) => [b, 0]));
    const total = mix.reduce((s, [, w]) => s + w, 0);
    let lastSource = null;
    while (out.length < 400 && [...buckets.values()].some((l) => l.length)) {
      for (const [b, w] of mix) credit.set(b, credit.get(b) + w / total);
      const pick = [...credit.entries()].filter(([b]) => buckets.get(b).length).sort((a, b) => b[1] - a[1])[0];
      if (!pick) break;
      const list = buckets.get(pick[0]);
      let k = list.findIndex((x) => x.row.source_id !== lastSource);
      if (k < 0) k = 0;
      const [x] = list.splice(k, 1);
      credit.set(pick[0], pick[1] - 1);
      lastSource = x.row.source_id;
      out.push(x);
    }
    const version = require('crypto').createHash('sha1').update(out.slice(0, 60).map((x) => x.row.id).join(',')).digest('hex').slice(0, 16);
    const entry = { at: Date.now(), version, list: out };
    cache.set(region, entry);
    dirty = false;
    return entry;
  }

  function present(x, e) {
    const r = x.row, src = byId(r.source_id);
    return {
      id: r.id, sourceId: r.source_id, sourceName: r.via ? r.via : src?.name || r.source_id, via: r.via ? src?.name : null,
      sourceUrl: src ? `https://${src.site}` : null, canonicalUrl: r.url, discussUrl: r.discuss_url || null,
      logoUrl: !r.via && src && SOURCES.some((s) => s.site === src.site && logoReady.has(s.id)) ? `/api/feed/logo/${src.id}` : null,
      title: r.title, description: r.summary || null, imageUrl: r.image_url || null, videoUrl: r.video_url || null,
      mediaType: r.video_url ? 'video' : r.image_url ? 'image' : 'none',
      publishedAt: r.published_at ? ms(r.published_at) : null, fetchedAt: ms(r.fetched_at), topic: r.topic,
      contentType: x.label.kind, label: x.label.text, engagementMetrics: r.engagement ? JSON.parse(r.engagement) : null,
      coverage: x.coverage || 1, alsoBy: x.alsoBy || [],
      likes: e.likes, comments: e.comments, reposts: e.reposts, liked: e.liked, reposted: e.reposted,
    };
  }

  // ───── routes ─────
  app.get('/api/feed', auth, wrap(async (req, res) => {
    const region = REGIONS.has(String(req.query.region)) ? String(req.query.region) : 'india';
    const offset = Math.max(0, toInt(req.query.offset) || 0);
    const limit = Math.min(48, Math.max(1, toInt(req.query.limit) || 24));
    const r = await ranked(region);
    const page = r.list.slice(offset, offset + limit);
    const eng = await engagementFor(page.map((x) => x.row.id), req.uid);
    const lastOk = Math.max(0, ...[...state.values()].map((s) => (s.last_ok ? ms(s.last_ok) : 0)));
    res.json({
      region, regionName: regionName(region), version: r.version, checkedAt: Date.now(), collectedAt: lastOk || null,
      items: page.map((x) => present(x, eng.get(x.row.id))), hasMore: offset + limit < r.list.length, total: r.list.length,
    });
  }));

  app.get('/api/feed/sources', auth, wrap(async (req, res) => {
    res.json({
      scheduler: 'on', sources: SOURCES.map((s) => {
        const st = state.get(s.id) || {};
        return { id: s.id, name: s.name, topic: s.topic, region: s.region, enabled: s.enabled, credentials: s.enabled ? null : s.credentials || null,
          status: s.enabled ? st.status || 'pending' : 'needs credentials', lastOk: st.last_ok ? ms(st.last_ok) : null,
          nextTry: st.next_try ? ms(st.next_try) : null, error: st.error || null, items: st.items || 0, pollMinutes: Math.round(s.poll / 60000) };
      }),
    });
  }));

  async function item(id) {
    const r = await db.one('SELECT id FROM feed_items WHERE id=?', [String(id).slice(0, 24)]);
    if (!r) throw notFound('Story not found');
    return r.id;
  }
  async function counts(id, uid) { return (await engagementFor([id], uid)).get(id); }

  app.post('/api/feed/:id/like', auth, wrap(async (req, res) => {
    const id = await item(req.params.id);
    rateLimit('flike:' + req.uid, 120, 60000);
    const had = await db.one('SELECT 1 x FROM feed_likes WHERE item_id=? AND user_id=?', [id, req.uid]);
    if (had) await db.q('DELETE FROM feed_likes WHERE item_id=? AND user_id=?', [id, req.uid]);
    else await db.q('INSERT IGNORE INTO feed_likes (item_id, user_id) VALUES (?,?)', [id, req.uid]);
    dirty = true;
    res.json(await counts(id, req.uid));
  }));

  app.post('/api/feed/:id/repost', auth, wrap(async (req, res) => {
    const id = await item(req.params.id);
    rateLimit('frepost:' + req.uid, 60, 60000);
    const had = await db.one('SELECT 1 x FROM feed_reposts WHERE item_id=? AND user_id=?', [id, req.uid]);
    if (had && req.body?.on !== true) await db.q('DELETE FROM feed_reposts WHERE item_id=? AND user_id=?', [id, req.uid]);
    else await db.q('INSERT IGNORE INTO feed_reposts (item_id, user_id) VALUES (?,?)', [id, req.uid]);
    dirty = true;
    res.json(await counts(id, req.uid));
  }));

  app.get('/api/feed/:id/comments', auth, wrap(async (req, res) => {
    const id = await item(req.params.id);
    const rows = await db.q('SELECT id, user_id, body_enc, created_at FROM feed_comments WHERE item_id=? ORDER BY id ASC LIMIT 300', [id]);
    const users = {};
    for (const r of rows) if (!users[r.user_id]) users[r.user_id] = await publicUser(Number(r.user_id));
    res.json({ comments: rows.map((r) => ({ id: Number(r.id), userId: Number(r.user_id), text: C.dec(r.body_enc) || '', createdAt: ms(r.created_at), mine: Number(r.user_id) === req.uid })), users: Object.values(users) });
  }));

  app.post('/api/feed/:id/comments', auth, wrap(async (req, res) => {
    const id = await item(req.params.id);
    rateLimit('fcomment:' + req.uid, 30, 60000);
    const text = clampStr(String(req.body.text || ''), 1000).trim();
    if (!text) throw bad('Write a comment first');
    const r = await db.q('INSERT INTO feed_comments (item_id, user_id, body_enc) VALUES (?,?,?)', [id, req.uid, C.enc(text)]);
    dirty = true;
    res.json({ comment: { id: Number(r.insertId), userId: req.uid, text, createdAt: Date.now(), mine: true }, counts: await counts(id, req.uid) });
  }));

  app.delete('/api/feed/comments/:cid', auth, wrap(async (req, res) => {
    const r = await db.one('SELECT item_id, user_id FROM feed_comments WHERE id=?', [toInt(req.params.cid)]);
    if (!r || Number(r.user_id) !== req.uid) throw notFound();
    await db.q('DELETE FROM feed_comments WHERE id=?', [toInt(req.params.cid)]);
    res.json({ ok: true, counts: await counts(r.item_id, req.uid) });
  }));

  // Background collection: Ping Me's server instance stays running (Cloud Run min-instances 1, CPU
  // always on), so the feed keeps collecting even when nobody has it open. BUZZ_COLLECT=off disables.
  function start() {
    if (process.env.BUZZ_COLLECT === 'off') return;
    loadState().then(() => { tick(); setInterval(tick, 20000).unref(); setInterval(cleanup, 3600e3).unref(); }).catch((e) => console.error('buzz start', e.message));
  }
  return { start, tick, ranked, REGIONS, CITIES };
};
