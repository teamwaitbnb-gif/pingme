// Buzz: one live feed of real stories for where you are — local first (e.g. Hyderabad), mixed with
// India, tech, business, world, cricket and cinema. Our server collects the publisher feeds; the app
// checks /api/feed every 5 seconds while Buzz is on screen and merges new stories in place.
import { h, icon, toast, avatar, openSheet, store, fmtListTime, reconcileChildren } from './ui.js';
import { track } from './analytics.js';

// Analytics: a story counts as "seen" after being at least half on screen for a second; opens are
// taps on its photo, headline or Read link.
// Reading behaviour teaches the For You ranking:
//  • "seen": a story at least half on screen for a second (counts only);
//  • "reading": time a story spends in the reading zone (middle of the screen) while the person isn't
//    scrolling fast — compared with how long the story takes to read, so lingering means interest;
//  • "skip": flicked past in under a second (a gentle "less of this").
const seenIds = new Set();
let seenPending = [];
// Stories already seen on this phone (also known to the server): never shown again, even from the
// offline copy.
const SEEN_KEY = 'buzzSeenIds';
let seenLocal = new Set(store.get(SEEN_KEY, []));
function rememberSeen(id) {
  seenLocal.add(id);
  if (seenLocal.size > 1200) seenLocal = new Set([...seenLocal].slice(-1000));
}
const seenTimers = new Map();
const shownAt = new Map(), skipped = new Set(), readTime = new Map(), readSent = new Map(), inZone = new Set();
let lastScrollY = 0, lastScrollT = 0, fastUntil = 0;
const expectedSecs = (el) => Math.max(3, Math.round(((el.querySelector('.bz-h')?.textContent || '') + ' ' + (el.querySelector('.bz-d:not(.none)')?.textContent || '')).split(/\s+/).length / 3.5));
const seenObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (!id) continue;
    if (e.isIntersecting) {
      shownAt.set(id, performance.now());
      if (!seenIds.has(id)) seenTimers.set(id, setTimeout(() => { seenIds.add(id); rememberSeen(id); seenPending.push([id, e.target.dataset.slot || 'g']); }, 1000));
    } else {
      clearTimeout(seenTimers.get(id)); seenTimers.delete(id);
      const t0 = shownAt.get(id); shownAt.delete(id);
      if (t0 == null || document.hidden) continue;
      if ((performance.now() - t0) / 1000 < 0.9 && !skipped.has(id) && !readSent.has(id) && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)) {
        skipped.add(id);
        track({ t: 'buzz_skip', i: id });
      }
    }
  }
}, { threshold: 0.5 }) : null;
// The reading zone: the middle half of the screen.
const zoneObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (!id) continue;
    if (e.isIntersecting) {
      inZone.add(id);
      if (e.target._video && autoplayOk()) zoneTimers.set(id, setTimeout(() => { if (inZone.has(id) && !document.hidden) playIn(e.target, false); }, 500));
    } else {
      inZone.delete(id); flushRead(e.target);
      clearTimeout(zoneTimers.get(id)); zoneTimers.delete(id);
      if (activeVideo === e.target) stopVideo(e.target);
    }
  }
}, { rootMargin: '-25% 0px -25% 0px', threshold: 0.3 }) : null;
function flushRead(el) {
  const id = el.dataset.id;
  const secs = readTime.get(id) || 0;
  if (secs < 2) return;
  readTime.set(id, 0);
  readSent.set(id, (readSent.get(id) || 0) + secs);
  track({ t: 'buzz_dwell', i: id, v: Math.round(secs), e: expectedSecs(el) });
}
// Count reading time 4× a second, only while the page is visible and the person isn't scrolling fast.
setInterval(() => {
  if (document.hidden || !inZone.size || performance.now() < fastUntil) return;
  for (const id of inZone) readTime.set(id, (readTime.get(id) || 0) + 0.25);
}, 250);
function noteScroll(pane) {
  const now = performance.now(), y = pane.scrollTop;
  const speed = Math.abs(y - lastScrollY) / Math.max(1, now - lastScrollT) * 1000; // px per second
  if (speed > 900) fastUntil = now + 350;
  lastScrollY = y; lastScrollT = now;
}
function flushSeen() {
  if (!seenPending.length) return;
  const s = seenPending.splice(0, 200);
  track({ t: 'buzz_seen', v: s.length, s });
  store.set(SEEN_KEY, [...seenLocal]);
}
setInterval(flushSeen, 10000);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSeen(); });

// ───── videos play right in the feed ─────
// The video in the middle of the screen plays muted (like Instagram); tap it for sound. Only one plays
// at a time, and the player is removed once it scrolls away (keeps iPhones light). Data Saver: tap only.
let activeVideo = null;
const isYouTube = (u) => /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(u);
const autoplayOk = () => !navigator.connection?.saveData && !matchMedia('(prefers-reduced-motion: reduce)').matches;
function playIn(el, sound) {
  const box = el?.querySelector('.bz-video');
  const u = el?._video;
  if (!box || !u) return;
  if (activeVideo && activeVideo !== el) stopVideo(activeVideo);
  activeVideo = el;
  const mode = sound ? 's' : 'm';
  if (box.dataset.playing === mode || (box.dataset.playing === 's' && !sound)) return;
  if (sound && el._watch) el._watch.sound = true; // autoplay → tapped for sound: it's a real watch
  const old = box.querySelector('iframe, video');
  if (old && old.tagName === 'VIDEO') { old.muted = !sound; old.play().catch(() => {}); box.dataset.playing = mode; return; }
  old?.remove();
  let node;
  if (isYouTube(u)) {
    node = h('iframe', { src: `${u}?autoplay=1&mute=${sound ? 0 : 1}&playsinline=1&rel=0&modestbranding=1`, title: 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
  } else {
    node = h('video', { src: u, poster: el._poster || undefined, playsinline: true, loop: true, controls: true, preload: 'metadata' });
    node.muted = !sound;
    node.play().catch(() => {});
  }
  box.dataset.playing = mode;
  box.append(node);
  // Watch time feeds the algorithm: started now; "sound" once the person tapped to watch with sound.
  el._watch = { at: Date.now(), sound: !!sound };
}
function stopVideo(el) {
  const box = el?.querySelector('.bz-video');
  if (box) { box.querySelector('iframe, video')?.remove(); delete box.dataset.playing; }
  endWatch(el);
  if (activeVideo === el) activeVideo = null;
}
// One event per play: seconds watched, and whether it was a real watch (sound on) or an autoplay.
function endWatch(el) {
  const w = el?._watch;
  if (!w) return;
  el._watch = null;
  const secs = Math.round((Date.now() - w.at) / 1000);
  if (secs >= 2 && el.dataset.id) track({ t: w.sound ? 'buzz_play' : 'buzz_autoplay', i: el.dataset.id, v: Math.min(1800, secs) });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && activeVideo) { endWatch(activeVideo); } else if (!document.hidden && activeVideo?.querySelector('.bz-video')?.dataset.playing) activeVideo._watch ||= { at: Date.now(), sound: activeVideo.querySelector('.bz-video').dataset.playing === 's' }; });
const zoneTimers = new Map();

const POLL_MS = 5000;
// Cities come from the server (35+); this short list is only the offline fallback.
let CITIES = [['hyderabad', 'Hyderabad'], ['bengaluru', 'Bengaluru'], ['mumbai', 'Mumbai'], ['delhi', 'Delhi NCR'], ['chennai', 'Chennai'], ['kolkata', 'Kolkata'], ['pune', 'Pune'], ['india', 'All of India']];
let COORDS = { hyderabad: [17.385, 78.4867], bengaluru: [12.9716, 77.5946], mumbai: [19.076, 72.8777], delhi: [28.6139, 77.209], chennai: [13.0827, 80.2707], kolkata: [22.5726, 88.3639], pune: [18.5204, 73.8567] };

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
  let root = null, feedEl = null, statusEl = null, moreBtn = null, sourcesEl = null, loadingMore = false;
  let region = ctx.me()?.settings?.buzzRegion || store.get('buzzRegion', null) || 'india';
  let cards = new Map(); // id → { el, data }
  let order = [];        // ids in display order
  let version = null, hasMore = false, inFlight = false, timer = null, visible = false, fromCache = false;
  let lastCheck = 0, lastNew = 0, offline = false;
  // Search & filters: results show in their own list; the live feed keeps updating underneath.
  let resultsEl = null, chipsEl = null, searchInput = null, found = new Map(), searchSeq = 0, searchTimer = 0;
  const filters = { q: '', section: null, type: null, time: 'week', sort: 'top' };
  const getCard = (id) => cards.get(id) || found.get(id);
  const searching = () => !!(filters.q || filters.section || filters.type);

  function mount(container) {
    root = container;
    const chip = h('button', { class: 'bz-loc', 'aria-label': 'Change location', onclick: pickRegion }, icon('map'), h('span', null, nameOf(region)), icon('chev'));
    statusEl = h('span', { class: 'bz-status', role: 'status', 'aria-live': 'polite' }, 'Loading…');
    feedEl = h('div', { class: 'bz-feed' });
    moreBtn = h('div', { class: 'bz-loading', hidden: true }, h('span', { class: 'spinner' }));
    sourcesEl = h('details', { class: 'bz-sources' }, h('summary', null, 'Sources & status'), h('div', { class: 'bz-src-list' }, 'Loading…'));
    resultsEl = h('div', { class: 'bz-results', hidden: true });
    searchInput = h('input', { type: 'search', class: 'bz-q', placeholder: 'Search news, stars, teams, places…', enterkeyhint: 'search', autocomplete: 'off', value: filters.q,
      oninput: () => { filters.q = searchInput.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); },
      onfocus: () => { if (!searching()) runSearch(); },
      onblur: () => setTimeout(() => { if (!searching() && document.activeElement !== searchInput) runSearch(); }, 250),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); runSearch(); searchInput.blur(); } } });
    const filtBtn = h('button', { class: 'bz-filt', 'aria-label': 'Filters', onclick: openFilters }, icon('sliders'));
    chipsEl = h('div', { class: 'bz-chips', role: 'tablist' });
    drawChips();
    sourcesEl.addEventListener('toggle', () => { if (sourcesEl.open) loadSources(); });
    root.replaceChildren(
      h('header', { class: 'bz-head' },
        h('div', { class: 'bz-title' }, h('b', null, 'Buzz'), h('span', { class: 'bz-live', title: 'Live' }, h('i'))),
        chip),
      h('div', { class: 'bz-search' }, h('label', { class: 'bz-qwrap' }, icon('search'), searchInput,
        h('button', { class: 'bz-qx', 'aria-label': 'Clear search', onclick: () => clearSearch() }, icon('xc'))), filtBtn),
      chipsEl,
      h('div', { class: 'bz-sub' }, statusEl),
      resultsEl,
      region === 'india' && !store.get('buzzAskedCity') ? cityPrompt() : null,
      !ctx.me()?.settings?.buzzFromChats && !store.get('buzzChatAsked') ? chatPrompt() : null,
      feedEl, moreBtn, sourcesEl);
    // Endless feed: the next stories load before you reach the end.
    root.addEventListener('scroll', () => {
      noteScroll(root);
      if (hasMore && !loadingMore && root.scrollTop + root.clientHeight > root.scrollHeight - 1600) loadMore();
    }, { passive: true });
    ctx.api('GET', '/api/feed/regions').then(({ regions }) => {
      CITIES = regions.map((r) => [r.id, r.name]);
      COORDS = Object.fromEntries(regions.filter((r) => r.lat).map((r) => [r.id, [r.lat, r.lon]]));
      const span = root.querySelector('.bz-loc span'); if (span) span.textContent = nameOf(region);
    }).catch(() => {});
    // Saved stories first (instant, and they survive a lost connection).
    const saved = store.get('buzzCache:' + region, null);
    const unseen = (saved?.items || []).filter((it) => !seenLocal.has(it.id));
    if (unseen.length) { renderAll(unseen); fromCache = true; setStatus(`Saved stories · ${ago(saved.at)}`); }
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

  // One-time, clear opt-in: use topics from the person's own chats to tailor Buzz.
  function chatPrompt() {
    const box = h('div', { class: 'bz-ask' },
      h('div', null, h('b', null, 'Make Buzz yours'), h('span', null, 'Let Buzz learn topics from what you chat about — like a team, a city or a hobby — to show stories you’ll care about. Only topic keywords are used, never your messages. You can turn this off anytime in Settings.')),
      h('div', { class: 'bz-ask-btns' },
        h('button', { class: 'bz-btn', onclick: async () => { box.remove(); store.set('buzzChatAsked', true); await ctx.saveSettings?.({ buzzFromChats: true }); toast('Buzz will learn from your chat topics'); } }, 'Turn on'),
        h('button', { class: 'bz-btn ghost', onclick: () => { box.remove(); store.set('buzzChatAsked', true); } }, 'Not now')));
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
    cards = new Map(); order = []; version = null; fromCache = false;
    if (root) mount(root);
    check(true);
    if (searching()) runSearch();
  }

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  // ───── cards (built once, then only patched — a playing video or open state is never rebuilt) ─────
  function card(it) {
    const host = hostOf(it.canonicalUrl);
    const social = host === 'x.com' || host === 'youtube.com' || host === 'instagram.com';
    const link = (cls, ...kids) => h('a', { class: cls, href: it.canonicalUrl, target: '_blank', rel: 'noopener noreferrer' }, ...kids);
    let media;
    if (it.videoUrl) {
      media = h('div', { class: 'bz-media bz-video', role: 'button', tabindex: '0', 'aria-label': 'Play video with sound', onclick: (e) => {
        if (e.target.closest('video')) return; // the video's own controls
        const card = e.currentTarget.closest('.bz-card');
        if (card.querySelector('.bz-video').dataset.playing !== 's') track({ t: 'buzz_open', i: it.id });
        playIn(card, true);
      } },
      it.imageUrl ? h('img', { src: it.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null,
      h('span', { class: 'bz-playic' }, icon('play', 'fill')),
      h('span', { class: 'bz-vtag' }, icon('play', 'fill'), 'Video'));
    } else if (it.imageUrl) {
      const img = h('img', { src: it.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      media = link('bz-media', img);
      // Never stretch a small picture into a blurry hero: show it as a neat thumbnail instead.
      img.addEventListener('load', () => { if (img.naturalWidth && img.naturalWidth < 600) media.closest('.bz-card')?.classList.add('bz-small'); });
      img.addEventListener('error', () => media.replaceWith(placeholder(it))); // broken image → branded placeholder
    } else media = null; // no photo: a small source badge in the info line instead of a big empty box
    const likeBtn = h('button', { class: 'bz-act like' + (it.liked ? ' on' : ''), 'aria-label': 'Like', 'aria-pressed': String(!!it.liked), onclick: () => react(it.id, 'like') }, icon('heart', it.liked ? 'fill' : ''), h('span', null, it.likes || ''));
    const comBtn = h('button', { class: 'bz-act', 'aria-label': 'Comments', onclick: () => openComments(it.id) }, icon('msg'), h('span', null, it.comments || ''));
    const repBtn = h('button', { class: 'bz-act repost' + (it.reposted ? ' on' : ''), 'aria-label': 'Repost', 'aria-pressed': String(!!it.reposted), onclick: () => repost(it.id) }, icon('repost'), h('span', null, it.reposts || ''));
    const el = h('article', { class: 'bz-card', 'data-id': it.id, 'data-slot': it.slot || 'g' },
      media,
      h('div', { class: 'bz-body' },
        h('div', { class: 'bz-meta' },
          logo(it),
          h('span', { class: 'bz-src' }, it.sourceName),
          it.publishedAt ? h('time', { datetime: new Date(it.publishedAt).toISOString() }, ago(it.publishedAt)) : null),
        // Only real popularity signals get a label ("Latest" is the default, so it isn't shown).
        it.contentType !== 'latest' ? h('span', { class: 'bz-label k-' + it.contentType }, it.label) : null,
        link('bz-h', it.title),
        it.description ? h('p', { class: 'bz-d' }, it.description) : social ? null : h('p', { class: 'bz-d none' }, `Read the full story at ${hostOf(it.canonicalUrl) || it.sourceName}.`),
        it.alsoBy?.length ? h('div', { class: 'bz-also' }, `Also covered by ${it.alsoBy.join(', ')}${it.coverage - 1 > it.alsoBy.length ? ` +${it.coverage - 1 - it.alsoBy.length}` : ''}`) : null,
        it.discussUrl && it.discussUrl !== it.canonicalUrl ? h('a', { class: 'bz-discuss', href: it.discussUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Discussion on Hacker News') : null,
        h('div', { class: 'bz-actions' }, likeBtn, comBtn, repBtn,
          h('button', { class: 'bz-act', 'aria-label': 'Send to a chat', onclick: () => shareToChat(it) }, icon('send')),
          link('bz-read', host === 'x.com' ? 'Open on X' : host === 'youtube.com' ? 'YouTube' : host === 'instagram.com' ? 'Open on Instagram' : 'Read', icon('chev')))));
    el._refs = { likeBtn, comBtn, repBtn };
    if (it.videoUrl) { el._video = it.videoUrl; el._poster = it.imageUrl; }
    seenObserver?.observe(el);
    zoneObserver?.observe(el);
    el.addEventListener('click', (e) => { if (e.target.closest('a.bz-media, a.bz-h, a.bz-read, a.bz-ph')) track({ t: 'buzz_open', i: it.id }); });
    el.querySelector('.bz-h').addEventListener('auxclick', (e) => e.stopPropagation());
    return el;
  }

  // The publisher's own logo (fetched by our server from their site); a neat initial badge otherwise.
  function logo(it) {
    const badge = () => h('span', { class: 'bz-badge', style: { '--h': hue(it.sourceId) } }, initials(it.sourceName));
    if (!it.logoUrl) return badge();
    const img = h('img', { class: 'bz-logo', src: it.logoUrl, alt: '', width: 18, height: 18, loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(badge()));
    return img;
  }

  function placeholder(it) {
    const hh = hue(it.sourceId);
    return h('a', { class: 'bz-ph', href: it.canonicalUrl, target: '_blank', rel: 'noopener noreferrer', style: { '--h': hh } },
      h('span', { class: 'bz-ph-i' }, initials(it.sourceName)), h('span', { class: 'bz-ph-n' }, it.sourceName));
  }

  function patch(it) {
    const c = getCard(it.id);
    if (!c) return;
    c.data = { ...c.data, ...it };
    const r = c.el._refs;
    r.likeBtn.classList.toggle('on', !!it.liked); r.likeBtn.setAttribute('aria-pressed', String(!!it.liked));
    r.likeBtn.replaceChildren(icon('heart', it.liked ? 'fill' : ''), h('span', null, it.likes || ''));
    r.comBtn.lastChild.textContent = it.comments || '';
    r.repBtn.classList.toggle('on', !!it.reposted); r.repBtn.lastChild.textContent = it.reposts || '';
    const lab = c.el.querySelector('.bz-label');
    if (lab && it.contentType !== 'latest' && lab.textContent !== it.label) { lab.textContent = it.label; lab.className = 'bz-label k-' + it.contentType; }
    const t = c.el.querySelector('time');
    if (t && it.publishedAt) t.textContent = ago(it.publishedAt);
  }

  function renderAll(items) {
    // Reuse cards already on screen (their pictures stay loaded) and swap the rest in one go.
    const prev = cards;
    cards = new Map(); order = [];
    const nodes = [];
    for (const it of items) {
      if (cards.has(it.id)) continue;
      const old = prev.get(it.id);
      let el;
      if (old) { el = old.el; cards.set(it.id, { el, data: old.data }); patch(it); }
      else { el = card(it); cards.set(it.id, { el, data: it }); }
      order.push(it.id); nodes.push(el);
    }
    reconcileChildren(feedEl, nodes);
  }

  // Fresh stories slip in just below where you're reading — no banner, no jump. At the very top they
  // simply appear first.
  function insertAhead(items, { after = null } = {}) {
    const fresh = items.filter((it) => !cards.has(it.id));
    if (!fresh.length) return 0;
    const els = fresh.map((it) => { const el = card(it); el.classList.add('bz-fresh'); cards.set(it.id, { el, data: it }); return el; });
    let anchor = after;
    if (!anchor) {
      if (root.scrollTop < 60 && !after) { feedEl.prepend(...els); order = [...fresh.map((x) => x.id), ...order]; return fresh.length; }
      // The first card that starts below the bottom of the screen: new stories go right before it.
      const bottom = root.getBoundingClientRect().bottom;
      anchor = [...feedEl.children].find((c) => c.getBoundingClientRect().top > bottom + 40) || null;
      if (!anchor) { feedEl.append(...els); order.push(...fresh.map((x) => x.id)); return fresh.length; }
      anchor.before(...els);
    } else anchor.after(...els);
    const ids = fresh.map((x) => x.id);
    const at = order.indexOf((after || anchor).dataset.id);
    order.splice(after ? at + 1 : Math.max(0, at), 0, ...ids);
    return fresh.length;
  }
  function merge(items) {
    for (const it of items) if (cards.has(it.id)) patch(it);
    return insertAhead(items);
  }

  // ───── live updates: one request at a time, every 5s while visible ─────
  async function check(force = false) {
    if (inFlight || !root || (!visible && !force)) return;
    inFlight = true;
    try {
      const r = await ctx.api('GET', `/api/feed?region=${region}&limit=24`);
      lastCheck = Date.now(); offline = false;
      // First answer after opening: replace the offline copy with the live, unseen feed.
      if (!cards.size || r.region !== region || (fromCache && root.scrollTop < 60)) { renderAll(r.items); hasMore = r.hasMore; fromCache = false; }
      else if (r.version !== version) { fromCache = false; const n = merge(r.items); if (n) lastNew = Date.now(); if (r.hasMore) hasMore = true; }
      else for (const it of r.items) patch(it);
      version = r.version;
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
    if (loadingMore || !hasMore) return;
    loadingMore = true; moreBtn.hidden = false;
    try {
      const r = await ctx.api('POST', '/api/feed/more', { region, limit: 24, have: order.slice(-1500) });
      for (const it of r.items) { if (cards.has(it.id)) continue; const el = card(it); cards.set(it.id, { el, data: it }); order.push(it.id); feedEl.append(el); }
      hasMore = r.hasMore && r.items.length > 0;
    } catch {}
    loadingMore = false; moreBtn.hidden = true;
  }

  // ───── search & filters ─────
  const CHIPS = [[null, null, 'All'], ['politics', null, 'Politics'], ['entertainment', null, 'Movies & stars'], ['sports', null, 'Sports'],
    ['india', null, 'India'], ['local', null, 'Near you'], [null, 'viral', 'Viral'], [null, 'video', 'Videos'], ['tech', null, 'Tech'], ['business', null, 'Business'], ['world', null, 'World']];
  function drawChips() {
    chipsEl.replaceChildren(...CHIPS.filter(([s]) => s !== 'local' || region !== 'india').map(([section, type, label]) => {
      const on = filters.section === section && filters.type === type;
      return h('button', { class: 'bz-chip' + (on ? ' on' : ''), role: 'tab', 'aria-selected': String(on), onclick: (e) => {
        filters.section = section; filters.type = type; drawChips();
        e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        runSearch();
      } }, label);
    }));
  }
  function clearSearch() {
    filters.q = ''; filters.section = null; filters.type = null;
    if (searchInput) { searchInput.value = ''; searchInput.blur(); }
    drawChips(); runSearch();
  }
  async function runSearch() {
    const seq = ++searchSeq;
    root.classList.toggle('bz-searching', searching());
    const focused = document.activeElement === searchInput;
    if (!searching() && !focused) { resultsEl.hidden = true; feedEl.hidden = false; found = new Map(); return; }
    resultsEl.hidden = false; feedEl.hidden = true; moreBtn.hidden = true;
    if (!resultsEl.firstChild) resultsEl.replaceChildren(h('div', { class: 'bz-loading' }, h('span', { class: 'spinner' })));
    const qs = new URLSearchParams({ region, time: filters.time, sort: filters.sort });
    if (filters.q) qs.set('q', filters.q);
    if (filters.section) qs.set('section', filters.section);
    if (filters.type) qs.set('type', filters.type);
    try {
      const r = await ctx.api('GET', '/api/feed/search?' + qs);
      if (seq !== searchSeq) return;
      if (filters.q) track({ t: 'buzz_search', v: r.items.length });
      found = new Map();
      const nodes = r.items.map((it) => { const el = card(it); found.set(it.id, { el, data: it }); return el; });
      const sug = !filters.q && r.trending?.length ? h('div', { class: 'bz-trend' }, h('b', null, icon('fire'), 'Trending searches'),
        h('div', { class: 'bz-trend-list' }, r.trending.map((t) => h('button', { class: 'bz-chip', onclick: () => { filters.q = t; searchInput.value = t; runSearch(); } }, t)))) : null;
      const head = searching() ? h('div', { class: 'bz-rhead' }, h('span', null, r.items.length ? `${r.items.length}${r.items.length >= 40 ? '+' : ''} stories${filters.q ? ` for “${filters.q}”` : ''}` : ''),
        h('span', { class: 'bz-rmeta' }, `${{ hour: 'Last hour', today: 'Today', week: 'This week' }[filters.time]} · ${filters.sort === 'latest' ? 'Newest' : 'Top'}`)) : null;
      const empty = searching() && !r.items.length ? h('div', { class: 'bz-empty' }, filters.q ? `Nothing found for “${filters.q}”. Try fewer words, or a longer time in Filters.` : 'Nothing here right now. Try a longer time in Filters.') : null;
      resultsEl.replaceChildren(...[sug, head, empty, ...nodes].filter(Boolean));
      if (searching()) root.scrollTop = 0;
    } catch (e) {
      if (seq === searchSeq) resultsEl.replaceChildren(h('div', { class: 'bz-empty' }, 'Search isn’t available right now. Check your connection.'));
    }
  }
  function openFilters() {
    const s = openSheet({ title: 'Filters', left: { label: 'Reset', onClick: (close) => { Object.assign(filters, { type: null, time: 'week', sort: 'top' }); drawChips(); close(); runSearch(); } }, right: { label: 'Done', onClick: (close) => { close(); runSearch(); } } });
    const group = (label, key, opts) => [h('div', { class: 'group-label' }, label), h('div', { class: 'group' }, opts.map(([v, l]) => {
      const b = h('button', { class: 'cell' + (filters[key] === v ? ' on' : ''), onclick: () => { filters[key] = v; drawChips(); draw(); } }, h('span', { class: 'lb' }, l), filters[key] === v ? icon('check') : null);
      return b;
    }))];
    const draw = () => s.body.replaceChildren(
      ...group('Time', 'time', [['hour', 'Last hour'], ['today', 'Today'], ['week', 'This week']]),
      ...group('Sort by', 'sort', [['top', 'Top stories'], ['latest', 'Newest first']]),
      ...group('Type', 'type', [[null, 'Everything'], ['news', 'News articles'], ['video', 'Videos'], ['viral', 'Trending & viral'], ['social', 'Social posts (YouTube, Instagram, X)']]));
    draw();
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
    const c = getCard(id); if (!c) return;
    const d = c.data; const liked = !d.liked;
    patch({ ...d, liked, likes: Math.max(0, (d.likes || 0) + (liked ? 1 : -1)) }); // instant
    try {
      const r = await ctx.api('POST', `/api/feed/${id}/like`, { region, have: order.slice(0, 600) });
      const { related, ...counts } = r;
      patch({ ...getCard(id).data, ...counts });
      // More like this: related stories slide in right after the one you liked.
      if (liked && related?.length && cards.has(id)) setTimeout(() => insertAhead(related.slice(0, 3), { after: cards.get(id)?.el }), 450);
    } catch (e) { patch(d); toast(e.message, { error: true }); }
  }
  async function repost(id) {
    const c = getCard(id); if (!c) return;
    const d = c.data;
    try { const r = await ctx.api('POST', `/api/feed/${id}/repost`); patch({ ...getCard(id).data, ...r }); toast(r.reposted ? 'Reposted — it now counts toward what’s buzzing' : 'Repost removed', { timeout: 1800 }); } catch (e) { patch(d); toast(e.message, { error: true }); }
  }

  // Comments: the story on top, a clean list, and a simple input at the bottom.
  function openComments(id) {
    const it = cards.get(id)?.data; if (!it) return;
    const list = h('div', { class: 'cm-list' }, h('div', { class: 'spinner' }));
    const input = h('textarea', { class: 'cm-input', rows: 1, maxlength: 1000, placeholder: 'Add a comment…', 'aria-label': 'Write a comment', enterkeyhint: 'send' });
    const send = h('button', { class: 'cm-send', 'aria-label': 'Post comment', disabled: true, onclick: () => post() }, icon('up'));
    const s = openSheet({ title: 'Comments', left: { label: 'Done' }, full: true, className: 'cm-sheet' });
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; send.disabled = !input.value.trim(); };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); post(); } });
    const empty = () => h('div', { class: 'cm-empty' }, icon('msg'), h('b', null, 'No comments yet'), h('span', null, 'Start the conversation.'));
    async function post() {
      const text = input.value.trim(); if (!text) return;
      send.disabled = true;
      try {
        const r = await ctx.api('POST', `/api/feed/${id}/comments`, { text });
        input.value = ''; grow();
        list.querySelector('.cm-empty')?.remove();
        const el = row(r.comment, null); el.classList.add('cm-new');
        list.append(el); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        patch({ ...cards.get(id).data, ...r.counts });
      } catch (e) { toast(e.message, { error: true }); send.disabled = false; }
    }
    function row(cm, users) {
      const u = users?.find((x) => x.id === cm.userId) || (cm.mine ? ctx.me() : { id: cm.userId, name: 'Someone' });
      const el = h('div', { class: 'cm-row' },
        avatar({ id: u.id, name: u.name, src: ctx.userAvatar(u.id), size: 34 }),
        h('div', { class: 'cm-main' },
          h('div', { class: 'cm-top' }, h('b', null, cm.mine ? 'You' : u.name), h('span', null, ago(cm.createdAt))),
          h('p', null, cm.text),
          cm.mine ? h('button', { class: 'cm-del', onclick: async () => {
            try { const r = await ctx.api('DELETE', `/api/feed/comments/${cm.id}`); el.remove(); patch({ ...cards.get(id).data, ...r.counts }); if (!list.querySelector('.cm-row')) list.append(empty()); } catch (er) { toast(er.message, { error: true }); }
          } }, 'Delete') : null));
      return el;
    }
    s.body.append(
      h('a', { class: 'cm-story', href: it.canonicalUrl, target: '_blank', rel: 'noopener noreferrer' },
        it.imageUrl ? h('img', { src: it.imageUrl, alt: '', referrerpolicy: 'no-referrer' }) : logo(it),
        h('div', null, h('b', null, it.title), h('span', null, it.sourceName))),
      list,
      h('div', { class: 'cm-bar' }, avatar({ id: ctx.me()?.id, name: ctx.me()?.name, src: ctx.userAvatar(ctx.me()?.id), size: 32 }), h('div', { class: 'cm-field' }, input, send)));
    ctx.api('GET', `/api/feed/${id}/comments`).then(({ comments, users }) => {
      list.replaceChildren(...(comments.length ? comments.map((cm) => row(cm, users)) : [empty()]));
    }).catch((e) => { list.textContent = e.message; });
  }

  function shareToChat(it) {
    const chats = ctx.chats();
    const s = openSheet({ title: 'Send to…', left: { label: 'Close' }, full: true });
    s.body.append(h('div', { class: 'group' }, chats.length ? chats.map((c) => h('button', { class: 'user-row', style: { cursor: 'pointer', width: '100%' }, onclick: async () => {
      s.close();
      try { /* shows as a Buzz card in the chat */ await ctx.sendToChat(c.id, `${location.origin}/b/${it.id}`); await ctx.api('POST', `/api/feed/${it.id}/repost`, { on: true }).then((r) => { const c = getCard(it.id); if (c) patch({ ...c.data, ...r }); }).catch(() => {}); toast(`Sent to ${ctx.chatTitle(c)}`); } catch (e) { toast(e.message, { error: true }); }
    } }, avatar({ id: c.id, name: ctx.chatTitle(c), src: ctx.chatAvatar(c), size: 40, group: c.type === 'group' }), h('div', { class: 't' }, h('b', null, ctx.chatTitle(c))))) : h('div', { class: 'bz-empty' }, 'Start a chat first')));
  }

  // ───── lifecycle ─────
  function show(container) {
    if (root !== container || !feedEl) mount(container);
    // Back after 10+ minutes: start again from the top with only stories not seen yet.
    // (the current stories stay on screen until the fresh feed arrives, then swap in one go — no blank flash)
    else if (lastCheck && Date.now() - lastCheck > 10 * 60000) { version = null; fromCache = true; root.scrollTop = 0; }
    visible = true;
    check(true);
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
  }
  function hide() { visible = false; clearInterval(timer); timer = null; if (activeVideo) stopVideo(activeVideo); }
  // Catch up immediately when the tab comes back or the connection returns.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) check(true); });
  addEventListener('online', () => { if (visible) check(true); });

  return { show, hide, get offline() { return offline; } };
}
