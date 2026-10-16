// Large-file storage: files are split into 8 MiB pieces, each encrypted (AES-256-GCM) on its own, so
// original-quality videos of any size up to MAX_FILE upload in small requests (Cloud Run caps a
// request at 32 MiB) and stream with seeking without loading the whole file.
// Pieces live in Google Cloud Storage when MEDIA_BUCKET is set, otherwise in the database.
const db = require('./db');
const C = require('./crypto');

const CHUNK = 8 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024 * 1024; // 2 GiB
const bucket = () => process.env.MEDIA_BUCKET || '';

// ───── Google Cloud Storage (JSON API, token from the Cloud Run metadata server) ─────
let token = { value: null, exp: 0 };
async function gcsToken() {
  if (process.env.GCS_TOKEN) return process.env.GCS_TOKEN; // tests / local runs
  if (token.value && Date.now() < token.exp - 60000) return token.value;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('No Cloud Storage credentials (metadata server ' + r.status + ')');
  const d = await r.json();
  token = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return token.value;
}
const GCS = () => process.env.GCS_API || 'https://storage.googleapis.com';
const objName = (attId, idx) => `att/${attId}/${idx}`;

async function gcs(method, url, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method, headers: { authorization: `Bearer ${await gcsToken()}`, ...(body ? { 'content-type': 'application/octet-stream' } : {}) }, body });
    if (r.ok || r.status === 404 || attempt >= 2 || r.status < 500) return r;
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
}

async function putChunk(attId, idx, plain) {
  const data = C.encBuf(plain);
  if (bucket()) {
    const r = await gcs('POST', `${GCS()}/upload/storage/v1/b/${bucket()}/o?uploadType=media&name=${encodeURIComponent(objName(attId, idx))}`, data);
    if (!r.ok) throw new Error('Storage upload failed (' + r.status + ')');
  } else {
    await db.q('INSERT INTO attachment_chunks (att_id, idx, data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)', [attId, idx, data]);
  }
}

async function getChunkRaw(attId, idx, where) {
  if (where === 'gcs') {
    const r = await gcs('GET', `${GCS()}/storage/v1/b/${bucket()}/o/${encodeURIComponent(objName(attId, idx))}?alt=media`);
    if (!r.ok) throw new Error('Storage read failed (' + r.status + ')');
    return Buffer.from(await r.arrayBuffer());
  }
  const row = await db.one('SELECT data FROM attachment_chunks WHERE att_id=? AND idx=?', [attId, idx]);
  if (!row) throw new Error('Missing file piece');
  return row.data;
}

// Decrypted pieces are cached (LRU) so seeking in a video stays fast.
const cache = new Map();
let cacheBytes = 0;
const CACHE_MAX = 128 * 1024 * 1024;
async function getChunk(attId, idx, where) {
  const key = attId + ':' + idx;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const plain = C.decBuf(await getChunkRaw(attId, idx, where));
  cache.set(key, plain);
  cacheBytes += plain.length;
  for (const [k, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(k); cacheBytes -= v.length; }
  return plain;
}

async function chunkCount(attId, where) {
  if (where === 'gcs') {
    const r = await gcs('GET', `${GCS()}/storage/v1/b/${bucket()}/o?prefix=${encodeURIComponent(`att/${attId}/`)}&fields=items(name)`);
    if (!r.ok) throw new Error('Storage list failed (' + r.status + ')');
    return ((await r.json()).items || []).length;
  }
  return Number((await db.one('SELECT COUNT(*) n FROM attachment_chunks WHERE att_id=?', [attId])).n);
}

async function removeChunks(rows) {
  for (const a of rows) {
    if (!a.chunks) continue;
    if (a.store === 'gcs') {
      for (let i = 0; i < a.chunks; i++) await gcs('DELETE', `${GCS()}/storage/v1/b/${bucket()}/o/${encodeURIComponent(objName(a.id, i))}`).catch(() => {});
    } else {
      await db.q('DELETE FROM attachment_chunks WHERE att_id=?', [a.id]);
    }
    for (let i = 0; i < a.chunks; i++) { const k = a.id + ':' + i; const v = cache.get(k); if (v) { cacheBytes -= v.length; cache.delete(k); } }
  }
}

// Stream bytes [start, end] of a chunked file.
async function stream(res, a, start, end) {
  for (let idx = Math.floor(start / CHUNK); idx <= Math.floor(end / CHUNK); idx++) {
    if (res.destroyed) return;
    const piece = await getChunk(a.id, idx, a.store);
    const from = idx === Math.floor(start / CHUNK) ? start - idx * CHUNK : 0;
    const to = idx === Math.floor(end / CHUNK) ? end - idx * CHUNK + 1 : piece.length;
    const ok = res.write(piece.subarray(from, to));
    if (!ok) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

module.exports = { CHUNK, MAX_FILE, bucket, putChunk, chunkCount, removeChunks, stream };
