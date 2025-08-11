// netlify/functions/refreshAFD.js
// Scheduler-only function: checks for new AFDs and updates cache
// CommonJS version (works with Netlify wrapper)

const fs = require('fs');
const path = require('path');
const { setCached, getMeta, setMeta } = require('../../lib/cache.cjs');

const NWS_UA = process.env.NWS_USER_AGENT || 'RYFF/1.0 (no-contact@invalid)';

// Resolve a file that you’ve marked in netlify.toml -> [functions] included_files
function resolveProjectPath(...parts) {
  // On Netlify (AWS Lambda) this is set; locally fallback to cwd
  const base = process.env.LAMBDA_TASK_ROOT || process.cwd();
  return path.join(base, ...parts);
}

// Try to load wfos.json (list of WFO offices). Fallback to env OFFICES if missing.
function loadWFOs() {
  const fromEnv = (process.env.OFFICES || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  // If you’ve added `included_files = ["netlify/wfos.json"]` in netlify.toml,
  // this path will work in production.
  const jsonPath = resolveProjectPath('netlify', 'wfos.json');

  try {
    if (fs.existsSync(jsonPath)) {
      const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const fromFile = (Array.isArray(arr) ? arr : []).map(s => String(s).toUpperCase());
      return fromFile.length ? fromFile : fromEnv;
    }
  } catch {
    // ignore, fall through to env
  }
  return fromEnv;
}

// Minimal fetch helper with conditional headers
async function nwsJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': NWS_UA, ...extraHeaders }
  });
  if (res.status === 304) {
    return { notModified: true, headers: Object.fromEntries(res.headers.entries()) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NWS ${res.status}: ${text}`);
  }
  const headers = Object.fromEntries(res.headers.entries());
  const json = await res.json();
  return { json, headers };
}

async function refreshOne(office) {
  const off = office.toUpperCase();
  const meta = await getMeta(off); // { lastListModified, lastProductId }

  const listUrl = `https://api.weather.gov/products/types/AFD/locations/${encodeURIComponent(off)}?limit=1`;
  const condHeaders = meta.lastListModified ? { 'If-Modified-Since': meta.lastListModified } : {};

  const listResp = await nwsJson(listUrl, condHeaders);
  if (listResp.notModified) {
    return { office: off, updated: false, reason: 'Not modified' };
  }

  const lastModified = listResp.headers['last-modified'] || null;
  const latest = listResp.json?.features?.[0];
  if (!latest) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No AFD' };
  }

  const latestId = latest.id;
  const issued =
    latest?.issuanceTime || latest?.issued || latest?.properties?.issuanceTime;

  if (meta.lastProductId && meta.lastProductId === latestId) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No change' };
  }

  // New issuance → fetch full product
  const prodResp = await nwsJson(latestId);
  const text =
    prodResp.json?.productText ||
    prodResp.json?.product?.text ||
    prodResp.json?.product ||
    '';

  const payload = {
    office: off,
    issued,
    productId: latestId,
    originalText: text,
    updatedAt: new Date().toISOString()
  };

  await setCached(off, payload);
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
