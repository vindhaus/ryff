// Read-only. Renders cached AFD HTML. NEVER calls NWS.
const { getCached } = require('../../lib/cache.cjs');

function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function renderHtml(p) {
  const issuedTxt = p.issued ? new Date(p.issued).toLocaleString() : '(unknown)';
  const updatedTxt = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '(unknown)';
  return `
<div class="card">
  <h3 style="margin-top:0;">Forecast Discussion (Original)</h3>
  <div class="muted">
    Office: <b>${p.office}</b><br/>
    Issued: ${issuedTxt}<br/>
    Cached/Updated: ${updatedTxt}<br/>
    <small class="muted">Product: ${p.productId}</small>
  </div>
  <pre>${escapeHtml(p.originalText || '')}</pre>
</div>`;
}

exports.handler = async (event, context) => {
  try {
    const office = String(event.queryStringParameters?.office || '').toUpperCase();
    if (!office) return { statusCode: 400, body: 'office query param is required' };
    const payload = await getCached(office);
    if (!payload) return { statusCode: 404, body: 'No cached AFD for this office yet.' };
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHtml(payload) };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
}
