// Buzz: one live feed of real stories, mixed for where you are (e.g. Hyderabad local + India + tech +
// business + world + cricket + cinema).
// Publisher feeds → server collectors (scheduled, per-source polling, backoff) → normalised rows in our
// database (durable, shared by everyone) → ranked per region → GET /api/feed → the app checks every 5s.
const { SOURCES, CITIES, STATE_OF, byId } = require('./sources');
const { collect, enrich, fetchLogo } = require('./collect');
const N = require('./normalize');
const AI = require('./ai');

module.exports = function buzz({ app, db, C, auth, wrap, bad, notFound, toInt, clampStr, rateLimit, publicUser, ms }) {
  const bg = db.bg || db; // collecting runs on its own connections (never slows readers down)
  const REGIONS = new Set([...Object.keys(CITIES), 'india']);
  const regionName = (r) => CITIES[r]?.name || 'India';

  // ───── collection ─────
  const state = new Map(); // source id → row from feed_sources
  let dirty = true;

  // Source ids renamed when cities were generated from a table — keep older stories attached.
  const RENAMED = { 'hindu-hyd': 'hindu-hyderabad', 'toi-hyd': 'toi-hyderabad', 'gn-hyd': 'gn-hyderabad', 'hindu-blr': 'hindu-bengaluru', 'toi-blr': 'toi-bengaluru',
    'hindu-mum': 'hindu-mumbai', 'toi-mum': 'toi-mumbai', 'hindu-del': 'hindu-delhi', 'toi-del': 'toi-delhi', 'hindu-che': 'hindu-chennai', 'toi-che': 'toi-chennai',
    'hindu-kol': 'hindu-kolkata', 'toi-kol': 'toi-kolkata', 'ht-entertainment': 'ht-entertainment' };
  async function migrateIds() {
    for (const [a, b] of Object.entries(RENAMED)) if (a !== b) { await bg.q('UPDATE feed_items SET source_id=? WHERE source_id=?', [b, a]); await bg.q('DELETE FROM feed_sources WHERE id=?', [a]); }
  }

  async function loadState() {
    await migrateIds().catch(() => {});
    for (const r of await bg.q('SELECT * FROM feed_sources')) state.set(r.id, r);
  }

  async function saveState(id, patch) {
    const row = { ...(state.get(id) || { id, fails: 0, items: 0, status: 'pending' }), ...patch };
    state.set(id, row);
    await bg.q(`INSERT INTO feed_sources (id, etag, last_modified, last_ok, last_attempt, next_try, fails, status, error, items)
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
    // One write for the whole batch (not one per story): far less work for the database.
    const rows = [];
    const ids = new Set();
    for (const it of items) {
      const url = N.canonical(it.url);
      if (!url) continue;
      // Aggregators mix languages; keep the feed readable (English headlines from them).
      if (src.aggregator && !mostlyLatin(it.title)) continue;
      const id = N.idFor(url);
      if (ids.has(id)) continue;
      ids.add(id);
      rows.push([id, src.id, src.region, src.topic, url, clampStr(it.title, 590), it.description || null, it.image || null, it.video || null,
        it.via ? clampStr(it.via, 150) : null, it.discussUrl || null, it.engagement ? JSON.stringify(it.engagement) : null,
        Number.isFinite(it.rank) ? it.rank : null, it.publishedAt ? new Date(it.publishedAt) : null]);
    }
    for (let k = 0; k < rows.length; k += 100) {
      const part = rows.slice(k, k + 100);
      await bg.q(`INSERT INTO feed_items (id, source_id, region, topic, url, title, summary, image_url, video_url, via, discuss_url, engagement, src_rank, published_at)
        VALUES ${part.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}
        ON DUPLICATE KEY UPDATE title=VALUES(title), summary=COALESCE(VALUES(summary), summary), image_url=COALESCE(VALUES(image_url), image_url),
          video_url=COALESCE(VALUES(video_url), video_url),
          engagement=IF(source_id = VALUES(source_id), VALUES(engagement), COALESCE(engagement, VALUES(engagement))),
          src_rank=IF(source_id = VALUES(source_id), VALUES(src_rank), src_rank),
          published_at=COALESCE(published_at, VALUES(published_at))`, part.flat());
      n += part.length;
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
      let i = 0; // bounded concurrency: 3 sources at a time
      await Promise.all(Array.from({ length: 3 }, async () => { while (i < due.length) await runSource(due[i++]); }));
      await enrichSome();
      await logosSome();
      await aiSome();
    } catch (e) { console.error('buzz tick', e.message); }
    ticking = false;
  }

  // Missing image / summary: read the article page's own Open Graph tags (publisher's site only).
  async function enrichSome() {
    // Every new story is checked once: missing summary, or a missing / small / placeholder image is
    // replaced with the article's own share image (usually 1200px) — so every photo is HD.
    // Stories people are about to see (the top of each city's feed) come first.
    const top = [...new Set([...cache.values()].flatMap((c) => c.list.slice(0, 72).map((x) => x.row.id)))];
    const pri = top.length ? await bg.q('SELECT id, source_id, url, image_url, summary FROM feed_items WHERE enriched=0 AND id IN (?)', [top]) : [];
    const rest = await bg.q(`SELECT id, source_id, url, image_url, summary FROM feed_items WHERE enriched=0 AND fetched_at > ?
      ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 40`, [new Date(Date.now() - 36 * 3600e3)]);
    const rows = [...pri, ...rest.filter((r) => !pri.some((p) => p.id === r.id))].filter((r) => !r.summary || r.summary.length < 220 || N.lowRes(r.image_url));
    const skip = await bg.q(`SELECT id FROM feed_items WHERE enriched=0 AND fetched_at > ? AND summary IS NOT NULL AND CHAR_LENGTH(summary) >= 220 AND image_url IS NOT NULL LIMIT 200`, [new Date(Date.now() - 36 * 3600e3)]);
    const fine = skip.filter((r) => !rows.some((x) => x.id === r.id)).map((r) => r.id);
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < Math.min(rows.length, 32)) {
        const r = rows[i++];
        const src = byId(r.source_id);
        let got = null;
        // Google News links are redirects we can't follow; Trends links go straight to the article.
        if (src && !src.social && (!src.aggregator || src.trends)) { try { got = await enrich(r.url, src.site, { anySite: !!src.trends }); } catch {} }
        // Better image found → use it. Otherwise keep a small real photo, but drop icons/placeholders.
        const junk = /(android-chrome|apple-touch|favicon|site-?icon|logo|placeholder|default|og-image|cropped-)/i.test(r.image_url || '');
        const img = got?.image && (N.lowRes(r.image_url) || !r.image_url) ? got.image : (junk || (N.lowRes(r.image_url) && !/^https:/.test(r.image_url || '')) ? null : r.image_url);
        // Fuller summary: the article's opening paragraphs when they say more than the feed did.
        const cur = r.summary || '';
        const better = [got?.lead, got?.description].filter((x) => x && x.length > cur.length + 40).sort((a, b) => b.length - a.length)[0];
        await bg.q('UPDATE feed_items SET enriched=1, image_url=?, summary=? WHERE id=?', [img || null, better || r.summary || null, r.id]);
        if (got?.image || better) dirty = true;
      }
    }));
    // Stories that already had a large image and a summary need no visit.
    for (let k = 0; k < fine.length; k += 100) {
      const chunk = (await bg.q('SELECT id, image_url FROM feed_items WHERE id IN (?)', [fine.slice(k, k + 100)])).filter((r) => !N.lowRes(r.image_url)).map((r) => r.id);
      if (chunk.length) await bg.q('UPDATE feed_items SET enriched=1 WHERE id IN (?)', [chunk]);
    }
  }

  // AI descriptions (Groq) for the stories people are about to see: the server reads the full story and
  // the model writes a clear 2–3 sentence description. Paced to the free tier; otherwise the
  // publisher's opening paragraphs stay.
  async function aiSome() {
    if (!AI.enabled()) return;
    const top = [];
    for (const c of cache.values()) for (const x of c.list.slice(0, 80)) if (!top.includes(x.row.id)) top.push(x.row.id);
    if (!top.length) return;
    const rows = await bg.q('SELECT id, source_id, url, title, via FROM feed_items WHERE ai_summary IS NULL AND ai_tries < 2 AND id IN (?)', [top]);
    rows.sort((a, b) => top.indexOf(a.id) - top.indexOf(b.id));
    for (const r of rows.slice(0, 2)) {
      const src = byId(r.source_id);
      if (!src || src.social || (src.aggregator && !src.trends)) { await bg.q('UPDATE feed_items SET ai_tries=9 WHERE id=?', [r.id]); continue; }
      let page = null;
      try { page = await enrich(r.url, src.site, { anySite: !!src.trends }); } catch {}
      if (!page?.fullText || page.fullText.length < 300) { await bg.q('UPDATE feed_items SET ai_tries=ai_tries+1 WHERE id=?', [r.id]); continue; }
      const out = await AI.summarize({ title: r.title, source: r.via || src.name, text: page.fullText });
      if (out?.throttled) break;
      if (out?.text) { await bg.q('UPDATE feed_items SET ai_summary=?, ai_model=? WHERE id=?', [out.text, out.model, r.id]); dirty = true; }
      else await bg.q('UPDATE feed_items SET ai_tries=ai_tries+1 WHERE id=?', [r.id]);
    }
  }

  // Publisher logos (one per website), refreshed weekly, stored in the database.
  const logoReady = new Set();
  async function logosSome() {
    const rows = await bg.q('SELECT id, logo_at, logo IS NOT NULL has FROM feed_sources');
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
      await bg.q('UPDATE feed_sources SET logo=COALESCE(?, logo), logo_type=COALESCE(?, logo_type), logo_at=? WHERE id IN (?)', [logo?.data || null, logo?.type || null, new Date(), ids]);
      if (logo) { ids.forEach((id) => logoReady.add(id)); dirty = true; }
    }
  }

  app.get('/api/feed/logo/:id', wrap(async (req, res) => {
    const src = byId(String(req.params.id));
    if (!src) return res.status(404).end();
    // Every source on the same website shares one logo.
    const ids = SOURCES.filter((s) => s.site === src.site).map((s) => s.id);
    const r = await bg.one('SELECT logo, logo_type FROM feed_sources WHERE id IN (?) AND logo IS NOT NULL LIMIT 1', [ids]);
    if (!r) return res.status(404).end();
    res.setHeader('Content-Type', /^image\//.test(r.logo_type) ? r.logo_type : 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(r.logo);
  }));

  async function cleanup() {
    await bg.q(`DELETE FROM feed_items WHERE fetched_at < ? AND NOT EXISTS (SELECT 1 FROM feed_likes l WHERE l.item_id=feed_items.id)
      AND NOT EXISTS (SELECT 1 FROM feed_comments c WHERE c.item_id=feed_items.id) AND NOT EXISTS (SELECT 1 FROM feed_reposts p WHERE p.item_id=feed_items.id)`,
    [new Date(Date.now() - 4 * 86400e3)]).catch(() => {});
  }

  // ───── ranking ─────
  // Buckets and their share of a region's feed. Local first; everything interleaved.
  const MIX_CITY = [['local', 28], ['india', 14], ['politics', 8], ['entertainment', 15], ['tech', 10], ['sports', 11], ['business', 8], ['world', 8]];
  const MIX_INDIA = [['india', 22], ['politics', 10], ['entertainment', 19], ['tech', 12], ['sports', 15], ['business', 12], ['world', 10]];

  function bucketOf(row, region) {
    if (row.topic === 'local') return row.region === region ? 'local' : null;
    // A state's politics shows in its cities; national politics everywhere.
    if (row.topic === 'politics') return row.region === 'india' || row.region === region ? 'politics' : null;
    if (row.topic === 'entertainment') return row.region === 'india' || row.region === region ? 'entertainment' : null;
    return row.topic === 'video' ? 'entertainment' : row.topic;
  }

  const AREA = STATE_OF;
  const compact = (v) => (v >= 1e7 ? (v / 1e6).toFixed(0) + 'M' : v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(v));
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
    } else if (e?.platform === 'YouTube') {
      viral = Math.min(0.9, Math.log10((e.views || 0) + 1) / 6.5);
      if (e.views >= 20000) label = { kind: 'trending', text: `${compact(e.views)} views on YouTube` };
    } else if (e?.platform === 'X') {
      viral = Math.min(1, Math.log10((e.likes || 0) + 2 * (e.reposts || 0) + (e.replies || 0) + 1) / 4.5);
      if (e.likes >= 300) label = { kind: 'trending', text: `${compact(e.likes)} likes · ${compact(e.reposts)} reposts on X` };
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
    if (row.video_url) viral += 0.06; // a playable video is worth a little more
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
      lead.members = cl.items.map((x) => x.row.id); // seeing any version of the story counts as seeing it
      const n = outlets.size;
      lead.coverage = n;
      lead.alsoBy = [...outlets.keys()].filter((k) => k !== (lead.row.via || byId(lead.row.source_id)?.name?.split(' · ')[0])).slice(0, 4);
      lead.score += Math.min(0.5, 0.18 * Math.log2(n));
      if (n >= 3 && lead.label.kind === 'latest') lead.label = { kind: 'top', text: `Covered by ${n} outlets` };
      if (!lead.row.engagement && cl.items.some((x) => x.row.engagement)) lead.extraEngagement = cl.items.find((x) => x.row.engagement)?.row.engagement;
    }
  }

  // Videos are spread out: at most one in any five stories, so the feed stays a news feed.
  function spaceVideos(list, gap = 5) {
    const out = [], held = [];
    let last = -gap;
    for (const x of list) {
      if (held.length && out.length - last >= gap) { out.push(held.shift()); last = out.length - 1; }
      if (!x.row.video_url) { out.push(x); continue; }
      if (out.length - last >= gap) { out.push(x); last = out.length - 1; } else held.push(x);
    }
    for (const x of held) out.push(x);
    return out;
  }

  const cache = new Map(); // region → { at, version, list }
  async function engagementFor(ids, uid) {
    const out = new Map(ids.map((id) => [id, { likes: 0, comments: 0, reposts: 0, liked: false, reposted: false }]));
    if (!ids.length) return out;
    // All five counts at once (in parallel), not one after another.
    const [likes, reposts, comments, myLikes, myReposts] = await Promise.all([
      ...[['feed_likes'], ['feed_reposts'], ['feed_comments']].map(([table]) => db.q(`SELECT item_id, COUNT(*) n FROM ${table} WHERE item_id IN (?) GROUP BY item_id`, [ids])),
      uid ? db.q('SELECT item_id FROM feed_likes WHERE user_id=? AND item_id IN (?)', [uid, ids]) : [],
      uid ? db.q('SELECT item_id FROM feed_reposts WHERE user_id=? AND item_id IN (?)', [uid, ids]) : [],
    ]);
    for (const r of likes) out.get(r.item_id).likes = Number(r.n);
    for (const r of reposts) out.get(r.item_id).reposts = Number(r.n);
    for (const r of comments) out.get(r.item_id).comments = Number(r.n);
    for (const r of myLikes) out.get(r.item_id).liked = true;
    for (const r of myReposts) out.get(r.item_id).reposted = true;
    return out;
  }

  async function ranked(region) {
    const c = cache.get(region);
    if (c && !dirty && Date.now() - c.at < 20000) return c;
    if (c && Date.now() - c.at < 4000) return c;
    const rows = await db.q(`SELECT id, source_id, region, topic, url, title, COALESCE(ai_summary, summary) summary, image_url, video_url, via, discuss_url, engagement, src_rank, published_at, fetched_at
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
    while (out.length < 600 && [...buckets.values()].some((l) => l.length)) {
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
    const spaced = spaceVideos(out);
    const version = require('crypto').createHash('sha1').update(spaced.slice(0, 60).map((x) => x.row.id).join(',')).digest('hex').slice(0, 16);
    const entry = { at: Date.now(), version, list: spaced };
    cache.set(region, entry);
    dirty = false;
    return entry;
  }

  // ───── For You: personal ranking from what each person likes ─────
  // Signals (last 30 days, fading over ~10 days): like ×3, comment ×4, repost ×4, open ×1.5.
  // Profile = interest weights for topics, publishers and title words. Each story's personal score
  // = trending score + match with the profile; sections the person likes get more room. Every 4th
  // story is chosen purely by what's trending, so nobody gets stuck in a bubble.
  const profiles = new Map(); // uid → { at, p }
  async function interests(uid) {
    const hit = profiles.get(uid);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    const since = new Date(Date.now() - 30 * 86400e3);
    const sig = [];
    for (const [table, w] of [['feed_likes', 3], ['feed_comments', 4], ['feed_reposts', 4]]) {
      for (const r of await db.q(`SELECT item_id id, created_at FROM ${table} WHERE user_id=? AND created_at > ? ORDER BY created_at DESC LIMIT 300`, [uid, since])) sig.push({ id: r.id, w, t: ms(r.created_at) });
    }
    // Behaviour: opens, how long a story was read on screen (dwell), and quick scroll-pasts (less of this).
    // Videos: watching with sound counts a lot (more the longer you watch); a muted autoplay you let
    // run counts a little; one scrolled past in a couple of seconds counts slightly against.
    let videoScore = 0;
    for (const r of await db.q(`SELECT item id, type, value, created_at FROM analytics_events WHERE user_id=? AND type IN ('buzz_open','buzz_dwell','buzz_skip','buzz_play','buzz_autoplay') AND created_at > ? ORDER BY created_at DESC LIMIT 800`, [uid, since]).catch(() => [])) {
      const v = Number(r.value) || 0;
      let w;
      // dwell value = % of the story's reading time spent in the reading zone (100 = read fully).
      if (r.type === 'buzz_open') w = 1.5;
      else if (r.type === 'buzz_dwell') w = Math.min(1.8, (v / 100) * 1.2);
      else if (r.type === 'buzz_play') w = 1.2 + Math.min(1.8, v / 40);
      else if (r.type === 'buzz_autoplay') w = v >= 8 ? 0.3 + Math.min(0.7, v / 60) : -0.1;
      else w = -0.25;
      if (r.type === 'buzz_play' || r.type === 'buzz_autoplay') videoScore += w * Math.exp(-(Date.now() - ms(r.created_at)) / (10 * 86400e3));
      sig.push({ id: r.id, w, t: ms(r.created_at) });
    }
    // Impressions: every story this person was shown, with its topic and publisher (kept even after
    // the story itself expires), so the profile can tell "likes cricket" from "was shown lots of cricket".
    const imp = await db.q('SELECT item_id, topic, source_id FROM feed_seen WHERE user_id=? AND seen_at > ? ORDER BY seen_at DESC LIMIT 4000', [uid, since]).catch(() => []);
    const impOf = new Map(imp.map((r) => [r.item_id, r]));
    const p = { topics: {}, sources: {}, words: {}, n: sig.length, imp: imp.length, impTopics: {}, topicLift: {}, sourceLift: {}, video: 0 };
    // How much this person likes videos: watch score vs how many videos they were shown.
    const vidShown = Number((await db.one('SELECT COUNT(*) n FROM feed_seen s JOIN feed_items i ON i.id=s.item_id WHERE s.user_id=? AND s.seen_at > ? AND i.video_url IS NOT NULL', [uid, since]).catch(() => null))?.n || 0);
    p.video = videoScore > 0 ? Math.min(1.5, videoScore / Math.max(3, vidShown * 0.25)) : videoScore < 0 ? Math.max(-0.5, videoScore / 2) : vidShown >= 15 ? -0.5 : 0;
    if (sig.length) {
      const items = new Map((await db.q('SELECT id, title, topic, source_id, via FROM feed_items WHERE id IN (?)', [[...new Set(sig.map((x) => x.id))]])).map((r) => [r.id, r]));
      for (const x of sig) {
        const it = items.get(x.id) || (impOf.has(x.id) ? { title: '', topic: impOf.get(x.id).topic, source_id: impOf.get(x.id).source_id } : null);
        if (!it) continue;
        const w = x.w * Math.exp(-(Date.now() - x.t) / (10 * 86400e3));
        p.topics[it.topic] = (p.topics[it.topic] || 0) + w;
        const src = it.via || it.source_id;
        p.sources[src] = (p.sources[src] || 0) + w;
        for (const t of tokens(it.title)) p.words[t] = (p.words[t] || 0) + w;
      }
      const norm = (o, keep) => {
        const top = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, keep);
        const max = top[0]?.[1] || 1;
        return Object.fromEntries(top.map(([k, v]) => [k, v / max]));
      };
      p.topics = norm(p.topics, 10); p.sources = norm(p.sources, 25); p.words = norm(p.words, 80);
    }
    // Engagement rate per topic and publisher vs this person's average (1 = average): a topic shown
    // 40 times and never opened sinks; one opened every time rises. Smoothed so a few stories don't swing it.
    if (imp.length >= 20) {
      const engaged = new Set(sig.filter((x) => x.w >= 0.7).map((x) => x.id));
      const T = {}, S = {};
      let pos = 0;
      for (const r of imp) {
        const e = engaged.has(r.item_id) ? 1 : 0;
        pos += e;
        (T[r.topic] ||= [0, 0]); T[r.topic][0]++; T[r.topic][1] += e;
        if (r.source_id) { (S[r.source_id] ||= [0, 0]); S[r.source_id][0]++; S[r.source_id][1] += e; }
      }
      const avg = (pos + 1) / (imp.length + 5);
      const lift = ([n, k]) => ((k + 8 * avg) / (n + 8)) / avg;
      for (const [t, v] of Object.entries(T)) { p.impTopics[t] = v[0]; p.topicLift[t] = lift(v); }
      for (const [t, v] of Object.entries(S)) if (v[0] >= 5) p.sourceLift[t] = lift(v);
      p.n += 1;
    }
    // Topics from the person's own chats (only if they turned it on): keywords, never messages.
    const chat = await chatInterests(uid);
    if (chat) {
      for (const [w, v] of Object.entries(chat)) p.words[w] = Math.max(p.words[w] || 0, 0.8 * v);
      p.n += Object.keys(chat).length ? 1 : 0;
    }
    profiles.set(uid, { at: Date.now(), p });
    return p;
  }

  // ───── chat topics (opt-in) ─────
  // When someone turns on "Personalise Buzz from my chats", words from messages THEY send are turned
  // into topic keywords (stop-words, numbers, links and short words dropped) and kept as an encrypted
  // weight list — the messages themselves are never stored here. Weights fade over ~2 weeks.
  const CHAT_STOP = new Set(('watch watching watched amazing awesome tonight today tomorrow yesterday morning evening night crazy planning plan plans ride going come coming good great nice cool okay fine sure yeah yess yes nope thanks thank please sorry really very much more some like love lovely haha hahaha lol omg wow what when where which while with will would could should about after again also always another anything around back because been before being best better both call calling called cant come could didnt does doesnt doing done dont down each even ever every first from gonna gotta have having here home hope just keep know last later leave left life little look looking lots made make many maybe mean meet message miss money need next nothing number only other ours over people place pretty quite right said same saying says seen send sent should show since sleep something sometimes soon start still stuff such sure take talk tell than that thats their them then there these they thing things think this those though thought through time told took true trying tried until very want wanted wants week weekend well went were what whats where while will wish with without wont work working world would yeah year years your yours feel feeling happy free busy reach reached wait waiting').split(' '));
  async function chatInterests(uid) {
    const row = await db.one('SELECT data_enc FROM user_interests WHERE user_id=?', [uid]);
    const d = row && C.decJson(row.data_enc, null);
    if (!d?.words) return null;
    const out = {};
    const now = Date.now();
    let max = 0;
    // A topic counts once it has come up at least twice (fading over ~2 weeks).
    for (const [w, [v, t]] of Object.entries(d.words)) { if (CHAT_STOP.has(w)) continue; const x = v * Math.exp(-(now - t) / (14 * 86400e3)); if (x >= 1.6) { out[w] = x; max = Math.max(max, x); } }
    for (const w of Object.keys(out)) out[w] /= max || 1;
    return Object.keys(out).length ? out : null;
  }
  const chatLocks = new Map();
  async function learnFromChat(uid, text) {
    const words = [...tokens(String(text).replace(/https?:\/\/\S+|\S+@\S+|\d+/g, ' '))].filter((w) => w.length <= 24 && !CHAT_STOP.has(w)).slice(0, 12);
    if (!words.length) return;
    const prev = chatLocks.get(uid) || Promise.resolve();
    const job = prev.then(async () => {
      const row = await db.one('SELECT data_enc FROM user_interests WHERE user_id=?', [uid]);
      const d = (row && C.decJson(row.data_enc, null)) || { words: {} };
      const now = Date.now();
      for (const w of words) { const [v = 0, t = now] = d.words[w] || []; d.words[w] = [v * Math.exp(-(now - t) / (14 * 86400e3)) + 1, now]; }
      const kept = Object.entries(d.words).sort((a, b) => b[1][0] - a[1][0]).slice(0, 250);
      d.words = Object.fromEntries(kept);
      await db.q('INSERT INTO user_interests (user_id, data_enc) VALUES (?,?) ON DUPLICATE KEY UPDATE data_enc=VALUES(data_enc), updated_at=CURRENT_TIMESTAMP(3)', [uid, C.enc(d)]);
      profiles.delete(uid);
    }).catch(() => {});
    chatLocks.set(uid, job);
    await job;
  }
  async function forgetChatInterests(uid) { await db.q('DELETE FROM user_interests WHERE user_id=?', [uid]); profiles.delete(uid); }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // How much someone cares about a section: what they engaged with, adjusted by how often they engage
  // when it's shown (0 = neutral; negative = keeps being shown, keeps being ignored).
  const topicScore = (p, t) => 0.65 * (p.topics[t] || 0) + 0.35 * (clamp(p.topicLift[t] ?? 1, 0, 2) - 1);
  function affinity(x, p) {
    const r = x.row;
    const t = topicScore(p, r.topic);
    const s = (p.sources[r.via || r.source_id] || 0) + 0.3 * (clamp(p.sourceLift[r.source_id] ?? 1, 0, 2) - 1);
    let k = 0;
    for (const w of tokens(r.title)) k += p.words[w] || 0;
    return 0.3 * t + 0.2 * s + 0.5 * Math.min(1, k / 1.2) + (r.video_url ? 0.35 * (p.video || 0) : 0);
  }

  // ───── seen stories never come back ─────
  // The app reports every story that was really on screen (half visible for a second). Those — and any
  // other outlet's version of the same story — are left out of that person's feed from then on.
  const seenCache = new Map(); // uid → { at, set, ver }
  async function seenOf(uid) {
    const hit = seenCache.get(uid);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit;
    const rows = await db.q('SELECT item_id FROM feed_seen WHERE user_id=? AND seen_at > ?', [uid, new Date(Date.now() - 5 * 86400e3)]).catch(() => []);
    const entry = { at: Date.now(), set: new Set(rows.map((r) => r.item_id)), ver: (hit?.ver || 0) + 1 };
    seenCache.set(uid, entry);
    return entry;
  }
  const SLOTS = new Set(['p', 'm', 't', 'x', 'r', 'g']);
  // pairs: [[itemId, slot], …] → { added, repeats } (a repeat = shown again in a later session; should be 0).
  async function markSeen(uid, pairs) {
    const want = new Map();
    for (const [id, slot] of pairs) { const k = String(id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24); if (k.length === 24) want.set(k, SLOTS.has(slot) ? slot : 'g'); }
    if (!want.size) return { added: 0, repeats: 0 };
    const ids = [...want.keys()];
    const already = new Set((await db.q('SELECT item_id FROM feed_seen WHERE user_id=? AND item_id IN (?)', [uid, ids])).map((r) => r.item_id));
    const fresh = ids.filter((id) => !already.has(id));
    if (fresh.length) {
      const meta = new Map((await db.q('SELECT id, topic, source_id FROM feed_items WHERE id IN (?)', [fresh])).map((r) => [r.id, r]));
      const [{ c }] = await db.q('SELECT COUNT(*) c FROM feed_seen WHERE user_id=?', [uid]);
      let seq = Number(c);
      await db.q('INSERT IGNORE INTO feed_seen (user_id, item_id, slot, topic, source_id, seq) VALUES ?',
        [fresh.map((id) => [uid, id, want.get(id), meta.get(id)?.topic || null, meta.get(id)?.source_id || null, ++seq])]);
    }
    const sc = seenCache.get(uid);
    if (sc) { for (const id of ids) sc.set.add(id); sc.ver++; }
    if (fresh.length >= 10) profiles.delete(uid);
    return { added: fresh.length, repeats: already.size };
  }
  const isSeen = (x, seen) => seen.has(x.row.id) || (x.members ? x.members.some((id) => seen.has(id)) : false);

  // ───── the personal feed ─────
  // Repeating pattern of 8 slots:
  //   p personal best · m section mix · p · t trending · p · m · p · x explore
  // Half is what this person likes, a quarter keeps the city/section balance, one in eight is purely
  // what's big right now, and one in eight tries a section they rarely see (so tastes can grow and
  // nobody is stuck in a bubble). Every story carries its slot so the admin portal can measure each part.
  const PATTERN = ['p', 'm', 'p', 't', 'p', 'm', 'p', 'x'];
  const personalCache = new Map(); // uid:region → { at, key, entry }
  async function personalized(region, uid) {
    const base = await ranked(region);
    const [p, seen] = [await interests(uid), await seenOf(uid)];
    const key = uid + ':' + region;
    const want = base.version + ':' + seen.ver + ':' + p.n;
    const hit = personalCache.get(key);
    if (hit && hit.key === want && Date.now() - hit.at < 15000) return hit.entry;
    const pool = base.list.filter((x) => !isSeen(x, seen.set));
    let out;
    if (!p.n) out = pool.map((x) => ({ ...x, slot: 'g' }));
    // Video lovers get a video every 2nd–3rd story; people who skip videos get fewer.
    else out = spaceVideos(arrange(pool, p, region), p.video >= 1 ? 2 : p.video >= 0.4 ? 3 : p.video < 0 ? 7 : 4);
    const version = require('crypto').createHash('sha1').update(out.slice(0, 60).map((x) => x.row.id).join(',')).digest('hex').slice(0, 16);
    const entry = { at: Date.now(), version, list: out };
    personalCache.set(key, { at: Date.now(), key: want, entry });
    if (personalCache.size > 5000) personalCache.delete(personalCache.keys().next().value);
    return entry;
  }

  function arrange(pool, p, region) {
    const mix = region === 'india' ? MIX_INDIA : MIX_CITY;
    const buckets = new Map(mix.map(([b]) => [b, []]));
    for (const x of pool) {
      const b = bucketOf(x.row, region);
      if (buckets.has(b)) buckets.get(b).push({ ...x, pscore: x.score + 0.7 * affinity(x, p) });
    }
    for (const list of buckets.values()) list.sort((a, b) => b.pscore - a.pscore);
    // Sections the person enjoys get a bigger share; ignored ones shrink (never to nothing).
    const weights = new Map(mix.map(([b, w]) => [b, w * (1 + 3 * Math.max(-0.25, topicScore(p, b)))]));
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    const credit = new Map(mix.map(([b]) => [b, 0]));
    const personal = pool.map((x) => ({ x, a: affinity(x, p) })).filter((y) => y.a > 0.12)
      .sort((u, v) => (v.a + 0.6 * v.x.score) - (u.a + 0.6 * u.x.score));
    const general = [...pool];
    // Explore: sections this person has seen least compared with their normal share.
    const impTotal = Object.values(p.impTopics).reduce((a, b) => a + b, 0) || 1;
    const mixTotal = mix.reduce((a, [, w]) => a + w, 0);
    const exploreOrder = mix.map(([b, w]) => [b, ((p.impTopics[b] || 0) / impTotal) / (w / mixTotal)]).sort((a, b) => a[1] - b[1]).map(([b]) => b);
    const out = [], used = new Set(), recent = [];
    let lastSource = null;
    // Variety: skip a story that's nearly the same as one of the last few (unless nothing else is left).
    const tooSimilar = (x) => { const tk = tokens(x.row.title); return recent.some((r) => { let n = 0; for (const w of tk) if (r.has(w)) n++; return n >= 3; }); };
    const takeFrom = (arr, get = (y) => y, varied = false) => {
      let k = -1;
      for (let i = 0; i < arr.length && i < 40; i++) {
        const x = get(arr[i]);
        if (used.has(x.row.id) || x.row.source_id === lastSource) continue;
        if (varied && tooSimilar(x)) continue;
        k = i; break;
      }
      if (k < 0) k = arr.findIndex((y) => !used.has(get(y).row.id));
      return k < 0 ? null : get(arr.splice(k, 1)[0]);
    };
    let ex = 0;
    while (out.length < pool.length) {
      let slot = PATTERN[out.length % PATTERN.length], x = null;
      if (slot === 'p') x = takeFrom(personal, (y) => y.x, true);
      else if (slot === 't') x = takeFrom(general);
      else if (slot === 'x') {
        for (let i = 0; i < exploreOrder.length && !x; i++) {
          const b = exploreOrder[(ex + i) % exploreOrder.length];
          const list = buckets.get(b).filter((y) => !used.has(y.row.id)).sort((u, v) => v.score - u.score);
          if (list.length) { x = list[0]; ex++; }
        }
      }
      if (!x) {
        slot = 'm';
        for (const [b, w] of weights) credit.set(b, credit.get(b) + w / total);
        const pick = [...credit.entries()].filter(([b]) => buckets.get(b).some((y) => !used.has(y.row.id))).sort((a, b) => b[1] - a[1])[0];
        if (pick) { x = takeFrom(buckets.get(pick[0]), undefined, true); credit.set(pick[0], pick[1] - 1); }
      }
      if (!x) { x = takeFrom(general); slot = 't'; }
      if (!x) break;
      if (used.has(x.row.id)) continue;
      used.add(x.row.id);
      lastSource = x.row.source_id;
      recent.push(tokens(x.row.title)); if (recent.length > 4) recent.shift();
      out.push({ ...x, slot });
    }
    return out;
  }

  // "More like this": stories closest to the one just liked (shared title words, same topic/publisher).
  async function relatedTo(itemId, region, uid, exclude = new Set()) {
    const it = await db.one('SELECT id, title, topic, source_id FROM feed_items WHERE id=?', [itemId]);
    if (!it) return [];
    const tk = tokens(it.title);
    const base = await ranked(region);
    const seen = uid ? (await seenOf(uid)).set : new Set();
    const scored = [];
    for (const x of base.list) {
      if (x.row.id === itemId || exclude.has(x.row.id) || isSeen(x, seen)) continue;
      let n = 0;
      for (const w of tokens(x.row.title)) if (tk.has(w)) n++;
      const sc = n * 1.0 + (x.row.topic === it.topic ? 0.6 : 0) + (x.row.source_id === it.source_id ? 0.2 : 0) + x.score * 0.3;
      if (n >= 1 || x.row.topic === it.topic) scored.push({ x, sc, n });
    }
    scored.sort((a, b) => b.sc - a.sc);
    const pick = scored.filter((s) => s.n >= 1).slice(0, 4);
    if (pick.length < 4) pick.push(...scored.filter((s) => s.n === 0).slice(0, 4 - pick.length));
    const eng = await engagementFor(pick.map((s) => s.x.row.id), uid);
    return pick.map((s) => present({ ...s.x, slot: 'r' }, eng.get(s.x.row.id)));
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
      coverage: x.coverage || 1, alsoBy: x.alsoBy || [], slot: x.slot || 'g',
      likes: e.likes, comments: e.comments, reposts: e.reposts, liked: e.liked, reposted: e.reposted,
    };
  }

  // ───── routes ─────
  app.get('/api/feed', auth, wrap(async (req, res) => {
    const region = REGIONS.has(String(req.query.region)) ? String(req.query.region) : 'india';
    const offset = Math.max(0, toInt(req.query.offset) || 0);
    const limit = Math.min(48, Math.max(1, toInt(req.query.limit) || 24));
    const r = await personalized(region, req.uid);
    const page = r.list.slice(offset, offset + limit);
    const eng = await engagementFor(page.map((x) => x.row.id), req.uid);
    const lastOk = Math.max(0, ...[...state.values()].map((s) => (s.last_ok ? ms(s.last_ok) : 0)));
    res.json({
      region, regionName: regionName(region), version: r.version, checkedAt: Date.now(), collectedAt: lastOk || null,
      items: page.map((x) => present(x, eng.get(x.row.id))), hasMore: offset + limit < r.list.length, total: r.list.length,
    });
  }));

  // The next stories for the endless feed: everything after what the app already shows (it sends the
  // ids it has), so stories never repeat or get skipped while the ranking moves underneath.
  app.post('/api/feed/more', auth, wrap(async (req, res) => {
    const region = REGIONS.has(String(req.body?.region)) ? String(req.body.region) : 'india';
    const limit = Math.min(48, Math.max(1, toInt(req.body?.limit) || 24));
    const have = new Set((Array.isArray(req.body?.have) ? req.body.have : []).slice(0, 1500).map(String));
    const r = await personalized(region, req.uid);
    const rest = r.list.filter((x) => !have.has(x.row.id));
    const page = rest.slice(0, limit);
    const eng = await engagementFor(page.map((x) => x.row.id), req.uid);
    res.json({ region, items: page.map((x) => present(x, eng.get(x.row.id))), hasMore: rest.length > limit });
  }));

  // Search index: every story we keep (last 4 days) as lower-case text + its filters, in memory.
  // Loaded once, then topped up with new stories every minute (on the background connections).
  const index = { rows: new Map(), last: 0, at: 0, loading: null };
  const searchCache = new Map();
  async function searchIndex() {
    if (Date.now() - index.at < 60000) return;
    if (index.loading) return index.loading;
    index.loading = (async () => {
      const from = index.last ? new Date(index.last - 120000) : new Date(Date.now() - 5 * 86400e3);
      const rows = await bg.q(`SELECT id, source_id, region, topic, title, LEFT(COALESCE(ai_summary, summary), 400) summary, video_url IS NOT NULL video, engagement IS NOT NULL eng,
        published_at, fetched_at FROM feed_items WHERE fetched_at > ?`, [from]);
      for (const r of rows) {
        const f = ms(r.fetched_at);
        if (f > index.last) index.last = f;
        index.rows.set(r.id, { id: r.id, source: r.source_id, region: r.region, topic: r.topic, video: !!Number(r.video), eng: !!Number(r.eng),
          ts: r.published_at ? ms(r.published_at) : f, text: `${r.title} ${r.summary || ''}`.toLowerCase() });
      }
      const old = Date.now() - 5 * 86400e3;
      for (const [id, e] of index.rows) if (e.ts < old) index.rows.delete(id);
      index.at = Date.now();
    })().finally(() => { index.loading = null; });
    return index.loading;
  }
  setTimeout(() => searchIndex().catch(() => {}), 20000).unref();

  // Search and filters. Words are matched in titles and summaries (all words must appear), within
  // a time window; results are ranked by relevance + how big the story is, or newest first.
  // Without a query, a section/type filter lists that slice of the feed, and the trending searches
  // (Google Trends) are returned as suggestions.
  const SECTIONS = new Set(['india', 'local', 'politics', 'entertainment', 'sports', 'tech', 'business', 'world']);
  const WINDOWS = { hour: 3600e3, today: 24 * 3600e3, week: 7 * 24 * 3600e3 };
  app.get('/api/feed/search', auth, wrap(async (req, res) => {
    rateLimit?.('buzz-search:' + req.uid, 60, 60000);
    const region = REGIONS.has(String(req.query.region)) ? String(req.query.region) : 'india';
    const q = String(req.query.q || '').trim().slice(0, 80);
    const section = SECTIONS.has(String(req.query.section)) ? String(req.query.section) : null;
    const type = ['video', 'social', 'news', 'viral'].includes(String(req.query.type)) ? String(req.query.type) : null;
    const win = WINDOWS[String(req.query.time)] || WINDOWS.week;
    const sort = req.query.sort === 'latest' ? 'latest' : 'top';
    const words = [...new Set(q.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter((w) => w.length >= 2))].slice(0, 6);
    // Section/type chips without a query are the same for everyone in a city: cached for 30 s.
    const ckey = [region, words.join(' '), section, type, req.query.time, sort].join('|');
    const hit = searchCache.get(ckey);
    let list, trending;
    if (hit && Date.now() - hit.at < 30000) ({ list, trending } = hit);
    else {
    // Match in memory (instant), then read just the matching stories by id.
    await searchIndex();
    const since = Date.now() - win;
    const social = type === 'social' ? new Set(SOURCES.filter((x) => x.social).map((x) => x.id)) : null;
    const hits = [];
    for (const e of index.rows.values()) {
      if (e.ts < since) continue;
      if (section === 'local') { if (e.topic !== 'local' || e.region !== region) continue; }
      else if (section) { if (e.topic !== section || !(e.region === region || e.region === 'india' || e.region === 'world')) continue; }
      else if (!(e.region === region || e.region === 'india' || e.region === 'world' || (e.topic !== 'local' && e.topic !== 'politics'))) continue;
      if (type === 'video' && !e.video) continue;
      if (type === 'news' && e.video) continue;
      if (type === 'viral' && !e.eng) continue;
      if (social && !social.has(e.source)) continue;
      if (words.length && !words.every((w) => e.text.includes(w))) continue;
      hits.push(e);
    }
    hits.sort((a, b) => b.ts - a.ts);
    const pick = hits.slice(0, 160).map((e) => e.id);
    const rows = pick.length ? await db.q(`SELECT id, source_id, region, topic, url, title, COALESCE(ai_summary, summary) summary, image_url, video_url, via, discuss_url, engagement, src_rank, published_at, fetched_at
      FROM feed_items WHERE id IN (?)`, [pick]) : [];
    rows.sort((a, b) => pick.indexOf(a.id) - pick.indexOf(b.id));
    const seenTitle = new Set();
    list = [];
    for (const r of rows) {
      const key = r.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
      if (seenTitle.has(key)) continue; // the same headline from several feeds
      seenTitle.add(key);
      const x = { row: r, ...score(r, null, region) };
      const title = r.title.toLowerCase();
      x.rel = words.reduce((n, w) => n + (title.includes(w) ? 2 : 0.5), 0) + (words.length && title.includes(words.join(' ')) ? 2 : 0);
      list.push(x);
    }
    if (sort === 'latest') list.sort((a, b) => b.ts - a.ts);
    else list.sort((a, b) => (b.rel + b.score * 3) - (a.rel + a.score * 3));
    list = list.slice(0, 40);
    trending = [];
    if (!words.length) {
      const tr = await db.q(`SELECT title, engagement FROM feed_items WHERE source_id IN (?) AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 60`,
        [['trends-in', ...SOURCES.filter((x) => x.trends && x.region === region).map((x) => x.id)], new Date(Date.now() - 24 * 3600e3)]);
      const seen = new Set();
      trending = tr.map((t) => ({ t: t.title.split(/\s[-–|·]\s/)[0].trim(), n: (() => { try { return JSON.parse(t.engagement)?.searchesN || 0; } catch { return 0; } })() }))
        .filter((t) => t.t.length >= 3 && t.t.length <= 40 && !seen.has(t.t.toLowerCase()) && seen.add(t.t.toLowerCase()))
        .sort((a, b) => b.n - a.n).slice(0, 10).map((t) => t.t);
    }
    searchCache.set(ckey, { at: Date.now(), list, trending });
    if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value);
    }
    const e2 = await engagementFor(list.map((x) => x.row.id), req.uid);
    res.json({ q, items: list.map((x) => present({ ...x, slot: 's' }, e2.get(x.row.id))), trending });
  }));

  // Cities people can pick (and the coordinates used to find the nearest one).
  app.get('/api/feed/regions', auth, (req, res) => {
    res.json({ regions: [...Object.entries(CITIES).map(([id, c]) => ({ id, name: c.name, lat: c.lat, lon: c.lon })).sort((a, b) => a.name.localeCompare(b.name)), { id: 'india', name: 'All of India' }] });
  });

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
    profiles.delete(req.uid);
    const region = REGIONS.has(String(req.body?.region)) ? String(req.body.region) : 'india';
    const exclude = new Set(Array.isArray(req.body?.have) ? req.body.have.slice(0, 600).map(String) : []);
    res.json({ ...(await counts(id, req.uid)), related: had ? [] : await relatedTo(id, region, req.uid, exclude) });
  }));

  app.post('/api/feed/:id/repost', auth, wrap(async (req, res) => {
    const id = await item(req.params.id);
    rateLimit('frepost:' + req.uid, 60, 60000);
    const had = await db.one('SELECT 1 x FROM feed_reposts WHERE item_id=? AND user_id=?', [id, req.uid]);
    if (had && req.body?.on !== true) await db.q('DELETE FROM feed_reposts WHERE item_id=? AND user_id=?', [id, req.uid]);
    else await db.q('INSERT IGNORE INTO feed_reposts (item_id, user_id) VALUES (?,?)', [id, req.uid]);
    dirty = true;
    profiles.delete(req.uid);
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
    profiles.delete(req.uid);
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
  return { start, tick, ranked, REGIONS, CITIES, learnFromChat, forgetChatInterests, markSeen, aiStatus: AI.status };
};
