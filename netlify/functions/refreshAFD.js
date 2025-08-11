// netlify/functions/refreshAFD.js
// Scheduler-only function: checks for new AFDs and updates cache (with backfill)

const fs = require('fs');
const path = require('path');
const { setCached, getMeta, setMeta, getCached } = require('../../lib/cache.cjs');

const NWS_UA = process.env.NWS_USER_AGENT || 'RYFF/1.0 (https://readyourfuckingforecast.netlify.app; contact: you@example.com)';

function resolveProjectPath(...parts) {
  const base = process.env.LAMBDA_TASK_ROOT || process.cwd();
  return path.join(base, ...parts);
}

function loadWFOs() {
  const fromEnv = (process.env.OFFICES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const jsonPath = resolveProjectPath('netlify', 'wfos.json');
  try {
    if (fs.existsSync(jsonPath)) {
      const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const fromFile = (Array.isArray(arr) ? arr : []).map((s) => String(s).toUpperCase());
      return fromFile.length ? fromFile : fromEnv;
    }
  } catch {}
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

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return undefined;
}

async function refreshOne(office, force = false) {
  const off = office.toUpperCase();
  const meta = await getMeta(off); // { lastListModified, lastProductId }

  const latestUrl = `https://api.weather.gov/products/types/AFD/locations/${encodeURIComponent(off)}/latest`;
  const condHeaders = !force && meta.lastListModified ? { 'If-Modified-Since': meta.lastListModified } : {};

  const latestResp = await nwsJson(latestUrl, condHeaders);
  if (latestResp.notModified && !force) {
    // even if not modified, if cache is empty we still need to backfill
    const existing = await getCached(off);
    if (!existing) {
      // fetch without conditional to backfill
      return refreshOne(off, true);
    }
    return { office: off, updated: false, reason: 'Not modified' };
  }

  const h = latestResp.headers || {};
  const lastModified = h['last-modified'] || h['Last-Modified'] || null;

  const data = latestResp.json || {};
  const props = data.properties || {};
  const latestId = pick(data, 'id', '@id') || pick(props, 'id', '@id') || null;
  const issued = pick(data, 'issuanceTime', 'issued') || pick(props, 'issuanceTime', 'issued') || null;
  const productText = pick(data, 'productText') || pick(props, 'productText') || '';

  if (!productText) {
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No AFD' };
  }

  // If IDs match but we never cached, backfill the cache now.
  if (!force && meta.lastProductId && latestId && meta.lastProductId === latestId) {
    const existing = await getCached(off);
    if (!existing || !existing.originalText) {
      await setCached(off, {
        office: off,
        issued,
        productId: latestId,
        originalText: productText,
        updatedAt: new Date().toISOString(),
      });
      if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified, lastProductId: latestId });
      return { office: off, updated: true, reason: 'Backfilled cache' };
    }
    if (lastModified) await setMeta(off, { ...meta, lastListModified: lastModified });
    return { office: off, updated: false, reason: 'No change' };
  }

  // New or forced → write cache and meta
  await setCached(off, {
    office: off,
    issued,
    productId: latestId,
    originalText: productText,
    updatedAt: new Date().toISOString(),
  });
  await setMeta(off, { lastListModified: lastModified, lastProductId: latestId });

  return { office: off, updated: true };
}

exports.handler = async (event) => {
  try {
    const offices = loadWFOs();
    if (!offices.length) {
      return { statusCode: 400, body: 'No offices configured (netlify/wfos.json or OFFICES).' };
    }

    const force = event?.queryStringParameters?.force === '1';
    const only = (event?.queryStringParameters?.offices || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const targets = only.length ? only : offices;

    const results = [];
    for (const off of targets) {
      try {
        results.push(await refreshOne(off, force));
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
