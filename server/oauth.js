// Sign in with Google: verify OpenID Connect ID tokens (RS256 JWTs) against the
// providers' published JWKS keys. No third-party libraries — Node's crypto does the work.
const crypto = require('crypto');

const PROVIDERS = {
  google: {
    jwks: process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs', // override only for tests
    issuers: ['accounts.google.com', 'https://accounts.google.com'],
    audiences: () => list(process.env.GOOGLE_CLIENT_ID),
  },
};

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const enabled = (p) => PROVIDERS[p] && PROVIDERS[p].audiences().length > 0;

const keyCache = new Map(); // url -> { at, keys: Map(kid -> KeyObject) }

async function getKey(url, kid) {
  let entry = keyCache.get(url);
  const stale = !entry || Date.now() - entry.at > 3600_000;
  if (stale || !entry.keys.has(kid)) {
    // Don't hammer the provider if a token carries an unknown kid.
    if (entry && !stale && Date.now() - entry.at < 60_000) throw new Error('Unknown signing key');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('Could not fetch provider keys');
    const { keys } = await res.json();
    entry = { at: Date.now(), keys: new Map(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])) };
    keyCache.set(url, entry);
  }
  const key = entry.keys.get(kid);
  if (!key) throw new Error('Unknown signing key');
  return key;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function verifyIdToken(provider, token, { nonce } = {}) {
  const p = PROVIDERS[provider];
  if (!p || !enabled(provider)) throw new Error(`${provider} sign-in is not configured`);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const header = b64json(parts[0]);
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  const key = await getKey(p.jwks, header.kid);
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Invalid token signature');
  const c = b64json(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!p.issuers.includes(c.iss)) throw new Error('Wrong token issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.some((a) => p.audiences().includes(a))) throw new Error('Token is for a different app');
  if (typeof c.exp !== 'number' || c.exp < now - 60) throw new Error('Token expired');
  if (typeof c.iat === 'number' && c.iat > now + 300) throw new Error('Token issued in the future');
  if (!c.sub) throw new Error('Token has no subject');
  // Nonce is mandatory: it ties the token to this browser's sign-in attempt (no replays).
  if (!nonce || !c.nonce || c.nonce !== nonce) throw new Error('Sign-in session expired — please try again');
  const emailVerified = c.email_verified === true || c.email_verified === 'true';
  return {
    provider,
    sub: String(c.sub),
    email: c.email && emailVerified ? String(c.email).toLowerCase() : null,
    name: c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null,
  };
}

module.exports = { verifyIdToken, enabled };
