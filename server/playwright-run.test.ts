import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlaywrightRunnerConfig } from './playwright-run';

describe('playwright runner files', () => {
  it('writes a plain JS config that Node can import', async () => {
    const source = buildPlaywrightRunnerConfig('https://example.test', { args: ['--headless'] });
    expect(source).toContain('export default');
    expect(source).not.toContain('defineConfig');
    expect(source).not.toContain('from \'@playwright/test\'');
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
});
