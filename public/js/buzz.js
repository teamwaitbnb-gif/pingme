// Buzz: one live feed of real stories for where you are — local first (e.g. Hyderabad), mixed with
// India, tech, business, world, cricket and cinema. Our server collects the publisher feeds; the app
// checks /api/feed every 5 seconds while Buzz is on screen and merges new stories in place.
import { h, icon, toast, avatar, openSheet, store, fmtListTime } from './ui.js';

const POLL_MS = 5000;
const CITIES = [['hyderabad', 'Hyderabad'], ['bengaluru', 'Bengaluru'], ['mumbai', 'Mumbai'], ['delhi', 'Delhi'], ['chennai', 'Chennai'], ['kolkata', 'Kolkata'], ['pune', 'Pune'], ['india', 'All of India']];
const COORDS = { hyderabad: [17.385, 78.4867], bengaluru: [12.9716, 77.5946], mumbai: [19.076, 72.8777], delhi: [28.6139, 77.209], chennai: [13.0827, 80.2707], kolkata: [22.5726, 88.3639], pune: [18.5204, 73.8567] };

const ago = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return fmtListTime(t);
};
const initials = (name) => (name || '?').replace(/^(The|Google News ·)\s+/i, '').split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };

export function initBuzz(ctx) {
  // ctx: { api, me(), userAvatar(id), chats(), chatTitle(c), chatAvatar(c), sendToChat(chatId, text), saveRegion(r) }
  let root = null, feedEl = null, statusEl = null, newPill = null, moreBtn = null, sourcesEl = null;
  let region = ctx.me()?.settings?.buzzRegion || store.get('buzzRegion', null) || 'india';
  let cards = new Map(); // id → { el, data }
  let order = [];        // ids in display order
  let version = null, offset = 0, hasMore = false, inFlight = false, timer = null, visible = false;
  let lastCheck = 0, lastNew = 0, offline = false, pendingNew = 0;

  function mount(container) {
    root = container;
    const chip = h('button', { class: 'bz-loc', 'aria-label': 'Change location', onclick: pickRegion }, icon('map'), h('span', null, nameOf(region)), icon('chev'));
    statusEl = h('span', { class: 'bz-status', role: 'status', 'aria-live': 'polite' }, 'Loading…');
    newPill = h('button', { class: 'bz-new', hidden: true, onclick: () => { root.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); hideNew(); } }, icon('up'), h('span'));
    feedEl = h('div', { class: 'bz-feed' });
    moreBtn = h('button', { class: 'bz-more', hidden: true, onclick: loadMore }, 'More stories');
    sourcesEl = h('details', { class: 'bz-sources' }, h('summary', null, 'Sources & status'), h('div', { class: 'bz-src-list' }, 'Loading…'));
    sourcesEl.addEventListener('toggle', () => { if (sourcesEl.open) loadSources(); });
    root.replaceChildren(
      h('header', { class: 'bz-head' },
        h('div', { class: 'bz-title' }, h('b', null, 'Buzz'), h('span', { class: 'bz-live' }, h('i'), 'Live')),
        chip),
      h('div', { class: 'bz-sub' }, statusEl),
      region === 'india' && !store.get('buzzAskedCity') ? cityPrompt() : null,
      newPill, feedEl, moreBtn, sourcesEl);
    root.addEventListener('scroll', () => { if (root.scrollTop < 40) hideNew(); }, { passive: true });
    // Saved stories first (instant, and they survive a lost connection).
    const saved = store.get('buzzCache:' + region, null);
    if (saved?.items?.length) { renderAll(saved.items); setStatus(`Saved stories · ${ago(saved.at)}`); }
  }
  const nameOf = (r) => (CITIES.find((c) => c[0] === r) || CITIES[CITIES.length - 1])[1].replace('All of India', 'India');

  function cityPrompt() {
    const box = h('div', { class: 'bz-ask' },
      h('div', null, h('b', null, 'See what’s buzzing near you'), h('span', null, 'Local stories from your city, mixed with India, tech, business and the world.')),
      h('div', { class: 'bz-ask-btns' },
        h('button', { class: 'bz-btn', onclick: () => { box.remove(); useMyLocation(); } }, 'Use my location'),
        h('button', { class: 'bz-btn ghost', onclick: () => { box.remove(); pickRegion(); } }, 'Choose city')));
    return box;
  }

  function useMyLocation() {
    store.set('buzzAskedCity', true);
    if (!navigator.geolocation) return pickRegion();
    setStatus('Finding your city…');
    navigator.geolocation.getCurrentPosition((p) => {
      const { latitude: la, longitude: lo } = p.coords;
      let best = 'india', bestD = 120; // km
      for (const [k, [a, b]] of Object.entries(COORDS)) {
        const d = Math.hypot((la - a) * 111, (lo - b) * 111 * Math.cos((la * Math.PI) / 180));
        if (d < bestD) { bestD = d; best = k; }
      }
      setRegion(best);
      toast(best === 'india' ? 'Showing news from across India' : `Showing what’s buzzing in ${nameOf(best)}`);
    }, () => { setStatus(''); pickRegion(); }, { timeout: 10000, maximumAge: 3600e3 });
  }

  function pickRegion() {
    store.set('buzzAskedCity', true);
    const s = openSheet({ title: 'Your city', left: { label: 'Close' } });
    s.body.append(
      h('div', { class: 'group' },
        h('button', { class: 'cell', onclick: () => { s.close(); useMyLocation(); } }, h('span', { class: 'ci', style: { background: '#30d158' } }, icon('map')), h('span', { class: 'lb' }, 'Use my location')),
        ...CITIES.map(([k, label]) => h('button', { class: 'cell' + (k === region ? ' on' : ''), onclick: () => { s.close(); setRegion(k); } }, h('span', { class: 'lb' }, label), k === region ? icon('check') : null))),
      h('div', { class: 'group-foot' }, 'Your city decides the local stories. Everyone also gets India, tech, business, world, cricket and cinema.'));
  }

  function setRegion(r) {
    if (r === region) return;
    region = r;
    store.set('buzzRegion', r);
    ctx.saveRegion?.(r);
    cards = new Map(); order = []; version = null; offset = 0;
    if (root) mount(root);
    check(true);
  }

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  // ───── cards (built once, then only patched — a playing video or open state is never rebuilt) ─────
  function card(it) {
    const link = (cls, ...kids) => h('a', { class: cls, href: it.canonicalUrl, target: '_blank', rel: 'noopener noreferrer' }, ...kids);
    let media;
    if (it.videoUrl) {
      media = h('button', { class: 'bz-media bz-video', 'aria-label': 'Play video', onclick: (e) => {
        const v = h('video', { src: it.videoUrl, controls: true, playsinline: true, preload: 'metadata', poster: it.imageUrl || undefined });
        e.currentTarget.replaceWith(h('div', { class: 'bz-media' }, v));
        v.play().catch(() => {});
      } }, it.imageUrl ? h('img', { src: it.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null, h('span', { class: 'bz-playic' }, icon('play', 'fill')));
    } else if (it.imageUrl) {
      const img = h('img', { src: it.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      media = link('bz-media', img);
      img.addEventListener('error', () => media.replaceWith(placeholder(it))); // broken image → branded placeholder
    } else media = null; // no photo: a small source badge in the info line instead of a big empty box
    const likeBtn = h('button', { class: 'bz-act like' + (it.liked ? ' on' : ''), 'aria-label': 'Like', 'aria-pressed': String(!!it.liked), onclick: () => react(it.id, 'like') }, icon('heart', it.liked ? 'fill' : ''), h('span', null, it.likes || ''));
    const comBtn = h('button', { class: 'bz-act', 'aria-label': 'Comments', onclick: () => openComments(it.id) }, icon('msg'), h('span', null, it.comments || ''));
    const repBtn = h('button', { class: 'bz-act repost' + (it.reposted ? ' on' : ''), 'aria-label': 'Repost', 'aria-pressed': String(!!it.reposted), onclick: () => repost(it.id) }, icon('repost'), h('span', null, it.reposts || ''));
    const el = h('article', { class: 'bz-card', 'data-id': it.id },
      media,
      h('div', { class: 'bz-body' },
        h('div', { class: 'bz-meta' },
          media ? null : h('span', { class: 'bz-badge', style: { '--h': hue(it.sourceId) } }, initials(it.sourceName)),
          h('span', { class: 'bz-src' }, it.sourceName),
          it.publishedAt ? h('time', { datetime: new Date(it.publishedAt).toISOString() }, ago(it.publishedAt)) : null,
          h('span', { class: 'bz-label k-' + it.contentType }, it.label)),
        link('bz-h', it.title),
        it.description ? h('p', { class: 'bz-d' }, it.description) : h('p', { class: 'bz-d none' }, `Read the full story at ${hostOf(it.canonicalUrl) || it.sourceName}.`),
        it.discussUrl && it.discussUrl !== it.canonicalUrl ? h('a', { class: 'bz-discuss', href: it.discussUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Discussion on Hacker News') : null,
        h('div', { class: 'bz-actions' }, likeBtn, comBtn, repBtn,
          h('button', { class: 'bz-act', 'aria-label': 'Send to a chat', onclick: () => shareToChat(it) }, icon('send')),
          link('bz-read', 'Read at source', icon('external')))));
    el._refs = { likeBtn, comBtn, repBtn };
    el.querySelector('.bz-h').addEventListener('auxclick', (e) => e.stopPropagation());
    return el;
  }

  function placeholder(it) {
    const hh = hue(it.sourceId);
    return h('a', { class: 'bz-ph', href: it.canonicalUrl, target: '_blank', rel: 'noopener noreferrer', style: { '--h': hh } },
      h('span', { class: 'bz-ph-i' }, initials(it.sourceName)), h('span', { class: 'bz-ph-n' }, it.sourceName));
  }

  function patch(it) {
    const c = cards.get(it.id);
    if (!c) return;
    c.data = { ...c.data, ...it };
    const r = c.el._refs;
    r.likeBtn.classList.toggle('on', !!it.liked); r.likeBtn.setAttribute('aria-pressed', String(!!it.liked));
    r.likeBtn.replaceChildren(icon('heart', it.liked ? 'fill' : ''), h('span', null, it.likes || ''));
    r.comBtn.lastChild.textContent = it.comments || '';
    r.repBtn.classList.toggle('on', !!it.reposted); r.repBtn.lastChild.textContent = it.reposts || '';
    const lab = c.el.querySelector('.bz-label');
    if (lab && lab.textContent !== it.label) { lab.textContent = it.label; lab.className = 'bz-label k-' + it.contentType; }
    const t = c.el.querySelector('time');
    if (t && it.publishedAt) t.textContent = ago(it.publishedAt);
  }

  function renderAll(items) {
    feedEl.replaceChildren();
    cards = new Map(); order = [];
    for (const it of items) { if (cards.has(it.id)) continue; const el = card(it); cards.set(it.id, { el, data: it }); order.push(it.id); feedEl.append(el); }
  }

  // Merge a fresh first page: patch known stories, put genuinely new ones on top without moving what
  // the reader is looking at.
  function merge(items) {
    const fresh = items.filter((it) => !cards.has(it.id));
    for (const it of items) if (cards.has(it.id)) patch(it);
    if (!fresh.length) return 0;
    const before = root.scrollHeight, top = root.scrollTop;
    const frag = document.createDocumentFragment();
    for (const it of fresh) { const el = card(it); el.classList.add('bz-fresh'); cards.set(it.id, { el, data: it }); frag.append(el); }
    feedEl.prepend(frag);
    order = [...fresh.map((x) => x.id), ...order];
    if (top > 40) { root.scrollTop = top + (root.scrollHeight - before); showNew(fresh.length); }
    return fresh.length;
  }
  function showNew(n) { pendingNew += n; newPill.hidden = false; newPill.lastChild.textContent = `${pendingNew} new ${pendingNew === 1 ? 'story' : 'stories'}`; }
  function hideNew() { pendingNew = 0; if (newPill) newPill.hidden = true; }

  // ───── live updates: one request at a time, every 5s while visible ─────
  async function check(force = false) {
    if (inFlight || !root || (!visible && !force)) return;
    inFlight = true;
    try {
      const r = await ctx.api('GET', `/api/feed?region=${region}&limit=24`);
      lastCheck = Date.now(); offline = false;
      if (!cards.size || r.region !== region) { renderAll(r.items); offset = r.items.length; hasMore = r.hasMore; }
      else if (r.version !== version) { const n = merge(r.items); if (n) lastNew = Date.now(); }
      else for (const it of r.items) patch(it);
      if (!offset) { offset = r.items.length; hasMore = r.hasMore; }
      version = r.version;
      moreBtn.hidden = !hasMore;
      store.set('buzzCache:' + region, { at: Date.now(), items: order.slice(0, 48).map((id) => cards.get(id).data) });
      // "Checking" and "new content" are different things: say which one happened.
      setStatus(Date.now() - lastNew < 15000 ? 'New stories just arrived' : `Up to date · checked ${new Date(lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    } catch (e) {
      offline = true;
      setStatus(cards.size ? 'Offline — showing saved stories. Retrying…' : 'Can’t reach Ping Me right now. Retrying…');
      if (!cards.size) feedEl.replaceChildren(h('div', { class: 'bz-empty' }, 'No stories yet — they’ll appear as soon as the connection is back.'));
    } finally { inFlight = false; }
  }

  async function loadMore() {
    moreBtn.disabled = true;
    try {
      const r = await ctx.api('GET', `/api/feed?region=${region}&limit=24&offset=${offset}`);
      for (const it of r.items) { if (cards.has(it.id)) continue; const el = card(it); cards.set(it.id, { el, data: it }); order.push(it.id); feedEl.append(el); }
      offset += r.items.length; hasMore = r.hasMore;
    } catch (e) { toast(e.message, { error: true }); }
    moreBtn.disabled = false; moreBtn.hidden = !hasMore;
  }

  async function loadSources() {
    const list = sourcesEl.querySelector('.bz-src-list');
    try {
      const { sources } = await ctx.api('GET', '/api/feed/sources');
      list.replaceChildren(h('p', { class: 'bz-src-note' }, 'Stories are collected on our server from each publisher’s official feed and refreshed on their own schedule; the app checks for updates every 5 seconds. Popularity labels show real signals only (Hacker News points, Google News top stories, and likes on Ping Me).'),
        ...sources.map((s) => h('div', { class: 'bz-src-row' },
          h('i', { class: 's-' + (s.status === 'ok' ? 'ok' : s.enabled ? 'bad' : 'off') }),
          h('span', { class: 'n' }, s.name),
          h('span', { class: 'v' }, s.status === 'ok' ? `updated ${ago(s.lastOk)} · every ${s.pollMinutes} min` : s.enabled ? `${s.status}${s.error ? ' — ' + s.error : ''}` : `needs ${s.credentials}`))));
    } catch (e) { list.textContent = e.message; }
  }

  // ───── reactions ─────
  async function react(id) {
    const c = cards.get(id); if (!c) return;
    const d = c.data; const liked = !d.liked;
    patch({ ...d, liked, likes: Math.max(0, (d.likes || 0) + (liked ? 1 : -1)) }); // instant
    try { const r = await ctx.api('POST', `/api/feed/${id}/like`); patch({ ...cards.get(id).data, ...r }); } catch (e) { patch(d); toast(e.message, { error: true }); }
  }
  async function repost(id) {
    const c = cards.get(id); if (!c) return;
    const d = c.data;
    try { const r = await ctx.api('POST', `/api/feed/${id}/repost`); patch({ ...cards.get(id).data, ...r }); toast(r.reposted ? 'Reposted — it now counts toward what’s buzzing' : 'Repost removed', { timeout: 1800 }); } catch (e) { patch(d); toast(e.message, { error: true }); }
  }

  function openComments(id) {
    const it = cards.get(id)?.data; if (!it) return;
    const list = h('div', { class: 'bz-comments' }, h('div', { class: 'spinner' }));
    const input = h('textarea', { class: 'field', rows: 2, maxlength: 1000, placeholder: 'Add a comment…' });
    const s = openSheet({ title: 'Comments', left: { label: 'Close' }, full: true });
    const post = async () => {
      const text = input.value.trim(); if (!text) return;
      try { const r = await ctx.api('POST', `/api/feed/${id}/comments`, { text }); input.value = ''; list.querySelector('.bz-empty')?.remove(); list.append(row(r.comment, null)); patch({ ...cards.get(id).data, ...r.counts }); list.lastChild.scrollIntoView({ block: 'nearest' }); } catch (e) { toast(e.message, { error: true }); }
    };
    const row = (cm, users) => {
      const u = users?.find((x) => x.id === cm.userId) || (cm.mine ? ctx.me() : { id: cm.userId, name: 'Someone' });
      return h('div', { class: 'bz-cm' }, avatar({ id: u.id, name: u.name, src: ctx.userAvatar(u.id), size: 32 }),
        h('div', null, h('div', { class: 'bz-cm-h' }, h('b', null, u.name), h('span', null, ago(cm.createdAt)),
          cm.mine ? h('button', { class: 'link small', onclick: async (e) => { const el = e.currentTarget.closest('.bz-cm'); try { const r = await ctx.api('DELETE', `/api/feed/comments/${cm.id}`); el.remove(); patch({ ...cards.get(id).data, ...r.counts }); } catch (er) { toast(er.message, { error: true }); } } }, 'Delete') : null),
          h('p', null, cm.text)));
    };
    s.body.append(h('div', { class: 'bz-cm-story' }, h('b', null, it.title), h('span', null, it.sourceName)), list,
      h('div', { class: 'bz-cm-input' }, input, h('button', { class: 'btn', onclick: post }, 'Post')));
    ctx.api('GET', `/api/feed/${id}/comments`).then(({ comments, users }) => {
      list.replaceChildren(...(comments.length ? comments.map((cm) => row(cm, users)) : [h('div', { class: 'bz-empty' }, 'No comments yet — start the conversation.')]));
    }).catch((e) => { list.textContent = e.message; });
  }

  function shareToChat(it) {
    const chats = ctx.chats();
    const s = openSheet({ title: 'Send to…', left: { label: 'Close' }, full: true });
    s.body.append(h('div', { class: 'group' }, chats.length ? chats.map((c) => h('button', { class: 'user-row', style: { cursor: 'pointer', width: '100%' }, onclick: async () => {
      s.close();
      try { await ctx.sendToChat(c.id, `${it.title}\n${it.canonicalUrl}`); await ctx.api('POST', `/api/feed/${it.id}/repost`, { on: true }).then((r) => patch({ ...cards.get(it.id).data, ...r })).catch(() => {}); toast(`Sent to ${ctx.chatTitle(c)}`); } catch (e) { toast(e.message, { error: true }); }
    } }, avatar({ id: c.id, name: ctx.chatTitle(c), src: ctx.chatAvatar(c), size: 40, group: c.type === 'group' }), h('div', { class: 't' }, h('b', null, ctx.chatTitle(c))))) : h('div', { class: 'bz-empty' }, 'Start a chat first')));
  }

  // ───── lifecycle ─────
  function show(container) {
    if (root !== container || !feedEl) mount(container);
    visible = true;
    check(true);
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
  }
  function hide() { visible = false; clearInterval(timer); timer = null; }
  // Catch up immediately when the tab comes back or the connection returns.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) check(true); });
  addEventListener('online', () => { if (visible) check(true); });

  return { show, hide, get offline() { return offline; } };
}
