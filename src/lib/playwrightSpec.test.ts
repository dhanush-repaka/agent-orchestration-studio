import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
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
});
