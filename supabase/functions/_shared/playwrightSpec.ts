export const DEFAULT_PLAYWRIGHT_BASE_URL = 'https://parabank.parasoft.com/parabank';

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function stripCodeFences(value: string): string {
  return value
    .replace(/^```(?:typescript|ts|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function looksLikePlaywrightSpec(value: unknown): string | null {
  if (typeof value === 'string') {
    const stripped = stripCodeFences(value);
    if (
      /@playwright\/test/.test(stripped)
      || (/\btest\s*(?:\.describe)?\s*\(/.test(stripped) && /\bpage\./.test(stripped))
    ) {
      return stripped;
    }
    const parsed = tryParseJson(stripped);
    if (parsed != null) return looksLikePlaywrightSpec(parsed);
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  for (const key of ['spec', 'code', 'source', 'healed', 'file']) {
    const inner = looksLikePlaywrightSpec(rec[key]);
    if (inner) return inner;
  }
  return null;
}

export function extractPlaywrightSpec(previousRaw: string, upstream: Record<string, unknown> = {}): string {
  const fromPrevious = looksLikePlaywrightSpec(previousRaw);
  if (fromPrevious) return fromPrevious;

  const preferred = Object.entries(upstream)
    .filter(([key]) => /playwright|codegen|heal|locator/i.test(key))
    .reverse();
  for (const [, value] of preferred) {
    const found = looksLikePlaywrightSpec(value);
    if (found) return found;
  }
  for (const value of Object.values(upstream)) {
    const found = looksLikePlaywrightSpec(value);
    if (found) return found;
  }
  return '';
}

export function extractLocators(source: string): string[] {
  const found = new Set<string>();
  const re = /(?:getByRole|getByLabel|getByText|getByPlaceholder|getByTestId|getByTitle|locator)\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    found.add(match[0]);
    if (found.size >= 40) break;
  }
  return [...found];
}

export function resolveAppUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), base).href;
}

export function rewriteSpecUrls(spec: string, baseUrl: string): string {
  return spec.replace(/page\.goto\(\s*(['"`])([^'"`]+)\1/g, (_match, quote: string, url: string) => (
    `page.goto(${quote}${resolveAppUrl(url, baseUrl)}${quote}`
  ));
}

export function resolvePlaywrightBaseUrl(
  cfg: { playwrightBaseUrl?: string } | undefined,
  workflowInput: unknown,
): string {
  const fromCfg = cfg?.playwrightBaseUrl?.trim();
  if (fromCfg) return fromCfg.replace(/\/$/, '');
  if (workflowInput && typeof workflowInput === 'object') {
    const rec = workflowInput as Record<string, unknown>;
    const fromInput = rec.baseUrl ?? rec.targetUrl ?? rec.url;
    if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim().replace(/\/$/, '');
  }
  return DEFAULT_PLAYWRIGHT_BASE_URL;
}

export function isPlaywrightExecuteResult(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.passed !== 'boolean') return false;
  return rec.source === 'playwright'
    || rec.source === 'playwright-mcp'
    || rec.source === 'unavailable'
    || Array.isArray(rec.results);
}

export function findLatestPlaywrightExecute(nodeOutputs: Record<string, string>): Record<string, unknown> | null {
  const entries = Object.entries(nodeOutputs);
  for (let i = entries.length - 1; i >= 0; i--) {
    const raw = entries[i][1];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isPlaywrightExecuteResult(parsed)) return parsed;
    } catch {
      // keep scanning
    }
  }
  return null;
}

export function playwrightUnavailableResult(error: string): Record<string, unknown> {
  return {
    passed: false,
    total: 0,
    failed: 0,
    results: [],
    source: 'unavailable',
    error,
  };
}
