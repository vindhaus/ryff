// lib/cache.cjs
// Cache + metadata helper: prefer Netlify Blobs in prod; fallback to filesystem.
// IMPORTANT: On Netlify/Lambda, the only writable area is /tmp — use that.

const fs = require('fs');
const path = require('path');

// Detect serverless and choose a writable directory
const IS_SERVERLESS = !!process.env.LAMBDA_TASK_ROOT || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const TMP_DATA_DIR = path.join('/tmp', 'ryff-data');
const DATA_DIR = IS_SERVERLESS ? TMP_DATA_DIR : LOCAL_DATA_DIR;

const INDEX_KEY = 'AFD_INDEX';
const META_KEY = (office) => `AFD_META:${office.toUpperCase()}`; // { lastListModified, lastProductId }
const DATA_KEY = (office) => `AFD:${office.toUpperCase()}`;

function ensureDirSafe(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
}
ensureDirSafe(DATA_DIR);

// Lazy-init Netlify Blobs client (ESM package → dynamic import)
let _blobsClient = null;
let _tried = false;
async function getBlobsClient() {
  if (_tried) return _blobsClient;
  _tried = true;
  try {
    const { createClient } = await import('@netlify/blobs');
    _blobsClient = createClient();
  } catch {
    _blobsClient = null; // not available locally or not installed
  }
  return _blobsClient;
}

// ---------------- Public API ----------------
async function getCached(office) {
  const key = DATA_KEY(office);
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(key);
    if (!res) return null;
    try { return JSON.parse(await res.text()); } catch { return null; }
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
  ensureDirSafe(DATA_DIR);
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.json`), body, 'utf8');
  await addToIndex(office);
}

async function listCachedOffices() {
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(INDEX_KEY);
    if (!res) return [];
    try { const list = JSON.parse(await res.text()); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  if (!fs.existsSync(DATA_DIR)) return [];
  try {
    return fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f, '.json').toUpperCase());
  } catch { return []; }
}

async function getMeta(office) {
  const client = await getBlobsClient();
  if (client) {
    const res = await client.get(META_KEY(office));
    if (!res) return {};
    try { return JSON.parse(await res.text()) || {}; } catch { return {}; }
  }
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
  ensureDirSafe(DATA_DIR);
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`), body, 'utf8');
}

module.exports = { getCached, setCached, listCachedOffices, getMeta, setMeta };

// ---------------- Internal ----------------
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
  // filesystem mode: index is implicit via directory listing
}
