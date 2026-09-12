import type { Handler } from '@netlify/functions';

export const handler: Handler = async () => ({
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ok: true, service: 'aos-functions' }),
});
