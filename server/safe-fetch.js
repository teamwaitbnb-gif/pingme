// Bounded public HTTP requests for chat link previews.
const dns = require('dns').promises;
const net = require('net');
const UA = 'PingMe-LinkPreview/1.0';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 1200 * 1024;
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:169.254.') || x.startsWith('::ffff:192.168.');
}
async function assertPublic(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port))) throw new FetchError('Blocked URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new FetchError('Blocked private address');
}

class FetchError extends Error { constructor(msg, status, retryAfter) { super(msg); this.status = status; this.retryAfter = retryAfter; } }

// GET with timeout, size cap, manual redirects (http/https only, max 3) and conditional headers.
async function safeGet(url, { timeout = 9000, maxBytes = MAX_RESPONSE_BYTES, etag, lastModified, accept, ua = UA, auth } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const headers = { 'user-agent': ua, accept: accept || 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5' };
    if (hop === 0 && etag) headers['if-none-match'] = etag;
    if (hop === 0 && lastModified) headers['if-modified-since'] = lastModified;
    if (hop === 0 && auth) headers.authorization = auth; // API keys never follow a redirect
    const r = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (r.status >= 300 && r.status < 400 && r.status !== 304) {
      const loc = r.headers.get('location');
      if (!loc) throw new FetchError('Redirect without location', r.status);
      current = new URL(loc, current).toString();
      continue;
    }
    if (r.status === 304) return { notModified: true, headers: r.headers };
    if (!r.ok) throw new FetchError(`HTTP ${r.status}`, r.status, Number(r.headers.get('retry-after')) || null);
    // Read with a size cap.
    const reader = r.body.getReader(); const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel().catch(() => {}); if (maxBytes === MAX_PAGE_BYTES) break; throw new FetchError('Response too large'); }
      parts.push(value);
    }
    return { body: Buffer.concat(parts).toString('utf8'), headers: r.headers, finalUrl: current };
  }
  throw new FetchError('Too many redirects');
}

module.exports = { safeGet, FetchError };
