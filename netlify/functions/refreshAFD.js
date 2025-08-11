// netlify/functions/refreshAFD.js
// Scheduler-only function: checks for new AFDs and updates cache
// CommonJS version (works with Netlify wrapper)

const fs = require('fs');
const path = require('path');
const { setCached, getMeta, setMeta } = require('../../lib/cache.cjs');

const NWS_UA = process.env.NWS_USER_AGENT || 'RYFF/1.0 (no-contact@invalid)';

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
  } catch {
    // ignore
  }
  return fromEnv;
}

async function nwsJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': NWS_UA, ...extraHeaders } });
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

async function refreshOne(office) {
  const off = office.toUpperCase();
  const meta = await getMeta(off);
  const latestUrl = `https://api.weather.gov/products/types/AFD/locations/${encodeURIComponent(off)}/latest`;
  const condHeaders = meta.lastListModified ? { 'If-Modified-Since': meta.lastListModified } : {};

  const latestResp = await nwsJson(latestUrl, condHeaders);
  if (latestResp.notModified) {
    return { office: off, updated: false, reason: 'Not modified' };
  }

  const lastModified = latestResp.headers['last-modified'] || null;
  const latest = latestResp.json?.properties || {};
  if (!latest.productText) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No AFD' };
  }

  const latestId = latestResp.json.id;
  const issued = latest.issuanceTime || latest.issued;

  if (meta.lastProductId && meta.lastProductId === latestId) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No change' };
  }

  const text = latest.productText;

  await setCached(off, {
    office: off,
    issued,
    productId: latestId,
    originalText: text,
    updatedAt: new Date().toISOString()
  });
  await setMeta(off, { lastListModified: lastModified, lastProductId: latestId });

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
      body: JSON.stringify({ ok: true, results })
    };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
