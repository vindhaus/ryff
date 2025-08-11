// lib/cache.cjs (Blobs v7, manual creds aware)
// Site-wide store: persists across deploys/functions. FS fallback for local/dev.

const fs = require('fs');
const path = require('path');

const STORE_NAME = process.env.BLOBS_STORE || 'ryff-cache';

// Writable dir for fallback (each lambda = fresh /tmp, so persistence requires Blobs)
const IS_SERVERLESS = !!process.env.LAMBDA_TASK_ROOT || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const DATA_DIR = IS_SERVERLESS ? path.join('/tmp', 'ryff-data') : path.join(__dirname, '..', 'data');
function ensureDir(d){ try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive:true }); } catch{} }
ensureDir(DATA_DIR);

let _store = null, _tried = false;

async function getStoreSafe() {
  if (_tried) return _store;
  _tried = true;
  try {
    const { getStore } = await import('@netlify/blobs');

    // If creds are present, ALWAYS pass them. If not, try auto config.
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.BLOBS_TOKEN   || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;

    try {
      _store = siteID && token
        ? getStore(STORE_NAME, { siteID, token })     // manual config path
        : getStore(STORE_NAME);                       // auto (works if runtime configured)
    } catch (err) {
      // If auto path failed due to missing env, do not crash; fall back to FS
      _store = null;
    }
  } catch {
    _store = null; // module not available
  }
  return _store;
}

const AFD_KEY  = (office) => `AFD:${office.toUpperCase()}`;
const META_KEY = (office) => `META:${office.toUpperCase()}`;

function fileJSON(p){ try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : null; } catch { return null; } }
function writeJSON(p, v){ ensureDir(DATA_DIR); fs.writeFileSync(p, JSON.stringify(v||{}), 'utf8'); }

function pAFD(office){ return path.join(DATA_DIR, `${office.toUpperCase()}.json`); }
function pMETA(office){ return path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`); }

async function getCached(office){
  const store = await getStoreSafe();
  if (store) return await store.get(AFD_KEY(office), { type:'json', consistency:'strong' });
  return fileJSON(pAFD(office));
}

async function setCached(office, payload){
  const store = await getStoreSafe();
  if (store) { await store.setJSON(AFD_KEY(office), payload); return; }
  writeJSON(pAFD(office), payload);
}

async function listCachedOffices(){
  const store = await getStoreSafe();
  if (store) {
    const { blobs } = await store.list({ prefix:'AFD:' });
    return (blobs||[]).map(b => b.key.slice(4)).filter(Boolean);
  }
  try {
    return fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.basename(f, '.json').toUpperCase());
  } catch { return []; }
}

async function getMeta(office){
  const store = await getStoreSafe();
  if (store) return (await store.get(META_KEY(office), { type:'json', consistency:'strong' })) || {};
  return fileJSON(pMETA(office)) || {};
}

async function setMeta(office, meta){
  const store = await getStoreSafe();
  if (store) { await store.setJSON(META_KEY(office), meta || {}); return; }
  writeJSON(pMETA(office), meta || {});
}

module.exports = { getCached, setCached, listCachedOffices, getMeta, setMeta };
