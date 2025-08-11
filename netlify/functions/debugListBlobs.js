// netlify/functions/debugBlobs.js
exports.handler = async () => {
  try {
    const siteID = !!(process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID);
    const token  = !!process.env.BLOBS_TOKEN;

    let blobsOK = false, count = null, mode = 'FS fallback';
    if (siteID && token) {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore(process.env.BLOBS_STORE || 'ryff-cache', {
        siteID: process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID,
        token: process.env.BLOBS_TOKEN,
      });
      const { blobs } = await store.list({ prefix: 'AFD:' });
      blobsOK = true; count = (blobs || []).length; mode = 'Blobs OK';
    }
    return { statusCode: 200, body: JSON.stringify({ siteID, token, blobsOK, count, mode }) };
  } catch (e) {
    return { statusCode: 500, body: `debug error: ${e.message}` };
  }
};
