// Cache + metadata helper: Netlify Blobs (prod), filesystem (dev)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let blobsClient = null;
try { const { createClient } = await import('@netlify/blobs'); blobsClient = createClient(); } catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const INDEX_KEY = 'AFD_INDEX';
const META_KEY = (office) => `AFD_META:${office.toUpperCase()}`; // { lastListModified, lastProductId }
const DATA_KEY = (office) => `AFD:${office.toUpperCase()}`;

export async function getCached(office) {
  const key = DATA_KEY(office);
  if (blobsClient) {
    const raw = await blobsClient.get(key);
    if (!raw) return null;
    return JSON.parse(await raw.text());
  }
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

export async function setCached(office, payload) {
  const key = DATA_KEY(office);
  const body = JSON.stringify(payload);
  if (blobsClient) { await blobsClient.set(key, body, { contentType: 'application/json' }); await addToIndex(office); return; }
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.json`), body, 'utf8');
  await addToIndex(office);
}

export async function listCachedOffices() {
  if (blobsClient) {
    const raw = await blobsClient.get(INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(await raw.text());
    return Array.isArray(list) ? list : [];
  }
  return fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json').toUpperCase());
}

export async function getMeta(office) {
  if (blobsClient) {
    const raw = await blobsClient.get(META_KEY(office));
    return raw ? JSON.parse(await raw.text()) : {};
  }
  const p = path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

export async function setMeta(office, meta) {
  const body = JSON.stringify(meta || {});
  if (blobsClient) { await blobsClient.set(META_KEY(office), body, { contentType: 'application/json' }); return; }
  fs.writeFileSync(path.join(DATA_DIR, `${office.toUpperCase()}.meta.json`), body, 'utf8');
}

async function addToIndex(office) {
  const off = office.toUpperCase();
  if (blobsClient) {
    const raw = await blobsClient.get(INDEX_KEY);
    const current = raw ? JSON.parse(await raw.text()) : [];
    if (!current.includes(off)) { current.push(off); await blobsClient.set(INDEX_KEY, JSON.stringify(current), { contentType: 'application/json' }); }
    return;
  }
  // filesystem mode auto-indexes by reading directory
}