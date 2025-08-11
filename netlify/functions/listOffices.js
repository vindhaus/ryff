// netlify/functions/listOffices.js
const { listCachedOffices } = require('../../lib/cache.cjs');

exports.handler = async () => {
  try {
    const offices = await listCachedOffices();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offices }),
    };
  } catch (e) {
    return { statusCode: 500, body: 'Error: ' + e.message };
  }
};
