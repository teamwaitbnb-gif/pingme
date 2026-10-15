// App lock with an optional duress PIN.
// The real PIN opens everything. The duress PIN opens a normal-looking app with the chats you chose
// hidden (and their notifications silenced) — for when someone forces you to unlock your phone.
// PINs are stored only on this device, as salted PBKDF2 hashes.
import { h, icon, store } from './ui.js';
import { S } from './core.js';

const ITER = 150000;
const AUTO_LOCK_MS = 60000;
const enc = (s) => new TextEncoder().encode(s);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function hashPin(pin, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}

const cfg = () => store.get('lock', null);
export const lockEnabled = () => !!cfg()?.hash;
export const hasDuress = () => !!cfg()?.duress;
export const hiddenChats = () => new Set(store.get('hiddenChats', []));
export const isHidden = (chatId) => S.duress && hiddenChats().has(chatId);

export async function setPin(pin) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const prev = cfg() || {};
  store.set('lock', { ...prev, salt, hash: await hashPin(pin, salt), len: pin.length, duress: null });
}

export async function setDuressPin(pin) {
  const c = cfg();
  if (!c) throw new Error('Turn on app lock first');
  const d = await hashPin(pin, c.salt);
  if (d === c.hash) throw new Error('Duress PIN must be different from your PIN');
  store.set('lock', { ...c, duress: d });
}

export function disableLock() {
  store.del('lock');
  S.duress = false;
  syncDuressToWorker();
}

export function setHiddenChats(ids) {
  store.set('hiddenChats', [...new Set(ids)]);
  syncDuressToWorker();
}

// The service worker reads this to silence notifications from hidden chats while in duress mode.
async function syncDuressToWorker() {
  try {
    const c = await caches.open('pm-prefs');
    await c.put('/__duress', new Response(JSON.stringify({ active: !!S.duress, hidden: [...hiddenChats()] }), { headers: { 'content-type': 'application/json' } }));
  } catch {}
}

let lockedAt = 0;
let showing = false;

export function showLock(onUnlock) {
  if (showing) return;
  const c = cfg();
  if (!c) return onUnlock?.();
  showing = true;
  let pin = '';
  let fails = store.get('lockFails', 0);
  const dots = h('div', { class: 'pin-dots' });
  const msg = h('div', { class: 'pin-msg' }, 'Enter your PIN');
  const draw = () => dots.replaceChildren(...Array.from({ length: c.len || 4 }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));
  const tryPin = async () => {
    const until = store.get('lockUntil', 0);
    if (Date.now() < until) { msg.textContent = `Too many tries — wait ${Math.ceil((until - Date.now()) / 1000)}s`; pin = ''; draw(); return; }
    const hashed = await hashPin(pin, c.salt);
    if (hashed === c.hash || (c.duress && hashed === c.duress)) {
      S.duress = hashed !== c.hash;
      store.set('lockFails', 0);
      syncDuressToWorker();
      showing = false;
      root.remove();
      onUnlock?.();
      return;
    }
    fails++;
    store.set('lockFails', fails);
    if (fails >= 5) { store.set('lockUntil', Date.now() + 30000 * Math.min(10, fails - 4)); }
    msg.textContent = 'Wrong PIN';
    root.querySelector('.pin-dots').classList.add('shake');
    setTimeout(() => root.querySelector('.pin-dots')?.classList.remove('shake'), 400);
    navigator.vibrate?.(80);
    pin = ''; draw();
  };
  const press = (d) => {
    if (d === 'del') pin = pin.slice(0, -1);
    else if (pin.length < (c.len || 4)) pin += d;
    draw();
    if (pin.length === (c.len || 4)) setTimeout(tryPin, 60);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  const root = h('div', { class: 'lockscreen' },
    h('img', { class: 'lock-hand', src: '/icons/hand.svg', alt: '' }),
    msg, dots,
    h('div', { class: 'keypad' }, keys.map((k) => k === '' ? h('span') : h('button', { 'aria-label': k === 'del' ? 'Delete' : k, onclick: () => press(k) }, k === 'del' ? icon('back') : k))));
  const onKey = (e) => {
    if (!root.isConnected) return removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    if (e.key === 'Backspace') press('del');
  };
  addEventListener('keydown', onKey);
  draw();
  document.body.append(root);
}

// Relock after the app has been in the background for a minute.
document.addEventListener('visibilitychange', () => {
  if (!lockEnabled() || !S.me) return;
  if (document.hidden) lockedAt = Date.now();
  else if (lockedAt && Date.now() - lockedAt > AUTO_LOCK_MS) showLock(() => window.dispatchEvent(new Event('mm:unlocked')));
});

export async function checkPin(pin) {
  const c = cfg();
  return !!c && (await hashPin(pin, c.salt)) === c.hash;
}
