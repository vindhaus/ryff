// lib/cache.cjs
const fs = require('fs');
const path = require('path');

const STORE_NAME = process.env.BLOBS_STORE || 'ryff-cache';
const DATA_DIR = path.join(process.cwd(), 'netlify', 'data');

let storePromise = null;

// Use @netlify/blobs getStore. Pass creds when available; otherwise try auto; else null.
async function getStoreOrNull() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    try {
      const { getStore } = await import('@netlify/blobs');

      const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token  = process.env.BLOBS_TOKEN   || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;

      if (siteID && token) {
        // Explicit credentials per docs
        return getStore(STORE_NAME, { siteID, token });
      }

      // Try auto env wiring (Functions/Edge). If it throws, we’ll return null.
      try {
        return getStore(STORE_NAME);
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  })();
  return storePromise;
}

function fsEnsureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_KEY = (office) => `AFD:${office.toUpperCase()}`;
const META_KEY = (office) => `AFD_META:${office.toUpperCase()}`;

async function getCached(office) {
  const store = await getStoreOrNull();
  const key = DATA_KEY(office);
  if (store) {
    try {
      const obj = await store.get(key, { type: 'json' });
      return obj || null;
    } catch { /* fall back */ }
  }
  fsEnsureDir();
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function setCached(office, payload) {
  const store = await getStoreOrNull();
  const key = DATA_KEY(office);
  if (store) {
    await store.setJSON(key, payload);
    return;
  }
  fsEnsureDir();
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.json`), JSON.stringify(payload), 'utf8');
}

async function listCachedOffices() {
  const store = await getStoreOrNull();
  if (store) {
    const { blobs } = await store.list({ prefix: 'AFD:' });
    return (blobs || []).map(b => b.key.replace(/^AFD:/, ''));
  }
  fsEnsureDir();
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.basename(f, '.json').toUpperCase());
}

async function getMeta(office) {
  const store = await getStoreOrNull();
  const key = META_KEY(office);
  if (store) {
    const obj = await store.get(key, { type: 'json' });
    return obj || {};
  }
  fsEnsureDir();
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function setMeta(office, meta) {
  const store = await getStoreOrNull();
  const key = META_KEY(office);
  if (store) {
    await store.setJSON(key, meta || {});
    return;
  }
  fsEnsureDir();
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`), JSON.stringify(meta || {}), 'utf8');
}

module.exports = { getCached, setCached, listCachedOffices, getMeta, setMeta };
