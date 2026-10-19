// Friends map: where your friends are (only those who chose to share with you), on a map styled in
// Ping Me's own colours. Sharing is off until you turn it on; you pick all friends or just some, and
// exact spot or just the area. Your location is sent only while Ping Me is open.
import { h, icon, toast, openSheet, avatar, toggle, cell } from './ui.js';

const LIB = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl';
const STYLE = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' };
let libLoading = null;
function loadLib() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (libLoading) return libLoading;
  libLoading = new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: LIB + '.css' }));
    const s = h('script', { src: LIB + '.js', async: true });
    s.onload = () => resolve(window.maplibregl);
    s.onerror = () => { libLoading = null; reject(new Error('Map could not load — check your connection')); };
    document.head.append(s);
  });
  return libLoading;
}
const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

// Ping Me's palette on top of the open map style: calm, dark (or light) land, teal water, green parks,
// quiet roads — so friends' photos are what stands out.
async function customStyle(dark) {
  const s = await (await fetch(dark ? STYLE.dark : STYLE.light)).json();
  const P = dark
    ? { bg: '#0b0c0f', water: '#0f2a33', park: '#10241a', building: '#16181d', road: '#262a31', major: '#323843', motorway: '#3d4552', text: '#9aa3ad', halo: '#0b0c0f', boundary: '#3a3f48' }
    : { bg: '#f4f5f2', water: '#cfe8ef', park: '#dcefdc', building: '#e7e7e3', road: '#ffffff', major: '#ffffff', motorway: '#fde7b0', text: '#4b5563', halo: '#ffffff', boundary: '#c7cbd1' };
  for (const l of s.layers) {
    const id = l.id, p = (l.paint = l.paint || {});
    if (l.type === 'background') p['background-color'] = P.bg;
    else if (/water/.test(id) && l.type === 'fill') p['fill-color'] = P.water;
    else if (/waterway/.test(id) && l.type === 'line') p['line-color'] = P.water;
    else if (/park|wood|grass|landcover/.test(id) && l.type === 'fill') { p['fill-color'] = P.park; p['fill-opacity'] = 0.9; }
    else if (/landuse/.test(id) && l.type === 'fill') p['fill-color'] = P.bg;
    else if (/building/.test(id) && (l.type === 'fill' || l.type === 'fill-extrusion')) { p[l.type === 'fill' ? 'fill-color' : 'fill-extrusion-color'] = P.building; }
    else if (/motorway|trunk/.test(id) && l.type === 'line' && !/casing/.test(id)) p['line-color'] = P.motorway;
    else if (/major|primary|secondary/.test(id) && l.type === 'line' && !/casing/.test(id)) p['line-color'] = P.major;
    else if (/highway|road|minor|path|street/.test(id) && l.type === 'line' && !/casing/.test(id)) p['line-color'] = P.road;
    else if (/casing/.test(id) && l.type === 'line') p['line-color'] = P.bg;
    else if (/boundary/.test(id) && l.type === 'line') p['line-color'] = P.boundary;
    if (l.type === 'symbol') { p['text-color'] = P.text; p['text-halo-color'] = P.halo; p['text-halo-width'] = 1.2; }
  }
  return s;
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const fmtKm = (d) => (d < 1 ? `${Math.max(50, Math.round(d * 1000 / 50) * 50)} m` : d < 20 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`);

export function initMap(ctx) {
  // ctx: { api, socket(), me(), userAvatar(id), message(user) }
  let root = null, map = null, mapEl = null, listEl = null, introEl = null, statusEl = null;
  let friends = new Map(), markers = new Map(), meMarker = null, mePos = null, share = { mode: 'off', ids: [], precise: true };
  let watchId = null, lastSent = { t: 0, lat: 0, lon: 0 }, visible = false, fitted = false;

  // ───── sending my location (only while sharing, only while Ping Me is open) ─────
  function onPosition(p) {
    mePos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    drawMe();
    if (share.mode === 'off' || document.hidden) return;
    const moved = km(lastSent, mePos) * 1000;
    if (Date.now() - lastSent.t < 120000 && moved < 50) return; // every 2 min, or sooner after moving 50 m
    lastSent = { t: Date.now(), ...mePos };
    ctx.api('POST', '/api/location', mePos).catch(() => {});
  }
  function watch() {
    if (watchId != null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onPosition, (e) => { if (e.code === 1) { stopWatch(); setStatus('Location is blocked for Ping Me in your phone settings.'); } }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
  }
  function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
  // Called after sign-in: keep sharing while the app is open (no prompt — only if allowed before).
  async function resume() {
    try {
      const r = await ctx.api('GET', '/api/location/settings');
      share = r.share;
      if (share.mode === 'off') return;
      const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
      if (!perm || perm.state === 'granted') watch();
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && share.mode !== 'off' && watchId == null && visible) watch(); });

  // ───── screen ─────
  function setStatus(t) { if (statusEl) { statusEl.textContent = t || ''; statusEl.hidden = !t; } }
  function mount(container) {
    root = container;
    mapEl = h('div', { class: 'fm-map' });
    statusEl = h('div', { class: 'fm-status', hidden: true });
    listEl = h('div', { class: 'fm-list' });
    introEl = h('div', { class: 'fm-intro', hidden: true });
    root.replaceChildren(mapEl,
      h('div', { class: 'fm-top' },
        h('div', { class: 'fm-title' }, h('b', null, 'Friends'), h('span', { class: 'fm-share-state' })),
        h('button', { class: 'fm-btn', 'aria-label': 'Sharing settings', onclick: openSettings }, icon('settings'))),
      h('div', { class: 'fm-side' },
        h('button', { class: 'fm-btn', 'aria-label': 'Show me', onclick: () => { if (mePos) map?.flyTo({ center: [mePos.lon, mePos.lat], zoom: 14 }); else { watch(); toast('Finding you…', { timeout: 1500 }); } } }, icon('map')),
        h('button', { class: 'fm-btn', 'aria-label': 'Show everyone', onclick: () => fitAll(true) }, icon('users'))),
      statusEl, introEl, listEl);
  }
  async function makeMap() {
    try {
      const gl = await loadLib();
      const style = await customStyle(isDark());
      map = new gl.Map({ container: mapEl, style, center: [78.9629, 21.5937], zoom: 3.6, attributionControl: { compact: true }, pitchWithRotate: false, dragRotate: false });
      map.touchZoomRotate.disableRotation();
      map.on('load', () => { drawAll(); fitAll(false); });
    } catch (e) { setStatus(e.message); }
  }

  function pin(f) {
    const src = ctx.userAvatar(f.id);
    const el = h('button', { class: 'fm-pin' + (f.approx ? ' approx' : ''), 'aria-label': f.name, onclick: (e) => { e.stopPropagation(); focus(f.id); } },
      h('span', { class: 'fm-av' }, avatar({ id: f.id, name: f.name, src, size: 44 })),
      h('span', { class: 'fm-name' }, f.name.split(' ')[0]),
      h('span', { class: 'fm-ago' }, ago(f.at)));
    return el;
  }
  function drawAll() {
    if (!map) return;
    for (const [id, m] of markers) if (!friends.has(id)) { m.remove(); markers.delete(id); }
    for (const f of friends.values()) {
      const m = markers.get(f.id);
      if (m) { m.setLngLat([f.lon, f.lat]); m.getElement().querySelector('.fm-ago').textContent = ago(f.at); }
      else markers.set(f.id, new window.maplibregl.Marker({ element: pin(f), anchor: 'bottom' }).setLngLat([f.lon, f.lat]).addTo(map));
    }
    drawMe(); drawList();
  }
  function drawMe() {
    if (!map || !mePos) return;
    if (!meMarker) meMarker = new window.maplibregl.Marker({ element: h('div', { class: 'fm-me' }, h('i')) }).setLngLat([mePos.lon, mePos.lat]).addTo(map);
    else meMarker.setLngLat([mePos.lon, mePos.lat]);
    if (!fitted && !friends.size) { map.flyTo({ center: [mePos.lon, mePos.lat], zoom: 12 }); fitted = true; }
  }
  function fitAll(animate) {
    if (!map) return;
    const pts = [...friends.values()].map((f) => [f.lon, f.lat]);
    if (mePos) pts.push([mePos.lon, mePos.lat]);
    if (!pts.length) return;
    fitted = true;
    if (pts.length === 1) return map.flyTo({ center: pts[0], zoom: 13, animate });
    const b = pts.reduce((bb, p) => bb.extend(p), new window.maplibregl.LngLatBounds(pts[0], pts[0]));
    map.fitBounds(b, { padding: { top: introEl && !introEl.hidden ? 340 : 180, bottom: 240, left: 70, right: 90 }, maxZoom: 14, animate });
  }
  function focus(id) {
    const f = friends.get(id);
    if (!f || !map) return;
    map.flyTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 14) });
    const dist = mePos ? fmtKm(km(mePos, f)) + ' away · ' : '';
    const s = openSheet({ title: f.name, left: { label: 'Close' } });
    s.body.append(h('div', { class: 'fm-card' },
      avatar({ id: f.id, name: f.name, src: ctx.userAvatar(f.id), size: 72 }),
      h('b', null, f.name), h('span', null, `${dist}${f.approx ? 'Around here' : 'Here'} ${ago(f.at) === 'now' ? 'right now' : ago(f.at) + ' ago'}`),
      h('div', { class: 'fm-card-btns' },
        h('button', { class: 'btn', onclick: () => { s.close(); ctx.message(f); } }, icon('msg'), 'Message'),
        h('a', { class: 'btn secondary', href: `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`, target: '_blank', rel: 'noopener' }, icon('map'), 'Directions'))));
  }
  function drawList() {
    if (!listEl) return;
    const shareTxt = root?.querySelector('.fm-share-state');
    if (shareTxt) shareTxt.textContent = share.mode === 'off' ? 'You’re hidden' : share.mode === 'all' ? 'Sharing with all friends' : `Sharing with ${share.ids.length}`;
    introEl.hidden = share.mode !== 'off';
    if (share.mode === 'off') introEl.replaceChildren(
      h('b', null, 'See where your friends are'), h('span', null, 'Share your location with the friends you choose. It updates only while Ping Me is open, and you can hide anytime.'),
      h('div', { class: 'fm-intro-btns' }, h('button', { class: 'btn', onclick: openSettings }, 'Share my location')));
    const list = [...friends.values()].map((f) => ({ f, d: mePos ? km(mePos, f) : null })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || b.f.at - a.f.at);
    listEl.replaceChildren(list.length
      ? h('div', { class: 'fm-row-wrap' }, list.map(({ f, d }) => h('button', { class: 'fm-row', onclick: () => focus(f.id) },
        avatar({ id: f.id, name: f.name, src: ctx.userAvatar(f.id), size: 40 }),
        h('span', { class: 'fm-row-t' }, h('b', null, f.name), h('small', null, `${d != null ? fmtKm(d) + ' · ' : ''}${ago(f.at) === 'now' ? 'now' : ago(f.at) + ' ago'}${f.approx ? ' · approx.' : ''}`)))))
      : h('div', { class: 'fm-empty' }, 'No friends are sharing with you yet. Ask them to open Map and share their location.'));
  }

  async function refresh() {
    try {
      const r = await ctx.api('GET', '/api/location/friends');
      share = r.me.share;
      ctx.mergeUsers?.(r.friends.map(({ lat, lon, acc, approx, at, ...u }) => u)); // their photos
      friends = new Map(r.friends.map((f) => [f.id, f]));
      drawAll();
      if (!fitted && map?.loaded()) fitAll(false);
    } catch (e) { setStatus(e.message); }
  }

  function openSettings() {
    const s = openSheet({ title: 'Share my location', left: { label: 'Close' } });
    let mode = share.mode, ids = new Set(share.ids), precise = share.precise, people = [];
    const save = async () => {
      try {
        const r = await ctx.api('POST', '/api/location/settings', { mode, ids: [...ids], precise });
        share = r.share;
        if (share.mode !== 'off') {
          // Send right away (don't wait for the next move): the known spot, or ask the phone once.
          lastSent = { t: 0, lat: 0, lon: 0 };
          if (mePos) onPosition({ coords: { latitude: mePos.lat, longitude: mePos.lon, accuracy: mePos.acc } });
          else navigator.geolocation?.getCurrentPosition(onPosition, () => {}, { enableHighAccuracy: true, timeout: 20000 });
          watch();
        } else { stopWatch(); }
        drawList();
      } catch (e) { toast(e.message, { error: true }); }
    };
    const draw = () => s.body.replaceChildren(
      h('div', { class: 'group' }, [['off', 'Hidden (ghost mode)', 'Nobody sees where you are'], ['all', 'All my friends', 'Everyone you have a one-to-one chat with'], ['some', 'Only friends I choose', 'Pick below']].map(([v, l, sub]) =>
        h('button', { class: 'cell' + (mode === v ? ' on' : ''), onclick: () => { mode = v; draw(); save(); } }, h('span', { class: 'lb' }, l, h('small', null, sub)), mode === v ? icon('check') : null))),
      mode !== 'off' ? h('div', { class: 'group' }, cell({ icon: 'map', color: '#30b0c7', label: 'Exact location', sub: precise ? 'Friends see your exact spot' : 'Friends see only your area (about 1 km)', right: toggle(precise, (v) => { precise = v; draw(); save(); }) })) : null,
      mode === 'some' ? h('div', { class: 'group-label' }, 'Friends who can see you') : null,
      mode === 'some' ? h('div', { class: 'group' }, people.length ? people.map((u) => h('button', { class: 'user-row', style: { width: '100%' }, onclick: () => { if (ids.has(u.id)) ids.delete(u.id); else ids.add(u.id); draw(); save(); } },
        avatar({ id: u.id, name: u.name, src: ctx.userAvatar(u.id), size: 36 }), h('div', { class: 't' }, h('b', null, u.name)), ids.has(u.id) ? icon('check') : null)) : h('div', { class: 'empty-list' }, 'Start a chat with someone first')) : null,
      h('div', { class: 'group-foot' }, 'Your location is sent only while Ping Me is open, is stored encrypted, and disappears from friends’ maps after 24 hours. Turning sharing off deletes it.'));
    draw();
    ctx.api('GET', '/api/location/settings').then((r) => { ctx.mergeUsers?.(r.friends); people = r.friends; draw(); }).catch(() => {});
  }

  // Live updates from friends.
  function bindSocket() {
    const sock = ctx.socket();
    if (!sock || sock._fmBound) return;
    sock._fmBound = true;
    sock.on('map:loc', (d) => { const f = friends.get(d.userId); if (f) { Object.assign(f, d); drawAll(); } else if (visible) refresh(); });
    sock.on('map:changed', () => { if (visible) refresh(); });
  }

  function show(container) {
    visible = true;
    if (root !== container) { mount(container); makeMap(); }
    bindSocket();
    refresh();
    // Your own dot: only asks for location once you've chosen to share (or already allowed it).
    navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted' || share.mode !== 'off') watch(); }).catch(() => {});
    setTimeout(() => map?.resize(), 50);
  }
  function hide() { visible = false; if (share.mode === 'off') stopWatch(); }
  setInterval(() => { if (visible && !document.hidden) refresh(); }, 60000);

  return { show, hide, resume };
}
