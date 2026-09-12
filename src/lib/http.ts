import { isBlockedHostname } from '@/lib/ssrf';

export const HTTP_NODE_TYPES = new Set(['http-request', 'api-request', 'rest-api']);

export function isHttpNodeType(nodeType: string): boolean {
  return HTTP_NODE_TYPES.has(nodeType);
}

export function assertPublicHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('URL is required');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error('Private network hosts are not allowed');
  }
  return url;
}

export function newWebhookSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `wh_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
