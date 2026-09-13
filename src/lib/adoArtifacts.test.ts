import { describe, expect, it } from 'vitest';
import { collectAdoAttachments, collectAdoRepoFiles } from '@/lib/adoArtifacts';
import { defaultAdoRepoName, toGitPath } from '@/lib/adoGit';
import { buildPlaywrightHtmlReport } from '@/lib/playwrightSpec';

const spec = `import { test } from "@playwright/test";
test("register", async ({ page }) => { await page.goto("register.htm"); });`;

describe('adoArtifacts', () => {
  it('attaches reports and test cases, and puts the spec in repo files', () => {
    const execute = {
      passed: true,
      total: 1,
      failed: 0,
      results: [{ title: 'register', status: 'passed' }],
      source: 'playwright',
      spec,
      htmlReport: buildPlaywrightHtmlReport({
        passed: true,
        total: 1,
        failed: 0,
        results: [{ title: 'register', status: 'passed' }],
        source: 'playwright',
        baseUrl: 'https://parabank.parasoft.com/parabank',
      }),
    };
    const files = collectAdoAttachments({
      upstream: {
        'Report Generator': '# Report\nAll good',
      },
      nodeOutputs: {
        n10: JSON.stringify(execute),
      },
      testCases: [{ id: 'TC-001', title: 'Register' }],
    });
    expect(files.map((f) => f.fileName)).toEqual([
      'playwright-report.html',
      'test-cases.json',
      'qe-report.md',
    ]);
    expect(files[0].content).toContain('Playwright execution report');
    expect(files[1].content).toContain('TC-001');
    expect(files[2].content).toContain('# Report');

    const repoFiles = collectAdoRepoFiles({
      nodeOutputs: { n10: JSON.stringify(execute) },
      sourceWorkItemId: 21,
    });
    expect(repoFiles.map((f) => f.path)).toEqual(['generated.spec.ts', 'README.md']);
    expect(repoFiles[0].content).toContain('@playwright/test');
    expect(repoFiles[1].content).toContain('21');
  });

  it('builds an HTML report from execute results when the runner omitted one', () => {
    const files = collectAdoAttachments({
      nodeOutputs: {
        n10: JSON.stringify({
          passed: false,
          total: 1,
          failed: 1,
          results: [{ title: 'register', status: 'failed', error: 'timeout' }],
          source: 'playwright',
          spec,
        }),
      },
    });
    const html = files.find((f) => f.fileName === 'playwright-report.html')?.content ?? '';
    expect(html).toContain('failed');
    expect(html).toContain('timeout');
    expect(files.some((f) => f.fileName === 'generated.spec.ts')).toBe(false);
  });

  it('attaches screenshots, traces, and the official report zip', () => {
    const files = collectAdoAttachments({
      nodeOutputs: {
        n10: JSON.stringify({
          passed: false,
          total: 1,
          failed: 1,
          results: [{
            title: 'register',
            status: 'failed',
            screenshot: 'data:image/png;base64,abcd',
            traceData: 'data:application/zip;base64,eeff',
          }],
          source: 'playwright',
          reportZipBase64: 'UEsDBA',
        }),
      },
    });
    expect(files.map((f) => f.fileName)).toEqual([
      'playwright-report.html',
      'register.png',
      'register-trace.zip',
      'playwright-report.zip',
    ]);
    expect(files.find((f) => f.fileName === 'register.png')?.encoding).toBe('base64');
    expect(files.find((f) => f.fileName === 'playwright-report.zip')?.content).toBe('UEsDBA');
  });

  it('names the ADO repo from the work item', () => {
    expect(defaultAdoRepoName(21, 'Parabank Registration')).toBe('aos-parabank-registration-wi-21');
    expect(defaultAdoRepoName(21)).toBe('aos-playwright-wi-21');
    expect(toGitPath('generated.spec.ts')).toBe('/generated.spec.ts');
  });
});
