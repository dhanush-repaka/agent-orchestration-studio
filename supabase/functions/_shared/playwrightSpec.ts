export const DEFAULT_PLAYWRIGHT_BASE_URL = 'https://parabank.parasoft.com/parabank';

export type ParabankKind =
  | 'success'
  | 'duplicate'
  | 'mismatch'
  | 'required-first'
  | 'required-user'
  | 'required-pass'
  | 'form-visible'
  | 'confirmation'
  | 'home-to-register';

export const PARABANK_KIND_ORDER: ParabankKind[] = [
  'success',
  'duplicate',
  'required-first',
  'mismatch',
  'form-visible',
  'confirmation',
  'required-user',
  'required-pass',
  'home-to-register',
];

export const PARABANK_REGISTRATION_TEST_CASES = [
  { id: 'TC-001', title: 'Successful user registration', description: 'Register with valid unique details.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'critical', type: 'functional', expectedOutcome: 'Account is created and a confirmation is shown' },
  { id: 'TC-002', title: 'Duplicate username is rejected', description: 'Register twice with the same username.', preconditions: ['A customer already exists'], requirementId: '21', priority: 'high', type: 'negative', expectedOutcome: 'Duplicate username is rejected' },
  { id: 'TC-003', title: 'Missing first name is rejected', description: 'Submit the form without a first name.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'high', type: 'negative', expectedOutcome: 'First name is required' },
  { id: 'TC-004', title: 'Password mismatch is rejected', description: 'Password and confirmation do not match.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'high', type: 'negative', expectedOutcome: 'Password mismatch is shown' },
  { id: 'TC-005', title: 'Registration form is displayed', description: 'The register page shows the customer form.', preconditions: ['Parabank is reachable'], requirementId: '21', priority: 'medium', type: 'functional', expectedOutcome: 'Form fields and Register button are visible' },
  { id: 'TC-006', title: 'Confirmation is shown after success', description: 'A confirmation appears after a valid registration.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'critical', type: 'functional', expectedOutcome: 'Welcome or account created text is shown' },
  { id: 'TC-007', title: 'Missing username is rejected', description: 'Submit the form without a username.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'high', type: 'negative', expectedOutcome: 'Username is required' },
  { id: 'TC-008', title: 'Missing password confirmation is rejected', description: 'Submit the form without confirming the password.', preconditions: ['Registration page is accessible'], requirementId: '21', priority: 'high', type: 'negative', expectedOutcome: 'Password confirmation is required' },
  { id: 'TC-009', title: 'Register page is reachable from home', description: 'Open home and follow the Register link.', preconditions: ['Parabank home is reachable'], requirementId: '21', priority: 'medium', type: 'functional', expectedOutcome: 'Registration form is shown' },
] as const;

const FILL_VALID = `    await page.locator('[name="customer.firstName"]').fill("Ada");
    await page.locator('[name="customer.lastName"]').fill("Lovelace");
    await page.locator('[name="customer.address.street"]').fill("1 Algorithm Way");
    await page.locator('[name="customer.address.city"]').fill("London");
    await page.locator('[name="customer.address.state"]').fill("UK");
    await page.locator('[name="customer.address.zipCode"]').fill("E11AA");
    await page.locator('[name="customer.phoneNumber"]').fill("5550100");
    await page.locator('[name="customer.ssn"]').fill("123-45-6789");`;

function uniqueUserExpr(): string {
  return '`u${Math.random().toString(36).slice(2, 9)}`';
}

function testBody(kind: ParabankKind): string {
  switch (kind) {
    case 'success':
    case 'confirmation':
      return `    const username = ${uniqueUserExpr()};
    await page.goto("register.htm");
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/success|welcome|created/i);`;
    case 'duplicate':
      return `    const username = ${uniqueUserExpr()};
    await page.goto("register.htm");
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/success|welcome|created/i);
    await page.goto("register.htm");
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/already exists|exists/i);`;
    case 'mismatch':
      return `    const username = ${uniqueUserExpr()};
    await page.goto("register.htm");
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("OtherPass1");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/did not match|password/i);`;
    case 'required-first':
      return `    const username = ${uniqueUserExpr()};
    await page.goto("register.htm");
    await expect(page.locator('[name="customer.lastName"]')).toBeVisible();
    await page.locator('[name="customer.firstName"]').fill("");
    await page.locator('[name="customer.lastName"]').fill("Lovelace");
    await page.locator('[name="customer.address.street"]').fill("1 Algorithm Way");
    await page.locator('[name="customer.address.city"]').fill("London");
    await page.locator('[name="customer.address.state"]').fill("UK");
    await page.locator('[name="customer.address.zipCode"]').fill("E11AA");
    await page.locator('[name="customer.ssn"]').fill("123-45-6789");
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/first name is required/i);`;
    case 'required-user':
      return `    await page.goto("register.htm");
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill("");
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("Passw0rd!");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/username is required/i);`;
    case 'required-pass':
      return `    const username = ${uniqueUserExpr()};
    await page.goto("register.htm");
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
${FILL_VALID}
    await page.locator('[name="customer.username"]').fill(username);
    await page.locator('[name="customer.password"]').fill("Passw0rd!");
    await page.locator('[name="repeatedPassword"]').fill("");
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.locator("#rightPanel")).toContainText(/password confirmation is required/i);`;
    case 'form-visible':
      return `    await page.goto("register.htm");
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('[name="customer.firstName"]')).toBeVisible();
    await expect(page.locator('[name="customer.username"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Register" })).toBeVisible();`;
    case 'home-to-register':
      return `    await page.goto("");
    await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
    await page.getByRole("link", { name: "Register" }).click();
    await expect(page.locator('[name="customer.username"]')).toBeVisible();`;
  }
}

export function classifyParabankCase(title: string, extras = ''): ParabankKind | null {
  const blob = `${title}\n${extras}`.toLowerCase();
  if (/duplicate|already exists|existing user/.test(blob)) return 'duplicate';
  if (/mismatch|did not match|confirm(ation)? password|passwords? do not/.test(blob)) return 'mismatch';
  if (/first name/.test(blob) && /missing|required|empty|blank/.test(blob)) return 'required-first';
  if (/user ?name/.test(blob) && /missing|required|empty|blank/.test(blob)) return 'required-user';
  if (/password/.test(blob) && /missing|required|empty|blank/.test(blob)) return 'required-pass';
  if (/from home|register link|navigat|reachable/.test(blob)) return 'home-to-register';
  if (/form (is )?(displayed|visible|shown)|fields? (are )?visible|signing up/.test(blob)) return 'form-visible';
  if (/confirmation|welcome|account (was )?created/.test(blob)) return 'confirmation';
  if (/success|valid details|happy path|can register|registers? a/.test(blob)) return 'success';
  return null;
}

export function extractTestCasesFromContext(context: unknown): Array<{ title: string; id?: string; type?: string; description?: string; expectedOutcome?: string }> {
  const found: Array<{ title: string; id?: string; type?: string; description?: string; expectedOutcome?: string }> = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === 'object' && value[0] && 'title' in (value[0] as object)) {
        const sample = value[0] as Record<string, unknown>;
        const looksLikeCase = 'expectedOutcome' in sample || 'priority' in sample || 'preconditions' in sample || 'type' in sample;
        if (!looksLikeCase) {
          for (const item of value) visit(item, depth + 1);
          return;
        }
        for (const item of value) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as { title?: unknown; id?: unknown; type?: unknown; description?: unknown; expectedOutcome?: unknown };
          const title = String(rec.title ?? '').trim();
          if (!title || seen.has(title)) continue;
          seen.add(title);
          found.push({
            title,
            id: rec.id != null ? String(rec.id) : undefined,
            type: rec.type != null ? String(rec.type) : undefined,
            description: rec.description != null ? String(rec.description) : undefined,
            expectedOutcome: rec.expectedOutcome != null ? String(rec.expectedOutcome) : undefined,
          });
        }
        return;
      }
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const inner of Object.values(value as Record<string, unknown>)) visit(inner, depth + 1);
    }
  };
  visit(context);
  return found;
}

export function buildParabankSuiteFromCases(
  cases: Array<{ title?: string; id?: string; type?: string; description?: string }>,
): string {
  const used = new Set<ParabankKind>();
  const tests = (cases.length ? cases : PARABANK_REGISTRATION_TEST_CASES).map((tc, index) => {
    const title = String(tc.title ?? `TC-${String(index + 1).padStart(3, '0')}`);
    let kind = classifyParabankCase(title, `${tc.type ?? ''} ${tc.description ?? ''}`);
    if (!kind || used.has(kind)) {
      kind = PARABANK_KIND_ORDER.find((candidate) => !used.has(candidate)) ?? 'success';
    }
    used.add(kind);
    return `  test(${JSON.stringify(title)}, async ({ page }) => {\n${testBody(kind)}\n  });`;
  });
  return `import { test, expect } from "@playwright/test";

test.describe("Parabank registration", () => {
${tests.join('\n\n')}
});
`;
}

export const PARABANK_REGISTRATION_SPEC = buildParabankSuiteFromCases([...PARABANK_REGISTRATION_TEST_CASES]);

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

export function countPlaywrightTests(spec: string): number {
  return [...spec.matchAll(/\btest\s*\(\s*(?!describe\b)/g)].length;
}

export function extractPlaywrightTests(spec: string): Array<{ title: string; body: string }> {
  const tests: Array<{ title: string; body: string }> = [];
  const re = /\btest\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(spec))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < spec.length && depth > 0) {
      if (spec[i] === '{') depth += 1;
      else if (spec[i] === '}') depth -= 1;
      i += 1;
    }
    tests.push({
      title: match[2].replace(/\\(['"`])/g, '$1'),
      body: spec.slice(match.index + match[0].length, i - 1).trim(),
    });
  }
  return tests;
}

function specCoversCases(spec: string, cases: Array<{ title: string }>): boolean {
  if (!spec.trim() || countPlaywrightTests(spec) !== cases.length) return false;
  const titles = extractPlaywrightTests(spec).map((test) => test.title.trim().toLowerCase());
  return cases.every((tc) => titles.includes(tc.title.trim().toLowerCase()));
}

function indentTestBody(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed.trim()) return '';
      return trimmed.startsWith('    ') ? trimmed : `    ${trimmed.trim()}`;
    })
    .join('\n');
}

function genericCaseBody(tc: { description?: string; expectedOutcome?: string }): string {
  const expected = String(tc.expectedOutcome ?? '').trim();
  const lines = ['    await page.goto("");', '    await expect(page.locator("body")).toBeVisible();'];
  if (expected) {
    lines.push(`    await expect(page.locator("body")).toContainText(${JSON.stringify(expected)});`);
  }
  return lines.join('\n');
}

export function buildSuiteFromGeneratedCases(
  spec: string,
  cases: Array<{ title?: string; type?: string; description?: string; expectedOutcome?: string }>,
): string {
  const fromSpec = extractPlaywrightTests(spec);
  const tests = cases.map((tc, index) => {
    const title = String(tc.title ?? `TC-${String(index + 1).padStart(3, '0')}`);
    const matched = fromSpec.find((item) => item.title.trim().toLowerCase() === title.trim().toLowerCase());
    let body = matched?.body;
    if (!body) {
      const kind = classifyParabankCase(title, `${tc.type ?? ''} ${tc.description ?? ''}`);
      body = kind ? testBody(kind) : genericCaseBody(tc);
    }
    return `  test(${JSON.stringify(title)}, async ({ page }) => {\n${indentTestBody(body)}\n  });`;
  });
  return `import { test, expect } from "@playwright/test";

test.describe("generated cases", () => {
${tests.join('\n\n')}
});
`;
}

export function alignSpecToTestCases(spec: string, context: unknown = {}): string {
  const cases = extractTestCasesFromContext(context);
  if (!cases.length) return spec;
  if (specCoversCases(spec, cases)) return spec;
  return buildSuiteFromGeneratedCases(spec, cases);
}

export function buildQeMarkdownReport(execute: Record<string, unknown>): string {
  const results = Array.isArray(execute.results)
    ? execute.results as { title?: string; status?: string; error?: string }[]
    : [];
  const total = Number(execute.total ?? results.length);
  const failed = Number(execute.failed ?? results.filter((row) => row.status && row.status !== 'passed' && row.status !== 'skipped').length);
  const source = String(execute.source ?? 'unknown');
  const error = execute.error != null ? String(execute.error) : '';
  const lines = [
    '# QE report',
    '',
    `- Playwright source: ${source}`,
    `- Total tests: ${total}`,
    `- Passed: ${execute.passed === true ? 'yes' : 'no'}`,
    `- Failed: ${failed}`,
  ];
  if (error || source === 'unavailable') {
    lines.push(`- Error: ${error || 'Playwright runner did not execute these tests.'}`);
  }
  lines.push('', '## Results');
  if (!results.length) {
    lines.push(source === 'unavailable' ? '- No tests ran.' : '- No test rows.');
  } else {
    for (const row of results) {
      const status = String(row.status ?? 'unknown').toUpperCase();
      lines.push(`- ${status} ${row.title ?? 'test'}${row.error ? ` — ${row.error}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
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

export function buildPlaywrightHtmlReport(result: Record<string, unknown> | null | undefined): string {
  const rec = result ?? {};
  const rows = Array.isArray(rec.results) ? rec.results as { title?: string; status?: string; error?: string }[] : [];
  const rowHtml = rows.map((row) => {
    const status = String(row.status ?? 'unknown');
    const color = status === 'passed' ? '#15803d' : status === 'skipped' ? '#a16207' : '#b91c1c';
    return `<tr><td>${escapeHtml(String(row.title ?? 'test'))}</td><td style="color:${color};font-weight:600">${escapeHtml(status)}</td><td>${escapeHtml(row.error ?? '')}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Playwright report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #0f172a; }
    .ok { color: #15803d; } .bad { color: #b91c1c; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; }
    pre { background: #0f172a; color: #e2e8f0; padding: 12px; overflow: auto; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Playwright execution report</h1>
  <p>Result: <strong class="${rec.passed === true ? 'ok' : 'bad'}">${rec.passed === true ? 'passed' : 'failed'}</strong>
     · ${Number(rec.total ?? rows.length)} tests
     · ${Number(rec.failed ?? 0)} failed
     · source ${escapeHtml(String(rec.source ?? 'playwright'))}</p>
  <p>Base URL: ${escapeHtml(String(rec.baseUrl ?? ''))}</p>
  <table>
    <thead><tr><th>Test</th><th>Status</th><th>Error</th></tr></thead>
    <tbody>${rowHtml || '<tr><td colspan="3">No test rows</td></tr>'}</tbody>
  </table>
  ${rec.stdout ? `<h2>Runner output</h2><pre>${escapeHtml(String(rec.stdout).slice(-4000))}</pre>` : ''}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
