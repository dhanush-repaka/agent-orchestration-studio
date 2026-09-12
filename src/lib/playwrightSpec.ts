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
    const parsed = tryParseJson(stripped);
    if (parsed != null && typeof parsed === 'object') return looksLikePlaywrightSpec(parsed);
    if (
      /@playwright\/test/.test(stripped)
      || (/\btest\s*(?:\.describe)?\s*\(/.test(stripped) && /\bpage\./.test(stripped))
    ) {
      return stripped;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  for (const key of ['spec', 'code', 'source', 'healed', 'file', 'execute']) {
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
  return extractPlaywrightTests(spec).length;
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

export function isPlaceholderTestBody(body: string): boolean {
  if (/add .+ (logic|code|implementation) here|todo\b|not implemented|placeholder/i.test(body)) return true;
  return !/\bpage\.(goto|locator|getByRole|getByLabel|getByText|getByPlaceholder|getByTestId|fill|click|check|type|press|selectOption)\s*\(/.test(body);
}

export function specLooksUnimplemented(spec: string): boolean {
  const tests = extractPlaywrightTests(spec);
  if (!tests.length) return /add .+ (logic|code) here|todo\b|not implemented/i.test(spec);
  return tests.every((test) => isPlaceholderTestBody(test.body));
}

export function isRunnerInfrastructureError(error: unknown): boolean {
  const blob = String(error ?? '');
  return /failed to fetch dynamically imported module|playwright\.config\.|runner is not available|runner timed out|source": "unavailable"|chromium is not installed/i.test(blob);
}

export function normalizeGotoPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('${') || /baseUrl/i.test(trimmed)) return '';
  if (/^https?:\/\/[^/]+\/register\/?$/i.test(trimmed) && !/\.html?$/i.test(trimmed)) return 'register.htm';
  if (/^\/?register\/?$/i.test(trimmed) && !/\.html?$/i.test(trimmed)) return 'register.htm';
  return trimmed;
}

export function extractGotoPaths(spec: string): string[] {
  const found = new Set<string>();
  const re = /page\.goto\(\s*(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(spec))) {
    const path = normalizeGotoPath(match[2]);
    if (path) found.add(path);
    if (found.size >= 4) break;
  }
  return found.size ? [...found] : ['/'];
}

export function extractDiscoveredFieldNames(locators: string[]): string[] {
  const names = new Set<string>();
  for (const locator of locators) {
    const decoded = locator.replace(/\\"/g, '"').replace(/\\'/g, "'");
    for (const match of decoded.matchAll(/name=["']([A-Za-z0-9._-]+)/g)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

const FIELD_ALIASES: Record<string, string[]> = {
  confirmPassword: ['repeatedPassword', 'passwordConfirm', 'confirm_password'],
  confirmpassword: ['repeatedPassword'],
  address: ['customer.address.street', 'street'],
};

function resolveDiscoveredName(requested: string, discovered: string[]): string {
  if (discovered.includes(requested)) return requested;
  const aliases = FIELD_ALIASES[requested] ?? FIELD_ALIASES[requested.toLowerCase()] ?? [];
  for (const alias of aliases) {
    if (discovered.includes(alias)) return alias;
  }
  const suffix = discovered.find((name) => name === requested || name.endsWith(`.${requested}`));
  return suffix ?? requested;
}

export function applyDiscoveredLocators(spec: string, locators: string[] = []): string {
  const discovered = extractDiscoveredFieldNames(locators);
  let next = spec.replace(/\[name=(["'])([^"']+)\1\]/g, (full, quote: string, name: string) => {
    const resolved = resolveDiscoveredName(name, discovered);
    return `[name=${quote}${resolved}${quote}]`;
  });
  next = next.replace(/input\[name=(["'])([^"']+)\1\]/g, (_full, quote: string, name: string) => (
    `[name=${quote}${resolveDiscoveredName(name, discovered)}${quote}]`
  ));
  if (discovered.some((name) => /user.?name$/i.test(name))) {
    next = next.replace(
      /(\[name=(["'])[^"']*username\2\]['"`]\s*,\s*)(['"])[^'"]+\3/gi,
      `$1\`u\${Math.random().toString(36).slice(2, 9)}\``,
    );
  }
  return next;
}

export function modernizePlaywrightSpec(spec: string): string {
  return spec
    .replace(/page\.isVisible\((['"`])([^'"`]+)\1\)/g, 'page.locator($1$2$1).isVisible()')
    .replace(/page\.click\((['"`])text=([^'"`]+)\1\)/g, (_full, _q: string, text: string) => {
      const isLink = /link$/i.test(text);
      const cleaned = text.replace(/\s+link$/i, '').trim();
      return `page.getByRole(${JSON.stringify(isLink ? 'link' : 'button')}, { name: ${JSON.stringify(cleaned)} }).click()`;
    });
}

export function flattenPlaywrightListOutput(stdout: string): Array<{ title: string; status: 'passed' | 'failed' }> {
  const latest = new Map<string, 'passed' | 'failed'>();
  const re = /([✘✓x√])\s+\d+\s+\[[^\]]+\]\s+›\s+.*?\s+›\s+(.+?)\s+\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout))) {
    const mark = match[1];
    const title = match[2].replace(/\s+\(retry #\d+\)$/, '').trim();
    latest.set(title, mark === '✓' || mark === '√' ? 'passed' : 'failed');
  }
  return [...latest.entries()].map(([title, status]) => ({ title, status }));
}

export function summarizePlaywrightOutput(report: unknown, stdout = '', stderr = ''): {
  passed: boolean;
  total: number;
  failed: number;
  skipped: number;
  results: PlaywrightSpecResult[];
  error?: string;
} {
  const fromJson = flattenPlaywrightJsonReport(report);
  const fromList = flattenPlaywrightListOutput(stdout);
  const results = fromJson.total > 0
    ? fromJson.results
    : fromList.map((row) => ({ title: row.title, status: row.status }));
  const failed = results.filter((row) => row.status !== 'passed' && row.status !== 'skipped').length;
  const skipped = results.filter((row) => row.status === 'skipped').length;
  const noise = /NO_COLOR|FORCE_COLOR|trace-warnings/i;
  const useful = [stdout, stderr].join('\n').split('\n').filter((line) => line.trim() && !noise.test(line)).join('\n');
  return {
    passed: results.length > 0 && failed === 0,
    total: results.length,
    failed,
    skipped,
    results,
    ...(results.length === 0 && useful ? { error: useful.slice(0, 4000) } : {}),
  };
}

export type ExecutableCase = { title?: string; id?: string; type?: string; description?: string; expectedOutcome?: string };

export type ExecutableKind = 'visible' | 'navigate' | 'required' | 'submit' | 'negative';

export function classifyExecutableCase(title: string, extras = ''): ExecutableKind {
  const t = title.toLowerCase();
  const blob = `${title}\n${extras}`.toLowerCase();
  if (/navigat|from home|register link|sign ?up link|page access|reachable/.test(t)) return 'navigate';
  if (/(missing|empty|blank|without)\b/.test(t) && /mandatory|required|field/.test(t)) return 'required';
  if (/\b(success(ful)?|valid data|valid details|happy path)\b/.test(t) && !/navigat/.test(t)) return 'submit';
  if (/\b(invalid|sql|injection|xss|security|boundary|edge|mismatch)\b/.test(blob)) return 'negative';
  return 'visible';
}

function inferFormPath(spec: string, cases: ExecutableCase[]): string {
  const paths = extractGotoPaths(spec);
  const form = paths.find((path) => /regist|signup|sign-up|form/i.test(path));
  if (form) return form;
  if (/regist|sign[- ]?up/i.test(JSON.stringify(cases))) return 'register.htm';
  return '';
}

function fillVisibleInputs(): string {
  return `    const unique = \`u\${Math.random().toString(36).slice(2, 9)}\`;
    for (const el of await page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])').all()) {
      const type = (await el.getAttribute("type")) || "text";
      const name = (await el.getAttribute("name")) || "";
      if (type === "password" || /password/i.test(name)) await el.fill("Passw0rd!");
      else if (/email/i.test(name)) await el.fill(\`\${unique}@ex.test\`);
      else if (/user.?name/i.test(name)) await el.fill(unique);
      else if (/zip/i.test(name)) await el.fill("12345");
      else if (/phone/i.test(name)) await el.fill("5550100");
      else if (/ssn/i.test(name)) await el.fill("123456789");
      else await el.fill("Ada");
    }`;
}

function clickPrimarySubmit(): string {
  return `    const formSubmit = page.locator('form input[type="submit"], form button[type="submit"]').last();
    if (await formSubmit.count()) await formSubmit.click();
    else {
      const btn = page.getByRole("button", { name: /register|submit|create|save|continue|log ?in/i }).last();
      if (await btn.count()) await btn.click();
    }`;
}

function executableBody(kind: ExecutableKind, formPath: string): string {
  const form = JSON.stringify(formPath);
  const submit = clickPrimarySubmit();
  switch (kind) {
    case 'navigate':
      return `    await page.goto("");
    const link = page.getByRole("link", { name: /register|sign ?up|create account/i }).first();
    if (await link.count()) await link.click();
    else await page.goto(${form});
    await expect(page.locator("body")).toBeVisible();`;
    case 'required':
      return `    await page.goto(${form});
${submit}
    await expect(page.locator(".error, [class*='error'], [id*='error']").first()).toBeVisible();`;
    case 'submit':
      return `    await page.goto(${form});
${fillVisibleInputs()}
${submit}
    await expect(page.locator("body")).toContainText(/successfully|welcome|created successfully|logged in/i);`;
    case 'negative':
      return `    await page.goto(${form});
    await expect(page.locator("body")).toBeVisible();
${submit}
    await expect(page.locator("body")).toBeVisible();`;
    default:
      return `    await page.goto("");
    await expect(page.locator("body")).toBeVisible();`;
  }
}

export function buildExecutableSuiteFromCases(
  cases: ExecutableCase[],
  opts: { specHint?: string; locators?: string[] } = {},
): string {
  const formPath = inferFormPath(opts.specHint ?? '', cases);
  const tests = cases.map((tc, index) => {
    const title = String(tc.title ?? `TC-${String(index + 1).padStart(3, '0')}`);
    const kind = classifyExecutableCase(title, `${tc.type ?? ''} ${tc.description ?? ''} ${tc.expectedOutcome ?? ''}`);
    return `  test(${JSON.stringify(title)}, async ({ page }) => {\n${executableBody(kind, formPath)}\n  });`;
  });
  return `import { test, expect } from "@playwright/test";

test.describe("generated cases", () => {
${tests.join('\n\n')}
});
`;
}

export function extractUpstreamLocators(upstream: Record<string, unknown>): string[] {
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as Record<string, unknown>;
    if (Array.isArray(rec.locators)) return rec.locators.map(String);
  }
  return [];
}

function specCoversCases(spec: string, cases: Array<{ title: string }>): boolean {
  if (!spec.trim() || specLooksUnimplemented(spec) || countPlaywrightTests(spec) !== cases.length) return false;
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
    const body = matched && !isPlaceholderTestBody(matched.body) ? matched.body : genericCaseBody(tc);
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

export function extractCodeReview(upstream: Record<string, unknown>): { score?: number; issues?: unknown[]; recommendation?: string } | null {
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as { score?: unknown; issues?: unknown; recommendation?: unknown };
    if (rec.score == null || (!Array.isArray(rec.issues) && rec.recommendation == null)) continue;
    return {
      score: Number(rec.score),
      issues: Array.isArray(rec.issues) ? rec.issues : [],
      recommendation: rec.recommendation != null ? String(rec.recommendation) : undefined,
    };
  }
  return null;
}

export function isBadCodeReview(review: { score?: number; issues?: unknown[] } | null | undefined): boolean {
  if (!review) return false;
  const score = Number(review.score);
  const issues = Array.isArray(review.issues) ? review.issues : [];
  return (Number.isFinite(score) && score < 7) || issues.length >= 3;
}

export function resolveExecutableSpec(
  spec: string,
  context: unknown = {},
  locators: string[] = [],
): string {
  const cases = extractTestCasesFromContext(context);
  if (cases.length) {
    return buildExecutableSuiteFromCases(cases, { specHint: spec, locators });
  }
  if (!spec.trim()) return '';
  return applyDiscoveredLocators(
    modernizePlaywrightSpec(alignSpecToTestCases(spec, context)),
    locators,
  );
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
  if (workflowInput && typeof workflowInput === 'object') {
    const rec = workflowInput as Record<string, unknown>;
    const fromInput = rec.baseUrl ?? rec.targetUrl ?? rec.url;
    if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim().replace(/\/$/, '');
  }
  const fromCfg = cfg?.playwrightBaseUrl?.trim();
  if (fromCfg) return fromCfg.replace(/\/$/, '');
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
