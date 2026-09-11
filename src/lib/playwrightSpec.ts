export const DEFAULT_PLAYWRIGHT_BASE_URL = 'https://parabank.parasoft.com/parabank';

export const PARABANK_REGISTRATION_SPEC = `import { test, expect } from "@playwright/test";

test.describe("Parabank registration", () => {
  test("registers a new customer", async ({ page }) => {
    const username = \`qe_\${Date.now()}\`;
    await page.goto("register.htm");
    await page.locator('[name="customer.firstName"]').fill("Ada");
    await page.locator('[name="customer.lastName"]').fill("Lovelace");
    await page.locator('[name="customer.address.street"]').fill("1 Algorithm Way");
    await page.locator('[name="customer.address.city"]').fill("London");
    await page.locator('[name="customer.address.state"]').fill("UK");
    await page.locator('[name="customer.address.zipCode"]').fill("E11AA");
    await page.locator('[name="customer.phoneNumber"]').fill("5550100");
    await page.locator('[name="customer.ssn"]').fill("123-45-6789");
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/success|welcome|created/i);
  });
});
`;

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

export type PlaywrightSpecResult = {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  error?: string;
};

export function flattenPlaywrightJsonReport(report: unknown): {
  passed: boolean;
  total: number;
  failed: number;
  skipped: number;
  results: PlaywrightSpecResult[];
} {
  const results: PlaywrightSpecResult[] = [];

  const walk = (suite: unknown) => {
    if (!suite || typeof suite !== 'object') return;
    const rec = suite as Record<string, unknown>;
    for (const child of (Array.isArray(rec.suites) ? rec.suites : [])) walk(child);
    for (const spec of (Array.isArray(rec.specs) ? rec.specs : [])) {
      if (!spec || typeof spec !== 'object') continue;
      const specRec = spec as Record<string, unknown>;
      const tests = Array.isArray(specRec.tests) ? specRec.tests : [];
      const last = tests[tests.length - 1] as Record<string, unknown> | undefined;
      const lastResults = Array.isArray(last?.results) ? last.results as Record<string, unknown>[] : [];
      const lastResult = lastResults[lastResults.length - 1];
      const statusRaw = String(lastResult?.status ?? (specRec.ok === false ? 'failed' : 'passed'));
      const status: PlaywrightSpecResult['status'] =
        statusRaw === 'skipped' || statusRaw === 'timedOut' || statusRaw === 'failed' ? statusRaw : 'passed';
      const error = lastResult?.error && typeof lastResult.error === 'object'
        ? String((lastResult.error as { message?: string }).message ?? '')
        : undefined;
      results.push({
        title: String(specRec.title ?? 'generated test'),
        status,
        ...(error ? { error } : {}),
      });
    }
  };

  if (report && typeof report === 'object') {
    const root = report as Record<string, unknown>;
    for (const suite of (Array.isArray(root.suites) ? root.suites : [])) walk(suite);
  }

  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return {
    passed: results.length > 0 && failed === 0,
    total: results.length,
    failed,
    skipped,
    results,
  };
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
