// lib/cache.cjs
// Cache + metadata helper: Netlify Blobs (prod), filesystem (dev, local)
// CommonJS-compatible for Netlify Functions wrappers.

const fs = require('fs');
const path = require('path');

// ---- Config ----
const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_KEY = 'AFD_INDEX';
const META_KEY = (office) => `AFD_META:${office.toUpperCase()}`; // { lastListModified, lastProductId }
const DATA_KEY = (office) => `AFD:${office.toUpperCase()}`;

// Ensure local data dir exists (for dev / no blobs)
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}
ensureDataDir();

// Lazy-init Netlify Blobs client (ESM-only package → use dynamic import)
let _blobsClient = null;
let _blobsTried = false;

async function getBlobsClient() {
  if (_blobsClient || _blobsTried) return _blobsClient;
  _blobsTried = true;
  try {
    const { createClient } = await import('@netlify/blobs');
    _blobsClient = createClient();
  } catch {
    _blobsClient = null; // running locally or package not available
  }
  return _blobsClient;
}

// ---------- Public API ----------

async function getCached(office) {
  const key = DATA_KEY(office);
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(key);
    if (!res) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  }
  // filesystem fallback
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

async function setCached(office, payload) {
  const key = DATA_KEY(office);
  const body = JSON.stringify(payload);
  const client = await getBlobsClient();
  if (client) {
    await client.set(key, body, { contentType: 'application/json' });
    await addToIndex(office);
    return;
  }
  // filesystem fallback
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.json`), body, 'utf8');
  await addToIndex(office);
}

async function listCachedOffices() {
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(INDEX_KEY);
    if (!res) return [];
    const text = await res.text();
    try {
      const list = JSON.parse(text);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  // filesystem fallback
  ensureDataDir();
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.basename(f, '.json').toUpperCase());
}

async function getMeta(office) {
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(META_KEY(office));
    if (!res) return {};
    const text = await res.text();
    try { return JSON.parse(text) || {}; } catch { return {}; }
  }
  // filesystem fallback
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; }
}

async function setMeta(office, meta) {
  const body = JSON.stringify(meta || {});
  const client = await getBlobsClient();
  if (client) {
    await client.set(META_KEY(office), body, { contentType: 'application/json' });
    return;
  }
  // filesystem fallback
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`), body, 'utf8');
}

module.exports = {
  getCached,
  setCached,
  listCachedOffices,
  getMeta,
  setMeta,
};

// ---------- Internal helpers ----------

async function addToIndex(office) {
  const off = office.toUpperCase();
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(INDEX_KEY);
    const current = res ? JSON.parse(await res.text()) : [];
    if (!current.includes(off)) {
      current.push(off);
      await client.set(INDEX_KEY, JSON.stringify(current), { contentType: 'application/json' });
    }
    return;
  }
  // filesystem mode auto-indexes by directory read; nothing needed
}

