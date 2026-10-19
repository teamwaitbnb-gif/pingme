// Friends map. Off by default: each person chooses who can see where they are — nobody, all their
// friends (people they have a one-to-one chat with), or only friends they pick — and whether to
// share their exact spot or just the area (~1 km). Locations are stored encrypted, only the latest
// one is kept, it updates while Ping Me is open, and it disappears from the map after 24 hours.
// Blocked people never see each other.
const STALE = 24 * 3600e3;

module.exports = function location({ app, db, C, auth, wrap, bad, toInt, rateLimit, emitToUser, getUser, userPublic, monitor }) {
  const DEFAULT = { mode: 'off', ids: [], precise: true };

  async function row(uid) {
    const r = await db.one('SELECT share_enc, loc_enc, updated_at FROM user_locations WHERE user_id=?', [uid]);
    const share = { ...DEFAULT, ...((r?.share_enc && C.decJson(r.share_enc, {})) || {}) };
    const loc = r?.loc_enc ? C.decJson(r.loc_enc, null) : null;
    return { share, loc, at: r?.updated_at ? new Date(r.updated_at).getTime() : null };
  }

  // Friends: everyone I have an active one-to-one chat with, minus blocks either way.
  async function friendsOf(uid) {
    const rows = await db.q(`SELECT DISTINCT o.user_id id FROM chat_members me
      JOIN chats c ON c.id=me.chat_id AND c.type='direct'
      JOIN chat_members o ON o.chat_id=me.chat_id AND o.user_id<>me.user_id
      WHERE me.user_id=? AND me.active=1 AND o.active=1
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id=me.user_id AND b.blocked_id=o.user_id) OR (b.user_id=o.user_id AND b.blocked_id=me.user_id))`, [uid]);
    return rows.map((r) => Number(r.id));
  }
  const canSee = (share, viewer) => share.mode === 'all' || (share.mode === 'some' && share.ids.includes(viewer));
  // Approximate sharing: snap to a ~1 km grid, so the exact spot never leaves the server.
  const shown = (loc, share) => (share.precise ? { lat: loc.lat, lon: loc.lon, acc: loc.acc } : { lat: Math.round(loc.lat * 100) / 100, lon: Math.round(loc.lon * 100) / 100, acc: 1000 });

  app.get('/api/location/settings', auth, wrap(async (req, res) => {
    const { share, at } = await row(req.uid);
    const friends = await friendsOf(req.uid);
    res.json({ share, updatedAt: at, friends: await Promise.all(friends.map(async (id) => userPublic(id))) });
  }));

  app.post('/api/location/settings', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const mode = ['off', 'all', 'some'].includes(b.mode) ? b.mode : 'off';
    const friends = new Set(await friendsOf(req.uid));
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((id) => friends.has(id)).slice(0, 500);
    const share = { mode, ids, precise: b.precise !== false };
    // Turning sharing off also forgets the last location.
    await db.q('INSERT INTO user_locations (user_id, share_enc, loc_enc, updated_at) VALUES (?,?,NULL,NULL) ON DUPLICATE KEY UPDATE share_enc=VALUES(share_enc)' + (mode === 'off' ? ', loc_enc=NULL, updated_at=NULL' : ''), [req.uid, C.enc(share)]);
    monitor?.log?.(req.uid, 'map-share', { mode });
    // Friends' maps update right away (someone appearing, or disappearing).
    for (const f of friends) emitToUser(f, 'map:changed', { userId: req.uid });
    res.json({ share });
  }));

  app.post('/api/location', auth, wrap(async (req, res) => {
    rateLimit('loc:' + req.uid, 30, 60000);
    const lat = Number(req.body?.lat), lon = Number(req.body?.lon), acc = Math.min(5000, Math.max(0, Number(req.body?.acc) || 0));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw bad('Invalid location');
    const { share } = await row(req.uid);
    if (share.mode === 'off') return res.json({ ok: true, sharing: false });
    const loc = { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, acc: Math.round(acc) };
    await db.q('UPDATE user_locations SET loc_enc=?, updated_at=NOW(3) WHERE user_id=?', [C.enc(loc), req.uid]);
    for (const f of await friendsOf(req.uid)) if (canSee(share, f)) emitToUser(f, 'map:loc', { userId: req.uid, ...shown(loc, share), at: Date.now() });
    res.json({ ok: true, sharing: true });
  }));

  // Friends who share with me, with their latest location (last 24 hours only).
  app.get('/api/location/friends', auth, wrap(async (req, res) => {
    const friends = await friendsOf(req.uid);
    const rows = friends.length ? await db.q('SELECT user_id, share_enc, loc_enc, updated_at FROM user_locations WHERE user_id IN (?) AND loc_enc IS NOT NULL AND updated_at > ?', [friends, new Date(Date.now() - STALE)]) : [];
    const out = [];
    for (const r of rows) {
      const share = { ...DEFAULT, ...(C.decJson(r.share_enc, {}) || {}) };
      if (!canSee(share, req.uid)) continue;
      const loc = C.decJson(r.loc_enc, null);
      if (!loc) continue;
      out.push({ ...(await userPublic(Number(r.user_id))), ...shown(loc, share), approx: !share.precise, at: new Date(r.updated_at).getTime() });
    }
    const mine = await row(req.uid);
    res.json({ friends: out, me: { share: mine.share, at: mine.at }, friendCount: friends.length });
  }));
};
