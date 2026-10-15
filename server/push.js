// Web Push (works on Android and on iOS 16.4+ when Ping Me is added to the home screen).
const webpush = require('web-push');
const db = require('./db');
const C = require('./crypto');

let enabled = false;

function init() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    enabled = true;
  }
}

async function subscribe(userId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) throw new Error('Invalid subscription');
  const h = C.hmac('push:' + sub.endpoint);
  await db.q(
    'INSERT INTO push_subs (endpoint_hash, user_id, sub_enc) VALUES (?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), sub_enc=VALUES(sub_enc)',
    [h, userId, C.enc(sub)]
  );
}

async function unsubscribe(endpoint) {
  await db.q('DELETE FROM push_subs WHERE endpoint_hash=?', [C.hmac('push:' + endpoint)]);
}

async function send(userId, payload, { urgency = 'normal', ttl = 3600 } = {}) {
  if (!enabled) return;
  const subs = await db.q('SELECT endpoint_hash, sub_enc FROM push_subs WHERE user_id=?', [userId]);
  await Promise.all(subs.map(async (row) => {
    const sub = C.decJson(row.sub_enc);
    if (!sub) return;
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: ttl, urgency });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.q('DELETE FROM push_subs WHERE endpoint_hash=?', [row.endpoint_hash]);
      }
    }
  }));
}

module.exports = { init, subscribe, unsubscribe, send, get enabled() { return enabled; } };
