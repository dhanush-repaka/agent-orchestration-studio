import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  applyDiscoveredLocators,
  buildPlaywrightHtmlReport,
  countPlaywrightTests,
  modernizePlaywrightSpec,
  normalizeGotoPath,
  rewriteSpecUrls,
  summarizePlaywrightOutput,
  type PlaywrightSpecResult,
} from '../src/lib/playwrightSpec';

export type RunnerResult = { status: number; body: Record<string, unknown> };

type ChromeLaunch = {
  executablePath?: string;
  args: string[];
};

function onLambda() {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY);
}

async function resolveChrome(): Promise<ChromeLaunch> {
  if (onLambda()) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    };
  }
  return { args: [] };
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const env = {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || (onLambda() ? undefined : '0'),
      PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL: '0',
      NODE_PATH: [resolve(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':'),
    };
    delete env.FORCE_COLOR;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveRun({ code: 1, stdout, stderr: err.message });
    });
  });
}

export function buildPlaywrightRunnerConfig(baseUrl: string, chrome: ChromeLaunch): string {
  const lambda = onLambda();
  return `export default {
  testDir: '.',
  testMatch: /generated\\.spec\\.(mjs|js|ts)/,
  outputDir: './test-results',
  timeout: ${lambda ? 12000 : 15000},
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['json', { outputFile: 'results.json' }],
    ['list'],
    ${lambda ? '' : `['html', { outputFolder: 'playwright-report', open: 'never' }],`}
  ].filter(Boolean),
  use: {
    baseURL: ${JSON.stringify(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)},
    headless: true,
    screenshot: ${lambda ? "'only-on-failure'" : "'on'"},
    video: 'off',
    trace: ${lambda ? "'off'" : "'on'"},
    launchOptions: {
      executablePath: ${chrome.executablePath ? JSON.stringify(chrome.executablePath) : 'undefined'},
      args: ${JSON.stringify(chrome.args)},
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
`;
}

const TRACE_DATA_MAX_BYTES = 8_000_000;
const REPORT_ZIP_MAX_BYTES = 8_000_000;

export function zipPlaywrightReport(runDir: string): Buffer | null {
  const reportDir = join(runDir, 'playwright-report');
  if (!existsSync(join(reportDir, 'index.html'))) return null;
  const zipPath = join(runDir, 'playwright-report.zip');
  const zipped = spawnSync('zip', ['-r', '-q', zipPath, 'playwright-report'], {
    cwd: runDir,
    encoding: 'buffer',
  });
  if (zipped.status !== 0 || !existsSync(zipPath)) return null;
  return readFileSync(zipPath);
}

function pruneOldRuns(root: string, keep = 16) {
  if (!existsSync(root)) return;
  const dirs = readdirSync(root)
    .filter((name) => name.startsWith('pw-'))
    .map((name) => {
      const path = join(root, name);
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((row): row is { path: string; mtime: number } => Boolean(row))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of dirs.slice(keep)) {
    rmSync(stale.path, { recursive: true, force: true });
  }
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, acc);
    else acc.push(path);
  }
  return acc;
}

function hydrateRunArtifacts(dir: string, results: PlaywrightSpecResult[]): PlaywrightSpecResult[] {
  const artifactId = basename(dir);
  return results.map((row) => {
    const next = { ...row };
    const attachments = row.attachments ?? [];
    for (const att of attachments) {
      if (!att.path || !existsSync(att.path)) continue;
      if (!next.screenshot && (att.name === 'screenshot' || att.contentType?.startsWith('image/'))) {
        next.screenshot = `data:${att.contentType || 'image/png'};base64,${readFileSync(att.path).toString('base64')}`;
      }
      if (att.name === 'trace' || att.path.endsWith('.zip') || att.path.endsWith('trace.zip')) {
        if (!next.traceUrl) {
          next.traceUrl = `/__studio/playwright-artifacts/${artifactId}/${relative(dir, att.path).replace(/\\/g, '/')}`;
        }
        if (!next.traceData) {
          const buf = readFileSync(att.path);
          if (buf.length <= TRACE_DATA_MAX_BYTES) {
            next.traceData = `data:application/zip;base64,${buf.toString('base64')}`;
          }
        }
      }
    }
    if (!next.screenshot || !next.traceUrl || !next.traceData) {
      const slug = row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      for (const file of walkFiles(join(dir, 'test-results'))) {
        const name = file.toLowerCase();
        if (!name.includes(slug.slice(0, 24)) && !name.includes('test-failed') && !name.endsWith('trace.zip')) continue;
        if (!next.screenshot && extname(file) === '.png' && (name.includes(slug.slice(0, 24)) || name.includes('test-failed'))) {
          next.screenshot = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
        }
        if (name.endsWith('trace.zip') && (name.includes(slug.slice(0, 24)) || !next.traceUrl)) {
          if (!next.traceUrl) {
            next.traceUrl = `/__studio/playwright-artifacts/${artifactId}/${relative(dir, file).replace(/\\/g, '/')}`;
          }
          if (!next.traceData) {
            const buf = readFileSync(file);
            if (buf.length <= TRACE_DATA_MAX_BYTES) {
              next.traceData = `data:application/zip;base64,${buf.toString('base64')}`;
            }
          }
        }
      }
    }
    return next;
  });
}

function writeRunnerFiles(dir: string, spec: string, baseUrl: string, timeoutSec: number, chrome: ChromeLaunch) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }), 'utf8');
  writeFileSync(join(dir, 'generated.spec.mjs'), rewriteSpecUrls(spec, baseUrl), 'utf8');
  writeFileSync(join(dir, 'playwright.config.mjs'), buildPlaywrightRunnerConfig(baseUrl, chrome), 'utf8');
}

export const PLAYWRIGHT_INPROCESS_SHIM = `const registry = (globalThis.__aosPlaywrightRegistry ||= []);
function test(title, fn) {
  if (typeof title === 'function') return title();
  if (typeof fn === 'function') registry.push({ title: String(title), fn });
}
test.describe = (_title, fn) => { if (typeof fn === 'function') fn(); };
test.skip = () => {};
test.only = test;
test.describe.skip = () => {};
test.describe.only = test.describe;
test.beforeEach = () => {};
test.afterEach = () => {};
test.beforeAll = () => {};
test.afterAll = () => {};

function expect(actual) {
  const timeoutOf = (opts) => opts?.timeout ?? 8000;
  const textOf = async () => (typeof actual?.innerText === 'function' ? await actual.innerText() : String(actual ?? ''));
  const matches = (expected, value) => expected instanceof RegExp ? expected.test(value) : value.includes(String(expected));
  const self = {
    async toBeVisible(opts) {
      if (typeof actual?.waitFor === 'function') {
        await actual.waitFor({ state: 'visible', timeout: timeoutOf(opts) });
        return;
      }
      throw new Error('toBeVisible() needs a locator');
    },
    async toBeHidden(opts) {
      if (typeof actual?.waitFor === 'function') {
        await actual.waitFor({ state: 'hidden', timeout: timeoutOf(opts) });
        return;
      }
      throw new Error('toBeHidden() needs a locator');
    },
    async toContainText(expected, opts) {
      const limit = timeoutOf(opts);
      const started = Date.now();
      let last = '';
      while (Date.now() - started < limit) {
        last = await textOf();
        if (matches(expected, last)) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error('Expected text ' + expected + ' but got ' + last.slice(0, 200));
    },
    async toHaveText(expected, opts) { return self.toContainText(expected, opts); },
    async toHaveCount(n) {
      const count = typeof actual?.count === 'function' ? await actual.count() : 0;
      if (count !== n) throw new Error('Expected count ' + n + ' got ' + count);
    },
    async toHaveURL(expected) {
      const url = typeof actual?.url === 'function' ? actual.url() : String(actual ?? '');
      if (!matches(expected, url)) throw new Error('Expected URL ' + expected + ' got ' + url);
    },
    async toHaveValue(expected) {
      const value = typeof actual?.inputValue === 'function' ? await actual.inputValue() : '';
      if (value !== String(expected)) throw new Error('Expected value ' + expected + ' got ' + value);
    },
  };
  return Object.assign(self, {
    not: {
      async toBeVisible() {
        const visible = typeof actual?.isVisible === 'function' ? await actual.isVisible() : false;
        if (visible) throw new Error('Expected locator not to be visible');
      },
      async toContainText(expected) {
        if (matches(expected, await textOf())) throw new Error('Expected not to contain ' + expected);
      },
    },
  });
}

export { test, expect, registry };
`;

export function rewriteSpecForInProcess(spec: string): string {
  return modernizePlaywrightSpec(spec)
    .replace(/from\s+['"]@playwright\/test['"]/g, 'from "./pw-shim.mjs"')
    .replace(/require\(\s*['"]@playwright\/test['"]\s*\)/g, '{ test, expect }');
}

type InProcessTest = { title: string; fn: (args: { page: unknown }) => Promise<void> };

async function executeSpecInProcess(
  spec: string,
  baseUrl: string,
  timeoutSec: number,
): Promise<RunnerResult> {
  const dir = join(tmpdir(), `pw-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }), 'utf8');
  writeFileSync(join(dir, 'pw-shim.mjs'), PLAYWRIGHT_INPROCESS_SHIM, 'utf8');
  writeFileSync(join(dir, 'generated.spec.mjs'), rewriteSpecUrls(rewriteSpecForInProcess(spec), baseUrl), 'utf8');
  const started = Date.now();
  const chrome = await resolveChrome();
  const { chromium } = await import('playwright-core');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: chrome.executablePath,
      args: chrome.args,
    });
    const bucket = ((globalThis as { __aosPlaywrightRegistry?: InProcessTest[] }).__aosPlaywrightRegistry = []);
    await import(pathToFileURL(join(dir, 'generated.spec.mjs')).href);
    const tests = bucket;
    if (!tests.length) {
      return {
        status: 200,
        body: {
          passed: false,
          total: 0,
          failed: 0,
          results: [],
          source: 'playwright',
          error: 'In-process runner found no tests in the spec.',
          durationMs: Date.now() - started,
          baseUrl,
          spec,
        },
      };
    }
    const context = await browser.newContext({
      baseURL: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    });
    const deadline = started + Math.min(timeoutSec, 20) * 1000;
    const results: Array<{ title: string; status: 'passed' | 'failed' | 'skipped'; error?: string; screenshot?: string }> = [];
    for (const test of tests) {
      if (Date.now() > deadline - 2500) {
        results.push({ title: test.title, status: 'skipped' });
        continue;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      try {
        await test.fn({ page });
        results.push({ title: test.title, status: 'passed' });
      } catch (err) {
        let screenshot: string | undefined;
        try {
          const shot = await page.screenshot({ type: 'png' });
          screenshot = `data:image/png;base64,${Buffer.from(shot).toString('base64')}`;
        } catch {
          // keep the assertion error
        }
        results.push({
          title: test.title,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          ...(screenshot ? { screenshot } : {}),
        });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    await context.close().catch(() => undefined);
    const failed = results.filter((row) => row.status === 'failed').length;
    const skipped = results.filter((row) => row.status === 'skipped').length;
    const body = {
      passed: results.length > 0 && failed === 0 && skipped < results.length,
      total: results.length,
      failed,
      skipped,
      results,
      source: 'playwright' as const,
      error: skipped
        ? `Hosted Chromium stopped at ${Math.min(timeoutSec, 20)}s. ${skipped} test(s) were skipped. Run the full suite with npm run dev.`
        : failed
          ? results.find((row) => row.error)?.error
          : undefined,
      durationMs: Date.now() - started,
      baseUrl,
      spec,
    };
    return { status: 200, body: { ...body, htmlReport: buildPlaywrightHtmlReport(body) } };
  } catch (err) {
    return {
      status: 500,
      body: {
        passed: false,
        total: 0,
        failed: 0,
        results: [],
        source: 'unavailable',
        error: err instanceof Error ? err.message : 'In-process Playwright runner failed',
        durationMs: Date.now() - started,
        baseUrl,
        spec,
      },
    };
  } finally {
    await browser?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function executeSpec(body: Record<string, unknown>): Promise<RunnerResult> {
  let spec = typeof body.spec === 'string' ? body.spec.trim() : '';
  if (!spec) {
    return { status: 400, body: { error: 'Playwright spec is required', passed: false, source: 'unavailable' } };
  }
  spec = modernizePlaywrightSpec(spec);
  if (Array.isArray(body.locators)) spec = applyDiscoveredLocators(spec, body.locators.map(String));
  if (/\b(?:child_process|node:child_process|node:fs|fs\.unlink|fs\.rm)\b/.test(spec)) {
    return { status: 400, body: { error: 'Spec uses disallowed Node APIs', passed: false, source: 'unavailable' } };
  }
  const baseUrl = String(body.baseUrl || DEFAULT_PLAYWRIGHT_BASE_URL).replace(/\/$/, '');
  const lambda = onLambda();
  if (lambda) {
    const timeoutSec = Math.min(20, Math.max(8, Number(body.timeoutSec) || 18));
    return executeSpecInProcess(spec, baseUrl, timeoutSec);
  }
  const cli = resolve(process.cwd(), 'node_modules/@playwright/test/cli.js');
  if (!existsSync(cli)) {
    return {
      status: 500,
      body: {
        error: '@playwright/test is not installed. Run npm install and npx playwright install chromium.',
        passed: false,
        source: 'unavailable',
      },
    };
  }
  const testCount = Math.max(1, countPlaywrightTests(spec));
  const timeoutSec = Math.min(240, Math.max(90, Number(body.timeoutSec) || testCount * 20));
  const root = join(process.cwd(), '.aos-runs');
  const dir = join(root, `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const started = Date.now();
  const chrome = await resolveChrome();
  writeRunnerFiles(dir, spec, baseUrl, timeoutSec, chrome);
  try {
    const ran = await runCommand(
      process.execPath,
      [cli, 'test', '--config=playwright.config.mjs'],
      dir,
      (timeoutSec + 20) * 1000,
    );
    const resultsPath = join(dir, 'results.json');
    let report: unknown = null;
    if (existsSync(resultsPath)) {
      try {
        report = JSON.parse(readFileSync(resultsPath, 'utf8'));
      } catch {
        report = null;
      }
    }
    const summary = summarizePlaywrightOutput(report, ran.stdout, ran.stderr);
    const results = hydrateRunArtifacts(dir, summary.results);
    const artifactId = basename(dir);
    const reportPath = join(dir, 'playwright-report', 'index.html');
    const reportUrl = existsSync(reportPath)
      ? `/__studio/playwright-artifacts/${artifactId}/playwright-report/index.html`
      : undefined;
    const reportZip = zipPlaywrightReport(dir);
    const reportZipBase64 = reportZip && reportZip.length <= REPORT_ZIP_MAX_BYTES
      ? reportZip.toString('base64')
      : undefined;
    const missingBrowser = /Executable doesn't exist|browserType\.launch/i.test(`${ran.stdout}\n${ran.stderr}`);
    const body = {
      ...summary,
      results,
      source: missingBrowser ? 'unavailable' : 'playwright',
      error: missingBrowser
        ? 'Playwright Chromium is not installed on the host.'
        : summary.error,
      stdout: ran.stdout.slice(-4000),
      stderr: ran.stderr.slice(-2000),
      durationMs: Date.now() - started,
      baseUrl,
      spec,
      artifactDir: artifactId,
      ...(reportUrl ? { reportUrl } : {}),
      ...(reportZipBase64 ? { reportZipBase64 } : {}),
    };
    pruneOldRuns(root);
    return {
      status: missingBrowser ? 500 : 200,
      body: { ...body, htmlReport: buildPlaywrightHtmlReport(body) },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        passed: false,
        total: 0,
        failed: 0,
        results: [],
        source: 'unavailable',
        error: err instanceof Error ? err.message : 'Playwright runner failed',
        durationMs: Date.now() - started,
        baseUrl,
        spec,
        artifactDir: basename(dir),
      },
    };
  }
}

export async function discoverLocators(body: Record<string, unknown>): Promise<RunnerResult> {
  const baseUrl = String(body.baseUrl || DEFAULT_PLAYWRIGHT_BASE_URL).replace(/\/$/, '');
  const paths = (Array.isArray(body.paths) && body.paths.length
    ? body.paths.map((p) => normalizeGotoPath(String(p)))
    : ['/']
  ).filter(Boolean);
  const scan = paths.length ? paths : ['/'];
  const chrome = await resolveChrome();
  const { chromium } = onLambda()
    ? await import('playwright-core')
    : await import('@playwright/test');
  const browser = await chromium.launch({
    headless: true,
    executablePath: chrome.executablePath,
    args: chrome.args,
  });
  try {
    const page = await browser.newPage();
    const locators: string[] = [];
    const pages: { path: string; title: string }[] = [];
    for (const path of scan.slice(0, 4)) {
      const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await page.title();
        if (/404|not found/i.test(title)) continue;
        pages.push({ path, title });
        const found = await page.evaluate(() => {
          const out: string[] = [];
          const seen = new Set<string>();
          const add = (value: string) => {
            if (!seen.has(value) && out.length < 40) {
              seen.add(value);
              out.push(value);
            }
          };
          for (const el of Array.from(document.querySelectorAll('input, button, select, textarea, a'))) {
            const name = el.getAttribute('name');
            const id = el.getAttribute('id');
            const type = el.getAttribute('type');
            const text = (el.textContent || '').trim().slice(0, 60);
            if (name) add(`page.locator(${JSON.stringify(`[name="${name}"]`)})`);
            else if (id) add(`page.locator(${JSON.stringify(`#${id}`)})`);
            if (el.tagName === 'BUTTON' || type === 'submit') {
              if (text) add(`page.getByRole("button", { name: ${JSON.stringify(text)} })`);
            }
          }
          return out;
        });
        for (const item of found) {
          if (!locators.includes(item)) locators.push(item);
        }
      } catch {
        // keep scanning other paths
      }
    }
    return {
      status: 200,
      body: { locators, pages, source: 'playwright', baseUrl },
    };
  } finally {
    await browser.close();
  }
}
