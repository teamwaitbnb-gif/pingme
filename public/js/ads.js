// In-app ads (set up by the owner on the admin page): a card inside the Buzz feed, and a banner above
// the chat list. Always labelled "Sponsored". A view counts once per ad per session, after the ad has
// been at least half on screen for a second; a tap on the ad or its button counts as a click.
import { h, icon } from './ui.js';
import { api } from './core.js';

const lists = new Map();      // placement:region → { at, ads }
const viewed = new Set();
let seen = null;
try { seen = new Set(JSON.parse(sessionStorage.getItem('pm:adsSeen') || '[]')); } catch { seen = new Set(); }

export async function loadAds(placement, region = 'india') {
  const key = placement + ':' + region;
  const hit = lists.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.ads;
  try {
    const { ads } = await api('GET', `/api/ads?placement=${placement}&region=${encodeURIComponent(region)}`);
    lists.set(key, { at: Date.now(), ads });
    return ads;
  } catch { return hit?.ads || []; }
}

// Pick ads in turn, more often for higher weight.
export function rotation(ads) {
  const bag = ads.flatMap((a) => Array(Math.max(1, Math.min(10, a.weight || 1))).fill(a));
  let i = Math.floor(Math.random() * Math.max(1, bag.length));
  return () => (bag.length ? bag[i++ % bag.length] : null);
}

const event = (id, type) => api('POST', `/api/ads/${id}/event`, { type }).catch(() => {});
const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.5) {
      el._timer = setTimeout(() => {
        const id = el.dataset.ad;
        if (!viewed.has(id)) { viewed.add(id); event(id, 'view'); }
        observer.unobserve(el);
      }, 1000);
    } else clearTimeout(el._timer);
    // Videos play only while on screen.
    const v = el.querySelector('video');
    if (v) { if (e.isIntersecting && e.intersectionRatio >= 0.5) v.play().catch(() => {}); else v.pause(); }
  }
}, { threshold: [0, 0.5] }) : null;

function open(ad) {
  event(ad.id, 'click');
  if (ad.url) window.open(ad.url, '_blank', 'noopener');
}

function mediaOf(ad, cls) {
  if (ad.kind === 'video') {
    const v = h('video', { class: cls, src: ad.media, muted: true, playsinline: true, loop: true, preload: 'metadata' });
    v.muted = true;
    const sound = h('button', { class: 'ad-sound', 'aria-label': 'Sound', onclick: (e) => { e.stopPropagation(); v.muted = !v.muted; sound.replaceChildren(icon(v.muted ? 'mute' : 'vol')); } }, icon('mute'));
    return [v, sound];
  }
  return [h('img', { class: cls, src: ad.media, alt: ad.headline, loading: 'lazy', decoding: 'async' })];
}

// A card in the Buzz feed.
export function adCard(ad) {
  const el = h('article', { class: 'bz-card ad-card', 'data-ad': ad.id, role: 'link', tabindex: '0', onclick: () => open(ad) },
    h('div', { class: 'bz-media ad-media' }, ...mediaOf(ad, '')),
    h('div', { class: 'bz-body' },
      h('div', { class: 'bz-meta' }, h('span', { class: 'ad-tag' }, 'Sponsored'), ad.advertiser ? h('span', { class: 'bz-src' }, ad.advertiser) : null),
      h('b', { class: 'bz-h ad-h' }, ad.headline),
      ad.text ? h('p', { class: 'bz-d' }, ad.text) : null,
      ad.url ? h('button', { class: 'ad-cta', onclick: (e) => { e.stopPropagation(); open(ad); } }, ad.cta || 'Learn more', icon('chev')) : null));
  observer?.observe(el);
  return el;
}

// A slim banner above the chat list; can be closed (for this session).
export function adBanner(ad, onClose) {
  const el = h('div', { class: 'ad-banner', 'data-ad': ad.id, role: 'link', tabindex: '0', onclick: () => open(ad) },
    h('div', { class: 'ad-thumb' }, ...mediaOf(ad, '')),
    h('div', { class: 'ad-bt' }, h('span', { class: 'ad-tag' }, 'Sponsored', ad.advertiser ? ' · ' + ad.advertiser : ''), h('b', null, ad.headline), ad.text ? h('span', { class: 'ad-sub' }, ad.text) : null),
    ad.url ? h('span', { class: 'ad-cta sm' }, ad.cta || 'Open') : null,
    h('button', { class: 'ad-x', 'aria-label': 'Hide ad', onclick: (e) => { e.stopPropagation(); seen.add(String(ad.id)); try { sessionStorage.setItem('pm:adsSeen', JSON.stringify([...seen])); } catch {} el.remove(); onClose?.(); } }, icon('x')));
  observer?.observe(el);
  return el;
}
export const bannerHidden = (ad) => seen.has(String(ad.id));
