// At-rest encryption for everything Ping Me stores in MySQL.
// AES-256-GCM (authenticated) with a random 96-bit IV per value.
// Lookup fields (usernames, push endpoints) use keyed HMAC-SHA256 so they
// can be matched without ever being stored in plain text.
const crypto = require('crypto');

let encKey, macKey;

function init(masterB64) {
  if (!masterB64) throw new Error('PINGME_KEY is missing. Run `npm run setup` first.');
  const master = Buffer.from(masterB64, 'base64');
  if (master.length !== 32) throw new Error('PINGME_KEY must be 32 bytes, base64 encoded.');
  encKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'meetme-enc-v1', 32));
  macKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'meetme-mac-v1', 32));
}

function encBuf(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function decBuf(blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

// Strings / JSON -> "v1:<base64>"
function enc(value) {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return 'v1:' + encBuf(Buffer.from(s, 'utf8')).toString('base64');
}

function dec(value) {
  if (!value) return null;
  try {
    return decBuf(Buffer.from(String(value).slice(3), 'base64')).toString('utf8');
  } catch {
    return null;
  }
}

function decJson(value, fallback = null) {
  const s = dec(value);
  if (s === null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function hmac(s) {
  return crypto.createHmac('sha256', macKey).update(String(s)).digest('hex');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Password hashing with scrypt (memory-hard, built into Node).
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, SCRYPT, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const [, saltB64, keyB64] = String(stored).split('$');
    if (!saltB64 || !keyB64) return resolve(false);
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT, (err, key) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(key, expected));
    });
  });
}

function token() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { init, enc, dec, decJson, encBuf, decBuf, hmac, sha256, hashPassword, verifyPassword, token };
