// In-app ads, run by the owner from the admin page. Each ad is a photo or a video with a headline,
// a short text, a button and a link. Placements: inside the Buzz feed, and a banner above the chat
// list. Ads can target a city, run between dates, and be weighted. Every ad is clearly marked
// "Sponsored". Views (shown on screen for a second) and taps are counted per day.
const crypto = require('crypto');

const PLACEMENTS = ['buzz', 'chats'];
const MAX_MEDIA = 40 * 1024 * 1024; // 40 MB per photo/video

module.exports = function ads({ app, db, C, auth, wrap, bad, notFound, toInt, clampStr, isAdmin, media, express, buzz }) {
  const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Admin key required' }));
  const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

  const view = (r) => {
    const d = C.decJson(r.data_enc, {}) || {};
    return { id: Number(r.id), active: !!r.active, placement: r.placement, kind: d.kind || 'image', mediaId: r.media_id ? Number(r.media_id) : null,
      name: d.name || '', advertiser: d.advertiser || '', headline: d.headline || '', text: d.text || '', cta: d.cta || 'Learn more', url: d.url || '',
      region: d.region || 'all', weight: Number(r.weight) || 1, every: d.every || 8, startAt: r.start_at ? new Date(r.start_at).getTime() : null,
      endAt: r.end_at ? new Date(r.end_at).getTime() : null, createdAt: new Date(r.created_at).getTime() };
  };

  // What phones get: running ads for a placement and city (cached for a minute).
  let cache = { at: 0, list: [] };
  async function running() {
    if (Date.now() - cache.at < 60000) return cache.list;
    const now = new Date();
    const rows = await db.q('SELECT * FROM ads WHERE active=1 AND media_id IS NOT NULL AND (start_at IS NULL OR start_at <= ?) AND (end_at IS NULL OR end_at > ?)', [now, now]);
    cache = { at: Date.now(), list: rows.map(view) };
    return cache.list;
  }
  const bust = () => { cache.at = 0; };
  const forPhone = (a) => ({ id: a.id, placement: a.placement, kind: a.kind, media: `/api/ads/media/${a.mediaId}`, advertiser: a.advertiser, headline: a.headline,
    text: a.text, cta: a.cta, url: a.url, weight: a.weight, every: a.every });

  app.get('/api/ads', auth, wrap(async (req, res) => {
    const placement = PLACEMENTS.includes(String(req.query.placement)) ? String(req.query.placement) : 'buzz';
    const region = String(req.query.region || 'india');
    res.set('Cache-Control', 'no-store');
    res.json({ ads: (await running()).filter((a) => a.placement === placement && (a.region === 'all' || a.region === region)).map(forPhone) });
  }));

  // Views and taps, counted per ad per day (each phone reports a view once per ad per session).
  app.post('/api/ads/:id/event', auth, wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const type = req.body?.type === 'click' ? 'clicks' : 'views';
    if (!id || !(await running()).some((a) => a.id === id)) return res.json({ ok: true });
    await db.q(`INSERT INTO ad_stats (ad_id, day, views, clicks) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE ${type}=${type}+1`, [id, istDay(), type === 'views' ? 1 : 0, type === 'clicks' ? 1 : 0]);
    res.json({ ok: true });
  }));

  // The ad's photo/video (only while it belongs to an ad).
  app.get('/api/ads/media/:id', auth, wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const used = id && (await db.one('SELECT 1 x FROM ads WHERE media_id=? LIMIT 1', [id]));
    if (!used) throw notFound();
    const a = await db.one('SELECT meta_enc, size, chunks, store, complete FROM attachments WHERE id=?', [id]);
    if (!a || !a.complete) throw notFound();
    const meta = C.decJson(a.meta_enc, {}) || {};
    res.setHeader('Content-Type', /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/.test(meta.mime) ? meta.mime : 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const total = Number(a.size);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = total - 1;
    if (range) {
      start = range[1] === '' ? total - Number(range[2]) : Number(range[1]);
      end = range[1] === '' || range[2] === '' ? total - 1 : Number(range[2]);
      start = Math.max(0, start); end = Math.min(end, total - 1);
      if (start > end) { res.status(416).setHeader('Content-Range', `bytes */${total}`); return res.end(); }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    return media.stream(res, { id, chunks: Number(a.chunks), store: a.store, size: total }, start, end);
  }));

  // ───── admin ─────
  app.get('/api/admin/ads', adminOnly, wrap(async (req, res) => {
    const rows = await db.q('SELECT * FROM ads ORDER BY id DESC LIMIT 200');
    const since = istDay(Date.now() - 29 * 86400e3);
    const stats = await db.q('SELECT ad_id, SUM(views) views, SUM(clicks) clicks, SUM(IF(day=?, views, 0)) today_views, SUM(IF(day=?, clicks, 0)) today_clicks FROM ad_stats WHERE day >= ? GROUP BY ad_id', [istDay(), istDay(), since]);
    const by = new Map(stats.map((s) => [Number(s.ad_id), s]));
    res.json({
      ads: rows.map((r) => { const a = view(r); const s = by.get(a.id) || {}; return { ...a, mediaUrl: a.mediaId ? `/api/admin/ads/media/${a.mediaId}` : null, views: Number(s.views || 0), clicks: Number(s.clicks || 0), todayViews: Number(s.today_views || 0), todayClicks: Number(s.today_clicks || 0) }; }),
      cities: [{ id: 'all', name: 'Everywhere' }, ...Object.entries(buzz.CITIES).map(([id, x]) => ({ id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)), { id: 'india', name: 'People who chose “All of India”' }],
    });
  }));
  // Admin preview of the media (same bytes, admin cookie instead of a user session).
  app.get('/api/admin/ads/media/:id', adminOnly, wrap(async (req, res, next) => {
    req.uid = 0;
    const id = toInt(req.params.id);
    const a = id && (await db.one('SELECT meta_enc, size, chunks, store, complete FROM attachments WHERE id=? AND chat_id=0', [id]));
    if (!a || !a.complete) throw notFound();
    const meta = C.decJson(a.meta_enc, {}) || {};
    res.setHeader('Content-Type', meta.mime || 'application/octet-stream');
    res.setHeader('Content-Length', Number(a.size));
    return media.stream(res, { id, chunks: Number(a.chunks), store: a.store, size: Number(a.size) }, 0, Number(a.size) - 1);
  }));

  // Upload a photo or video for an ad (the original file, kept as is).
  app.post('/api/admin/ads/upload', adminOnly, express.raw({ type: () => true, limit: MAX_MEDIA }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Empty file');
    const mime = clampStr(req.get('content-type') || '', 100).split(';')[0];
    if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/.test(mime)) throw bad('Use a JPG, PNG, WebP or GIF photo, or an MP4/WebM/MOV video');
    const name = clampStr(decodeURIComponent(req.get('x-file-name') || 'ad'), 120).replace(/[\\/\r\n]/g, '_');
    const chunks = Math.ceil(req.body.length / media.CHUNK);
    const r = await db.q('INSERT INTO attachments (chat_id, uploader_id, meta_enc, size, data, chunks, store, complete) VALUES (0,0,?,?,NULL,?,?,0)',
      [C.enc({ name, mime }), req.body.length, chunks, media.bucket() ? 'gcs' : 'db']);
    const id = Number(r.insertId);
    for (let i = 0; i < chunks; i++) await media.putChunk(id, i, req.body.subarray(i * media.CHUNK, (i + 1) * media.CHUNK));
    await db.q('UPDATE attachments SET complete=1 WHERE id=?', [id]);
    await db.q('INSERT IGNORE INTO attachment_refs (att_id) VALUES (?)', [id]); // never cleaned up as "abandoned"
    res.json({ mediaId: id, kind: mime.startsWith('video/') ? 'video' : 'image', url: `/api/admin/ads/media/${id}` });
  }));

  // Create or update an ad.
  app.post('/api/admin/ads', adminOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const placement = PLACEMENTS.includes(b.placement) ? b.placement : 'buzz';
    const url = String(b.url || '').trim();
    if (url && !/^https:\/\//.test(url)) throw bad('The link must start with https://');
    const headline = clampStr(String(b.headline || ''), 90).trim();
    if (!headline) throw bad('Add a headline');
    const mediaId = toInt(b.mediaId);
    if (!mediaId || !(await db.one('SELECT 1 x FROM attachments WHERE id=? AND chat_id=0 AND complete=1', [mediaId]))) throw bad('Upload a photo or video first');
    const region = b.region === 'all' || buzz.REGIONS.has(String(b.region)) ? String(b.region) : 'all';
    const data = {
      name: clampStr(String(b.name || headline), 60), advertiser: clampStr(String(b.advertiser || ''), 40).trim(), headline,
      text: clampStr(String(b.text || ''), 180).trim(), cta: clampStr(String(b.cta || 'Learn more'), 24).trim() || 'Learn more', url,
      kind: b.kind === 'video' ? 'video' : 'image', region, every: Math.max(4, Math.min(30, Number(b.every) || 8)),
    };
    const date = (v) => (v ? new Date(v) : null);
    const startAt = date(b.startAt), endAt = date(b.endAt);
    if ((startAt && isNaN(startAt)) || (endAt && isNaN(endAt))) throw bad('Check the dates');
    const weight = Math.max(1, Math.min(10, Number(b.weight) || 1));
    const active = b.active === false ? 0 : 1;
    let id = toInt(b.id);
    if (id) await db.q('UPDATE ads SET placement=?, media_id=?, data_enc=?, weight=?, active=?, start_at=?, end_at=? WHERE id=?', [placement, mediaId, C.enc(data), weight, active, startAt, endAt, id]);
    else id = Number((await db.q('INSERT INTO ads (placement, media_id, data_enc, weight, active, start_at, end_at) VALUES (?,?,?,?,?,?,?)', [placement, mediaId, C.enc(data), weight, active, startAt, endAt])).insertId);
    bust();
    res.json({ ok: true, id });
  }));
  app.post('/api/admin/ads/:id/active', adminOnly, wrap(async (req, res) => {
    await db.q('UPDATE ads SET active=? WHERE id=?', [req.body?.active ? 1 : 0, toInt(req.params.id)]);
    bust(); res.json({ ok: true });
  }));
  app.post('/api/admin/ads/:id/delete', adminOnly, wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const ad = await db.one('SELECT media_id FROM ads WHERE id=?', [id]);
    if (!ad) throw notFound();
    await db.q('DELETE FROM ads WHERE id=?', [id]);
    await db.q('DELETE FROM ad_stats WHERE ad_id=?', [id]);
    const still = ad.media_id && (await db.one('SELECT 1 x FROM ads WHERE media_id=? LIMIT 1', [ad.media_id]));
    if (ad.media_id && !still) {
      await media.removeChunks(await db.q('SELECT id, chunks, store FROM attachments WHERE id=?', [ad.media_id])).catch(() => {});
      await db.q('DELETE FROM attachments WHERE id=?', [ad.media_id]);
      await db.q('DELETE FROM attachment_refs WHERE att_id=?', [ad.media_id]);
    }
    bust(); res.json({ ok: true });
  }));

  return { running };
};
