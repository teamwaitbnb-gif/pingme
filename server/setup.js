// Creates .env with fresh secrets if it doesn't exist yet. Safe to re-run:
// it only fills in keys that are missing and never replaces existing ones.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const file = path.join(__dirname, '..', '.env');
const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const has = (k) => new RegExp(`^${k}=`, 'm').test(existing);

const vapid = webpush.generateVAPIDKeys();
const defaults = {
  PORT: '8080',
  DB_HOST: '',
  DB_PORT: '3306',
  DB_USER: '',
  DB_PASSWORD: '',
  DB_NAME: 'meetme',
  PINGME_KEY: crypto.randomBytes(32).toString('base64'),
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:admin@example.com',
  TURN_URLS: '',
  TURN_USERNAME: '',
  TURN_CREDENTIAL: '',
  CF_TURN_KEY_ID: '',
  CF_TURN_API_TOKEN: '',
  MEDIA_BUCKET: '',
  ADMIN_KEY: crypto.randomBytes(24).toString('base64url'),
  PUBLIC_URL: '',
  GOOGLE_CLIENT_ID: '',
  APPLE_CLIENT_ID: '',
};

// Older installs called the key MEETME_KEY — never generate a second, different key.
if (has('MEETME_KEY')) delete defaults.PINGME_KEY;
delete defaults.APPLE_CLIENT_ID;
defaults.INVITE_ONLY = 'false';
defaults.RECOVERY_DELAY_MIN = '30';
const missing = Object.entries(defaults).filter(([k]) => !has(k));
if (!missing.length) {
  console.log('.env already complete.');
} else {
  const add = missing.map(([k, v]) => `${k}=${v}`).join('\n');
  fs.writeFileSync(file, (existing ? existing.replace(/\n?$/, '\n') : '') + add + '\n', { mode: 0o600 });
  console.log(`Wrote ${missing.length} value(s) to .env: ${missing.map(([k]) => k).join(', ')}`);
  if (missing.some(([k]) => k === 'PINGME_KEY')) {
    console.log('\n!! PINGME_KEY encrypts all data. Back it up — if it is lost, stored messages cannot be decrypted.');
  }
}
