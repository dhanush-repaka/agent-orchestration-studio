import type { Handler } from '@netlify/functions';
import { discoverLocators } from '../../server/playwright-run';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST a locator request' }) };
  }
  try {
    const body = event.body ? JSON.parse(event.body) as Record<string, unknown> : {};
    const result = await discoverLocators(body);
    return {
      statusCode: result.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err instanceof Error ? err.message : 'Playwright locator discovery failed',
        source: 'unavailable',
        locators: [],
      }),
    };
  }
};
