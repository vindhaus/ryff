// Lists cached offices for the dropdown.
import { listCachedOffices } from '../../lib/cache.js';

exports.handler = async (event, context) => {
  try {
    const offices = await listCachedOffices();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offices }) };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
}
