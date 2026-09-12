import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  PARABANK_REGISTRATION_TEST_CASES,
  alignSpecToTestCases,
  buildExecutableSuiteFromCases,
  buildParabankSuiteFromCases,
  classifyExecutableCase,
  buildPlaywrightHtmlReport,
  buildQeMarkdownReport,
  countPlaywrightTests,
  applyDiscoveredLocators,
  extractGotoPaths,
  isBadCodeReview,
  extractPlaywrightSpec,
  flattenPlaywrightListOutput,
  modernizePlaywrightSpec,
  specLooksUnimplemented,
  findLatestPlaywrightExecute,
  flattenPlaywrightJsonReport,
  looksLikePlaywrightSpec,
  resolveAppUrl,
  resolvePlaywrightBaseUrl,
  rewriteSpecUrls,
} from '@/lib/playwrightSpec';

const spec = `import { test } from "@playwright/test";
test("register", async ({ page }) => { await page.goto("/register.htm"); });`;

describe('playwrightSpec', () => {
  it('detects TypeScript specs and JSON wrappers', () => {
    expect(looksLikePlaywrightSpec(spec)).toContain('@playwright/test');
    expect(looksLikePlaywrightSpec({ spec })).toContain('register');
    expect(looksLikePlaywrightSpec('```ts\n' + spec + '\n```')).toContain('page.goto');
    expect(looksLikePlaywrightSpec({ score: 8, issues: [] })).toBeNull();
  });

  it('prefers previous output then Playwright-labeled upstream', () => {
    expect(extractPlaywrightSpec(JSON.stringify({ score: 8 }), {
      'Code Review': { score: 8 },
      'Playwright Automation': spec,
    })).toContain('register');
    expect(extractPlaywrightSpec(JSON.stringify({ locators: ['page.locator("body")'], spec }), {})).toContain('register');
  });

  it('builds one Playwright test per generated case and keeps those titles', () => {
    const generated = `import { test } from "@playwright/test";
test("Successful User Login", async ({ page }) => {
  await page.goto("https://example.test/login");
  await page.fill('input[name="username"]', 'validUser');
});`;
    const cases = [
      { id: 'TC-001', title: 'Successful User Login', type: 'functional', expectedOutcome: 'logged in' },
      { id: 'TC-002', title: 'Invalid Credentials', type: 'negative', expectedOutcome: 'error' },
      { id: 'TC-003', title: 'SQL Injection', type: 'security', expectedOutcome: 'rejected' },
    ];
    const next = alignSpecToTestCases(generated, { testCases: cases });
    expect(countPlaywrightTests(next)).toBe(3);
    expect(next).toContain('Successful User Login');
    expect(next).toContain('Invalid Credentials');
    expect(next).toContain('SQL Injection');
    expect(next).toContain('validUser');
    expect(next).toContain('rejected');
  });

  it('rebuilds placeholder tests so every case gets a real body', () => {
    const generated = `import { test } from "@playwright/test";
test("Verify User Login with Valid Credentials", async ({ page }) => {
  await page.goto("https://example.test");
  // Add login logic here
});`;
    expect(specLooksUnimplemented(generated)).toBe(true);
    const next = alignSpecToTestCases(generated, {
      testCases: [
        { title: 'Verify User Login with Valid Credentials', type: 'functional', expectedOutcome: 'Welcome' },
        { title: 'Verify User Login with Invalid Credentials', type: 'negative', expectedOutcome: 'Error' },
      ],
    });
    expect(countPlaywrightTests(next)).toBe(2);
    expect(next).not.toContain('Add login logic here');
    expect(next).toContain('Welcome');
    expect(next).toContain('Invalid Credentials');
  });

  it('modernizes deprecated Playwright calls and maps discovered fields', () => {
    const raw = `test("go", async ({ page }) => {
  expect(await page.isVisible('text=Logo')).toBeTruthy();
  await page.click('text=Register Link');
  await page.fill('input[name="username"]', 'bob');
  await page.fill('input[name="confirmPassword"]', 'x');
  await page.click('text=Register');
});`;
    const next = applyDiscoveredLocators(modernizePlaywrightSpec(raw), [
      'page.locator("[name=\\"customer.username\\"]")',
      'page.locator("[name=\\"repeatedPassword\\"]")',
    ]);
    expect(next).toContain('page.locator(\'text=Logo\').isVisible()');
    expect(next).toContain('getByRole("link", { name: "Register" })');
    expect(next).toContain('getByRole("button", { name: "Register" })');
    expect(next).toContain('customer.username');
    expect(next).toContain('repeatedPassword');
    expect(next).not.toContain('fill(\'bob\')');
  });

  it('parses Playwright list output when the JSON report is missing', () => {
    const rows = flattenPlaywrightListOutput(`
Running 2 tests using 1 worker
  ✘  1 [chromium] › generated.spec.mjs:3:1 › Verify Home Page Display (1.2s)
  ✘  2 [chromium] › generated.spec.mjs:3:1 › Verify Home Page Display (retry #1) (1.2s)
  ✓  3 [chromium] › generated.spec.mjs:11:1 › Navigate to Registration Page (2.0s)
`);
    expect(rows).toEqual([
      { title: 'Verify Home Page Display', status: 'failed' },
      { title: 'Navigate to Registration Page', status: 'passed' },
    ]);
  });

  it('reads navigation paths from a spec instead of a hardcoded app', () => {
    expect(extractGotoPaths('await page.goto("/login"); await page.goto("https://app.test/home");')).toEqual([
      '/login',
      'https://app.test/home',
    ]);
    expect(extractGotoPaths('await page.goto(`${baseUrl}/register.htm`);')).toEqual(['/']);
    expect(extractGotoPaths('await page.goto("https://parabank.parasoft.com/register");')).toEqual([
      'register.htm',
    ]);
  });

  it('builds a runnable suite from generated cases instead of invented assertions', () => {
    const cases = [
      { title: 'Verify Home Page Display', type: 'functional' },
      { title: 'Check Registration Page Access', type: 'functional' },
      { title: 'Submit Registration with Missing Mandatory Fields', type: 'negative' },
      { title: 'Submit Registration with Valid Data', type: 'functional' },
      { title: 'Security Test for Password Field', type: 'security' },
    ];
    expect(classifyExecutableCase(cases[0].title)).toBe('visible');
    expect(classifyExecutableCase(cases[1].title, 'the page loads successfully')).toBe('navigate');
    expect(classifyExecutableCase(cases[2].title, 'Enter valid data in all mandatory fields and submit')).toBe('required');
    expect(classifyExecutableCase(cases[3].title, 'Enter valid data in all mandatory fields and submit')).toBe('submit');
    expect(classifyExecutableCase(cases[4].title, 'the registration is successful')).toBe('negative');
    const next = buildExecutableSuiteFromCases(cases, {
      specHint: 'await page.goto(`${baseUrl}/register.htm`); await page.click(\'text=Register\');',
    });
    expect(countPlaywrightTests(next)).toBe(5);
    expect(next).toContain('Verify Home Page Display');
    expect(next).toContain('register.htm');
    expect(next).toContain('getByRole("link"');
    expect(next).toContain('Passw0rd!');
    expect(next).not.toContain('Welcome John Doe');
    expect(next).not.toContain('Email field is required');
    expect(next).not.toContain('page.click(');
    expect(next).not.toContain('https://parabank.parasoft.com/register"');
  });

  it('classifies by title so description words like successfully do not flip the kind', () => {
    expect(classifyExecutableCase(
      'Verify Registration Link Navigation',
      'the registration page loads successfully',
    )).toBe('navigate');
    expect(classifyExecutableCase(
      'Successful Registration with Valid Data',
      'Enter valid data in all mandatory fields and submit',
    )).toBe('submit');
    expect(classifyExecutableCase(
      'Validate Required Fields on Registration Page',
      'All mandatory fields are present',
    )).toBe('visible');
    expect(isBadCodeReview({ score: 3, issues: [{ type: 'Unimplemented Test' }] })).toBe(true);
    expect(isBadCodeReview({ score: 8, issues: [] })).toBe(false);
  });

  it('keeps a generated spec that already has one test per case', () => {
    const generated = `import { test } from "@playwright/test";
test("Open home", async ({ page }) => { await page.goto("/"); });
test("Open about", async ({ page }) => { await page.goto("/about"); });`;
    const next = alignSpecToTestCases(generated, {
      testCases: [
        { title: 'Open home', type: 'functional', expectedOutcome: 'home' },
        { title: 'Open about', type: 'functional', expectedOutcome: 'about' },
      ],
    });
    expect(next).toBe(generated);
  });

  it('builds a report from execute totals instead of inventing counts', () => {
    const report = buildQeMarkdownReport({
      passed: false,
      total: 8,
      failed: 8,
      source: 'unavailable',
      error: 'timed out',
      results: [],
    });
    expect(report).toContain('Total tests: 8');
    expect(report).toContain('Failed: 8');
    expect(report).not.toContain('Total tests: 10');
    expect(report).toContain('timed out');
  });

  it('builds a 9-test suite from generated test cases', () => {
    const spec = buildParabankSuiteFromCases([...PARABANK_REGISTRATION_TEST_CASES]);
    expect(countPlaywrightTests(spec)).toBe(9);
    expect(spec).toContain('already exists');
    expect(spec).toContain('first name is required');
  });

  it('keeps Parabank app paths under /parabank', () => {
    expect(resolveAppUrl('/register.htm', DEFAULT_PLAYWRIGHT_BASE_URL)).toBe('https://parabank.parasoft.com/parabank/register.htm');
    expect(rewriteSpecUrls('await page.goto("/register.htm");', DEFAULT_PLAYWRIGHT_BASE_URL)).toContain('/parabank/register.htm');
  });

  it('resolves base URL from workflow input, then node config', () => {
    expect(resolvePlaywrightBaseUrl({ playwrightBaseUrl: 'https://hardcoded.test' }, { baseUrl: 'https://from-input.test/' })).toBe('https://from-input.test');
    expect(resolvePlaywrightBaseUrl({ playwrightBaseUrl: 'https://example.test/' }, {})).toBe('https://example.test');
    expect(resolvePlaywrightBaseUrl({}, { baseUrl: 'https://app.test' })).toBe('https://app.test');
    expect(resolvePlaywrightBaseUrl({}, {})).toBe(DEFAULT_PLAYWRIGHT_BASE_URL);
  });

  it('flattens a Playwright JSON report', () => {
    const summary = flattenPlaywrightJsonReport({
      suites: [{
        suites: [{
          specs: [{
            title: 'registers a new customer',
            ok: true,
            tests: [{ results: [{ status: 'passed' }] }],
          }],
        }],
      }],
    });
    expect(summary).toMatchObject({ passed: true, total: 1, failed: 0 });
    expect(summary.results[0]?.title).toBe('registers a new customer');
  });

  it('finds the latest execute result in node outputs', () => {
    expect(findLatestPlaywrightExecute({
      n9: '{"score":8}',
      n10: JSON.stringify({ passed: false, results: [{ title: 'a', status: 'failed' }], source: 'playwright' }),
    })?.passed).toBe(false);
  });

  it('renders a self-contained HTML report', () => {
    const html = buildPlaywrightHtmlReport({
      passed: true,
      total: 1,
      failed: 0,
      results: [{ title: 'registers a new customer', status: 'passed' }],
      source: 'playwright',
      baseUrl: DEFAULT_PLAYWRIGHT_BASE_URL,
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('registers a new customer');
    expect(html).toContain('passed');
  });
});
