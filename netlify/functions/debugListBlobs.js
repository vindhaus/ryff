exports.handler = async () => {
  try {
    const { getStore } = await import('@netlify/blobs');
    const name = process.env.BLOBS_STORE || 'ryff-cache';
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.BLOBS_TOKEN   || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;

    // Always pass creds if present
    const store = (siteID && token) ? getStore(name, { siteID, token }) : getStore(name);
    const { blobs } = await store.list({ prefix:'AFD:' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store:name, siteID: !!siteID, token: !!token, count: blobs?.length || 0, keys: (blobs||[]).map(b=>b.key) })
    };
  } catch (e) {
    return { statusCode: 500, body: 'Error: ' + e.name + ' ' + e.message };
  }
};
