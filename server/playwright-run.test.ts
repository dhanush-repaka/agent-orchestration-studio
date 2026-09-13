import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlaywrightRunnerConfig, PLAYWRIGHT_INPROCESS_SHIM, rewriteSpecForInProcess } from './playwright-run';

describe('playwright runner files', () => {
  it('writes a plain JS config that Node can import', async () => {
    const source = buildPlaywrightRunnerConfig('https://example.test', { args: ['--headless'] });
    expect(source).toContain('export default');
    expect(source).not.toContain('defineConfig');
    expect(source).not.toContain('from \'@playwright/test\'');
    expect(source).toContain("screenshot: 'only-on-failure'");
    expect(source).toContain("trace: 'retain-on-failure'");
    expect(source).toContain('playwright-report');
    const dir = mkdtempSync(join(tmpdir(), 'aos-pw-'));
    const file = join(dir, 'playwright.config.mjs');
    try {
      writeFileSync(file, source, 'utf8');
      const loaded = await import(pathToFileURL(file).href) as { default: { testMatch: RegExp } };
      expect(loaded.default.testMatch.test('generated.spec.mjs')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites @playwright/test imports onto the in-process shim', async () => {
    const rewritten = rewriteSpecForInProcess('import { test, expect } from "@playwright/test";\ntest("Home", async ({ page }) => { await page.goto(""); });');
    expect(rewritten).toContain('from "./pw-shim.mjs"');
    expect(rewritten).not.toContain('@playwright/test');
    const dir = mkdtempSync(join(tmpdir(), 'aos-shim-'));
    try {
      writeFileSync(join(dir, 'pw-shim.mjs'), PLAYWRIGHT_INPROCESS_SHIM, 'utf8');
      writeFileSync(join(dir, 'generated.spec.mjs'), rewritten, 'utf8');
      const bucket = ((globalThis as { __aosPlaywrightRegistry?: Array<{ title: string }> }).__aosPlaywrightRegistry = []);
      await import(pathToFileURL(join(dir, 'generated.spec.mjs')).href);
      expect(bucket.map((row) => row.title)).toEqual(['Home']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
