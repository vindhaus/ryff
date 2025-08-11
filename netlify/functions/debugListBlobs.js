exports.handler = async () => {
  try {
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token  = process.env.BLOBS_TOKEN   || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
    const name   = process.env.BLOBS_STORE || 'ryff-cache';

    // If creds are missing, don’t call getStore. Report status instead.
    if (!siteID || !token) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok:false, reason:'missing_creds', siteID: !!siteID, token: !!token, store:name })
      };
    }

    const { getStore } = await import('@netlify/blobs');
    const store = getStore(name, { siteID, token });
    const { blobs } = await store.list({ prefix: 'AFD:' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:true, store:name, count: blobs?.length || 0, keys: (blobs||[]).map(b => b.key) })
    };
  } catch (e) {
    return { statusCode: 500, body: 'Error: ' + e.name + ' ' + e.message };
  }
};
