// Scheduler only. Preloads ALL WFOs from netlify/wfos.json.
// Uses If-Modified-Since / Last-Modified on the listing; fetches full product only when changed.
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setCached, getMeta, setMeta } from '../../lib/cache.js';

const NWS_UA = process.env.NWS_USER_AGENT || 'RYFF/1.0 (no-contact@invalid)';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WFO_LIST_PATH = path.join(__dirname, '..', 'wfos.json');

function loadWFOs() {
  try { return JSON.parse(fs.readFileSync(WFO_LIST_PATH, 'utf8')).map(s => String(s).toUpperCase()); } catch { return []; }
}

async function nwsJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': NWS_UA, ...headers } });
  if (res.status === 304) return { notModified: true, headers: Object.fromEntries(res.headers.entries()) };
  if (!res.ok) throw new Error(`NWS ${res.status}: ${await res.text()}`);
  return { json: await res.json(), headers: Object.fromEntries(res.headers.entries()) };
}

async function refreshOne(office) {
  const off = office.toUpperCase();
  const meta = await getMeta(off);

  const listUrl = `https://api.weather.gov/products/types/AFD/locations/${encodeURIComponent(off)}?limit=1`;
  const condHeaders = meta.lastListModified ? { 'If-Modified-Since': meta.lastListModified } : {};

  const listResp = await nwsJson(listUrl, condHeaders);
  if (listResp.notModified) return { office: off, updated: false, reason: 'Not modified' };

  const lastModified = listResp.headers['last-modified'] || null;
  const latest = listResp.json?.features?.[0];
  if (!latest) { if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified }); return { office: off, updated: false, reason: 'No AFD' }; }

  const latestId = latest.id;
  const issued = latest?.issuanceTime || latest?.issued || latest?.properties?.issuanceTime;
  if (meta.lastProductId && meta.lastProductId === latestId) { if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified }); return { office: off, updated: false, reason: 'No change' }; }

  // New issuance → fetch product
  const prodResp = await nwsJson(latestId);
  const text = prodResp.json?.productText || prodResp.json?.product?.text || prodResp.json?.product || '';

  const payload = { office: off, issued, productId: latestId, originalText: text, updatedAt: new Date().toISOString() };
  await setCached(off, payload);
  await setMeta(off, { lastListModified: lastModified, lastProductId: latestId });
  return { office: off, updated: true };
}

export async function handler() {
  try {
    const offices = loadWFOs();
    if (!offices.length) return { statusCode: 400, body: 'No offices in netlify/wfos.json' };

    const results = [];
    for (const off of offices) {
      try { results.push(await refreshOne(off)); }
      catch (e) { results.push({ office: off, updated: false, error: e.message }); }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, results }) };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
}