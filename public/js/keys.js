// Device identity keys (ECDSA P-256 via WebCrypto). The private key is created non-extractable and
// lives only in this browser's IndexedDB. Used for:
//  • call verification — "same person, same device as before" (trust-on-first-use, like Signal)
//  • "Verified Real" photos — a signature over the exact image bytes taken with the in-app camera
import { api } from './core.js';
import { store } from './ui.js';

const DB = 'pingme-keys';
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
}

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

let mine = null; // { privateKey, jwk, keyId }

export async function deviceKey() {
  if (mine) return mine;
  if (!window.crypto?.subtle || !window.indexedDB) throw new Error('This browser can’t create device keys');
  let rec = await idbGet('device').catch(() => null);
  if (!rec) {
    const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    rec = { privateKey: pair.privateKey, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
    await idbSet('device', rec);
  }
  const { keyId } = await api('POST', '/api/devices', { jwk: rec.jwk, label: navigator.userAgent.slice(0, 80) });
  mine = { ...rec, keyId };
  return mine;
}

export async function sign(data) {
  const k = await deviceKey();
  const sig = await crypto.subtle.sign(SIGN, k.privateKey, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  return { sig: b64u(sig), keyId: k.keyId, jwk: k.jwk };
}

export async function verify(jwk, sigB64, data) {
  try {
    const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, unb64u(sigB64), typeof data === 'string' ? new TextEncoder().encode(data) : data);
  } catch { return false; }
}

export async function sha256(buf) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

// Trust-on-first-use memory of which device keys we've seen for each person.
export function rememberKey(userId, keyId) {
  const all = store.get('knownKeys', {});
  const list = new Set(all[userId] || []);
  const isNew = !list.has(keyId);
  const firstEver = list.size === 0;
  list.add(keyId);
  all[userId] = [...list].slice(-10);
  store.set('knownKeys', all);
  return { isNew, firstEver };
}

// Verify a "Verified Real" photo: signature by a device key registered to the sender, over the bytes.
const vrCache = new Map();
export function verifyPhoto(m, url) {
  const key = `${m.id}:${m.vr?.sig}`;
  if (!vrCache.has(key)) {
    vrCache.set(key, (async () => {
      try {
        const dev = await api('GET', `/api/devices/${m.vr.keyId}`);
        if (dev.userId !== m.senderId) return false;
        const bytes = await fetch(url).then((r) => r.arrayBuffer());
        const digest = await sha256(bytes);
        return verify(dev.jwk, m.vr.sig, new TextEncoder().encode(`pingme-vr|${m.vr.at}|${b64u(digest)}`));
      } catch { return false; }
    })());
  }
  return vrCache.get(key);
}

export async function signPhoto(bytes, at) {
  const digest = await sha256(bytes);
  return sign(new TextEncoder().encode(`pingme-vr|${at}|${b64u(digest)}`));
}
