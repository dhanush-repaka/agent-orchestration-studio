import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  PARABANK_REGISTRATION_TEST_CASES,
  alignSpecToTestCases,
  buildParabankSuiteFromCases,
  buildPlaywrightHtmlReport,
  buildQeMarkdownReport,
  countPlaywrightTests,
  extractPlaywrightSpec,
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

  it('resolves base URL from config, then workflow input', () => {
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
