// lib/cache.cjs
const fs = require('fs');
const path = require('path');

const STORE_NAME = process.env.BLOBS_STORE || 'ryff-cache';
// Never write under /var/task. Lambda's writable area is /tmp.
const TMP_DIR = '/tmp/ryff-data';

const DATA_KEY = (office) => `AFD:${office.toUpperCase()}`;
const META_KEY = (office) => `AFD_META:${office.toUpperCase()}`;

let storePromise = null;

/**
 * Initialize a Netlify Blobs store using explicit credentials.
 * If creds are missing or Blobs isn’t available, return null (we’ll /tmp fallback).
 */
async function getStoreOrNull() {
  if (storePromise) return storePromise;

  storePromise = (async () => {
    try {
      const { getStore } = await import('@netlify/blobs');

      // Explicit per docs. Prefer your own vars; fall back to built-ins if present.
      const siteID =
        process.env.BLOBS_SITE_ID ||
        process.env.NETLIFY_SITE_ID ||
        process.env.SITE_ID;

      const token =
        process.env.BLOBS_TOKEN ||
        process.env.NETLIFY_AUTH_TOKEN ||
        process.env.NETLIFY_TOKEN;

      if (siteID && token) {
        return getStore(STORE_NAME, { siteID, token });
      } else {
        // No creds → do NOT call getStore() bare (that throws).
        console.warn(
          `[cache] Netlify Blobs disabled: missing siteID/token (siteID=${!!siteID}, token=${!!token}). Using /tmp fallback.`
        );
        return null;
      }
    } catch (e) {
      console.warn(`[cache] Netlify Blobs not available (${e.message}). Using /tmp fallback.`);
      return null;
    }
  })();

  return storePromise;
}

function ensureTmpDir() {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  } catch {}
}

function tmpPath(name) {
  return path.join(TMP_DIR, name);
}

/** ------- Public API ------- **/

async function getCached(office) {
  const store = await getStoreOrNull();
  const key = DATA_KEY(office);

  if (store) {
    try {
      const obj = await store.get(key, { type: 'json' /*, consistency: 'strong'*/ });
      return obj || null;
    } catch (e) {
      console.warn(`[cache] Blobs get(${key}) failed: ${e.message}. Falling back to /tmp.`);
    }
  }

  ensureTmpDir();
  const p = tmpPath(`${office.toUpperCase()}.json`);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

async function setCached(office, payload) {
  const store = await getStoreOrNull();
  const key = DATA_KEY(office);

  if (store) {
    try {
      await store.setJSON(key, payload);
      return;
    } catch (e) {
      console.warn(`[cache] Blobs setJSON(${key}) failed: ${e.message}. Falling back to /tmp.`);
    }
  }

  ensureTmpDir();
  fs.writeFileSync(tmpPath(`${office.toUpperCase()}.json`), JSON.stringify(payload), 'utf8');
}

async function listCachedOffices() {
  const store = await getStoreOrNull();

  if (store) {
    try {
      const { blobs } = await store.list({ prefix: 'AFD:' });
      return (blobs || []).map((b) => b.key.replace(/^AFD:/, ''));
    } catch (e) {
      console.warn(`[cache] Blobs list failed: ${e.message}. Falling back to /tmp.`);
    }
  }

  ensureTmpDir();
  return fs
    .readdirSync(TMP_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map((f) => path.basename(f, '.json').toUpperCase());
}

async function getMeta(office) {
  const store = await getStoreOrNull();
  const key = META_KEY(office);

  if (store) {
    try {
      const obj = await store.get(key, { type: 'json' /*, consistency: 'strong'*/ });
      return obj || {};
    } catch (e) {
      console.warn(`[cache] Blobs get meta(${key}) failed: ${e.message}. Falling back to /tmp.`);
    }
  }

  ensureTmpDir();
  const p = tmpPath(`${office.toUpperCase()}.meta.json`);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

async function setMeta(office, meta) {
  const store = await getStoreOrNull();
  const key = META_KEY(office);

  if (store) {
    try {
      await store.setJSON(key, meta || {});
      return;
    } catch (e) {
      console.warn(`[cache] Blobs set meta(${key}) failed: ${e.message}. Falling back to /tmp.`);
    }
  }

  ensureTmpDir();
  fs.writeFileSync(tmpPath(`${office.toUpperCase()}.meta.json`), JSON.stringify(meta || {}), 'utf8');
}

module.exports = { getCached, setCached, listCachedOffices, getMeta, setMeta };
