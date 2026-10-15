// Ping Me's own permission screen, shown just before the phone's system prompt.
// The system prompt can't be restyled (it always shows the web address), so we explain first in
// Ping Me's own words — and only when the permission hasn't been decided yet.
import { h, icon, isIOS } from './ui.js';

const INFO = {
  camera: { icon: 'video', label: 'camera' },
  microphone: { icon: 'mic', label: 'microphone' },
  geolocation: { icon: 'map', label: 'location' },
};

export async function permissionState(name) { return state(name); }

async function state(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; }
}

// Resolves true when it's OK to go ahead and call getUserMedia / geolocation.
export async function ensurePermission(names, reason) {
  const states = await Promise.all(names.map(state));
  if (states.every((s) => s === 'granted')) return true;
  if (states.some((s) => s === 'denied')) { blockedHelp(names); return false; }
  return explain(names, reason);
}

function explain(names, reason) {
  return new Promise((resolve) => {
    const what = names.map((n) => INFO[n].label).join(' & ');
    const finish = (ok) => { root.remove(); resolve(ok); };
    const root = h('div', { class: 'perm' },
      h('div', { class: 'perm-card', role: 'dialog', 'aria-label': `Allow ${what}` },
        h('img', { class: 'perm-logo', src: '/icons/icon-192.png', alt: '' }),
        h('div', { class: 'perm-icons' }, names.map((n) => h('span', null, icon(INFO[n].icon)))),
        h('h2', null, `Ping Me needs your ${what}`),
        h('p', null, reason),
        h('button', { class: 'btn', onclick: () => finish(true) }, 'Allow'),
        h('button', { class: 'perm-later', onclick: () => finish(false) }, 'Not now'),
        h('small', null, 'Your phone will confirm once. Ping Me only uses it while you’re in a call or using that feature.')));
    document.body.append(root);
  });
}

function blockedHelp(names) {
  const what = names.map((n) => INFO[n].label).join(' & ');
  const steps = isIOS()
    ? `On iPhone: open Settings → Apps → Safari (or the Ping Me app) → allow ${what}. Then come back and try again.`
    : `Tap the lock or ⓘ icon next to the address (or long-press the Ping Me app icon → App info → Permissions) and allow ${what}. Then try again.`;
  const close = () => root.remove();
  const root = h('div', { class: 'perm', onclick: (e) => { if (e.target === root) close(); } },
    h('div', { class: 'perm-card' },
      h('img', { class: 'perm-logo', src: '/icons/icon-192.png', alt: '' }),
      h('h2', null, `Turn on ${what} for Ping Me`),
      h('p', null, `Access was turned off earlier. ${steps}`),
      h('button', { class: 'btn', onclick: close }, 'OK')));
  document.body.append(root);
}
