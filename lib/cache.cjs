// lib/cache.cjs
// Netlify Blobs (v7+) as primary store; filesystem fallback for local/dev.
// Keys:
//   AFD:<OFFICE>            -> JSON payload for the latest cached AFD
//   META:<OFFICE>           -> { lastListModified, lastProductId }

const fs = require('fs');
const path = require('path');

const STORE_NAME = process.env.BLOBS_STORE || 'ryff-cache';

import('@netlify/blobs').then(({ getStore }) => getStore(STORE_NAME))

// Detect serverless; local fallback dir
const IS_SERVERLESS = !!process.env.LAMBDA_TASK_ROOT || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const TMP_DATA_DIR = path.join('/tmp', 'ryff-data');
const DATA_DIR = IS_SERVERLESS ? TMP_DATA_DIR : LOCAL_DATA_DIR;

function ensureDir(dir) { try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {} }
ensureDir(DATA_DIR);

// Lazy load Blobs v7+ (CommonJS-friendly)
let _store = null, _tried = false;
async function getStoreSafe() {
  if (_tried) return _store;
  _tried = true;
  try {
    const mod = await import('@netlify/blobs');
    // Use site-wide store so data persists across deploys/functions
    _store = mod.getStore(STORE_NAME);
  } catch {
    _store = null; // not available (e.g., local without dep)
  }
  return _store;
}

// ---------- helpers ----------
const AFD_KEY  = (office) => `AFD:${office.toUpperCase()}`;
const META_KEY = (office) => `META:${office.toUpperCase()}`;

function pJSON(office)      { return path.join(DATA_DIR, `${office.toUpperCase()}.json`); }
function pMETA(office)      { return path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`); }

async function readFileJSON(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
  catch { return null; }
}

async function writeFileJSON(file, obj) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(file, JSON.stringify(obj || {}), 'utf8');
}

// ---------- public API ----------
async function getCached(office) {
  const store = await getStoreSafe();
  if (store) {
    const data = await store.get(AFD_KEY(office), { type: 'json', consistency: 'strong' });
    return data; // null if missing
  }
  return readFileJSON(pJSON(office));
}

async function setCached(office, payload) {
  const store = await getStoreSafe();
  if (store) {
    await store.setJSON(AFD_KEY(office), payload);
    return;
  }
  await writeFileJSON(pJSON(office), payload);
}

async function listCachedOffices() {
  const store = await getStoreSafe();
  if (store) {
    const { blobs } = await store.list({ prefix: 'AFD:' });
    // keys look like "AFD:MKX" -> return "MKX"
    return (blobs || []).map(b => b.key.slice(4)).filter(Boolean);
  }
  // filesystem fallback
  try {
    return fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json').toUpperCase());
  } catch { return []; }
}

async function getMeta(office) {
  const store = await getStoreSafe();
  if (store) {
    const data = await store.get(META_KEY(office), { type: 'json', consistency: 'strong' });
    return data || {};
  }
  return (await readFileJSON(pMETA(office))) || {};
}

async function setMeta(office, meta) {
  const store = await getStoreSafe();
  if (store) {
    await store.setJSON(META_KEY(office), meta || {});
    return;
  }
  await writeFileJSON(pMETA(office), meta || {});
}

module.exports = { getCached, setCached, listCachedOffices, getMeta, setMeta };

