// netlify/functions/refreshAFD.js
// Scheduler-only function: checks for new AFDs and updates cache
// CommonJS version (works with Netlify wrapper)

const fs = require('fs');
const path = require('path');
const { setCached, getMeta, setMeta } = require('../../lib/cache.cjs');

const NWS_UA = process.env.NWS_USER_AGENT || 'RYFF/1.0 (contact: your@email)';

function resolveProjectPath(...parts) {
  const base = process.env.LAMBDA_TASK_ROOT || process.cwd();
  return path.join(base, ...parts);
}

function loadWFOs() {
  const fromEnv = (process.env.OFFICES || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const jsonPath = resolveProjectPath('netlify', 'wfos.json');
  try {
    if (fs.existsSync(jsonPath)) {
      const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const fromFile = (Array.isArray(arr) ? arr : []).map(s => String(s).toUpperCase());
      return fromFile.length ? fromFile : fromEnv;
    }
  } catch { /* ignore */ }
  return fromEnv;
}

async function nwsJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': NWS_UA, ...extraHeaders } });
  // /latest may not honor If-Modified-Since; handle normally if it doesn't.
  if (res.status === 304) {
    return { notModified: true, headers: Object.fromEntries(res.headers.entries()) };
  }
  if (!res.ok) {
    throw new Error(`NWS ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const headers = Object.fromEntries(res.headers.entries());
  const json = await res.json();
  return { json, headers };
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return undefined;
}

async function refreshOne(office) {
  const off = office.toUpperCase();
  const meta = await getMeta(off); // { lastListModified, lastProductId }

  const latestUrl = `https://api.weather.gov/products/types/AFD/locations/${encodeURIComponent(off)}/latest`;
  const condHeaders = meta.lastListModified ? { 'If-Modified-Since': meta.lastListModified } : {};

  const latestResp = await nwsJson(latestUrl, condHeaders);
  if (latestResp.notModified) {
    return { office: off, updated: false, reason: 'Not modified' };
  }

  const h = latestResp.headers || {};
  const lastModified = h['last-modified'] || h['Last-Modified'] || null;

  const data = latestResp.json || {};
  // NWS sometimes uses id or @id; issuanceTime can be top-level or in properties
  const latestId = pick(data, 'id', '@id');
  const props = data.properties || {};
  const issued = pick(data, 'issuanceTime', 'issued') || pick(props, 'issuanceTime', 'issued');
  const productText = pick(data, 'productText') || pick(props, 'productText');

  if (!productText) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No AFD' };
  }

  if (meta.lastProductId && latestId && meta.lastProductId === latestId) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No change' };
  }

  await setCached(off, {
    office: off,
    issued: issued || null,
    productId: latestId || null,
    originalText: productText,
    updatedAt: new Date().toISOString(),
  });
  await setMeta(off, { lastListModified: lastModified, lastProductId: latestId || meta.lastProductId || null });

  return { office: off, updated: true };
}

exports.handler = async () => {
  try {
    const offices = loadWFOs();
    if (!offices.length) {
      return { statusCode: 400, body: 'No offices configured (netlify/wfos.json or OFFICES).' };
    }

    const results = [];
    for (const off of offices) {
      try {
        results.push(await refreshOne(off));
      } catch (e) {
        results.push({ office: off, updated: false, error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, results }),
    };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
