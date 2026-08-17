const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

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
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost')) {
    throw new Error('That host is not allowed');
  }
  if (isPrivateHostname(host)) {
    throw new Error('Private network hosts are not allowed');
  }
  return url;
}

function isPrivateHostname(host: string): boolean {
  if (host === '169.254.169.254') return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function newWebhookSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `wh_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
