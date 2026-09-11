import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { chromium } from '@playwright/test';
import { DEFAULT_PLAYWRIGHT_BASE_URL, flattenPlaywrightJsonReport, rewriteSpecUrls } from './src/lib/playwrightSpec';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = '0';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function playwrightCli(): string {
  return resolve(process.cwd(), 'node_modules/@playwright/test/cli.js');
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '0',
        PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL: '0',
        NODE_PATH: [resolve(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
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

function writeRunnerFiles(dir: string, spec: string, baseUrl: string, timeoutSec: number) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'generated.spec.ts'), rewriteSpecUrls(spec, baseUrl), 'utf8');
  writeFileSync(join(dir, 'playwright.config.ts'), `
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'generated.spec.ts',
  outputDir: './test-results',
  timeout: ${Math.max(15, timeoutSec) * 1000},
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['json', { outputFile: 'results.json' }], ['list']],
  use: {
    baseURL: ${JSON.stringify(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)},
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
`, 'utf8');
}

async function executeSpec(body: Record<string, unknown>) {
  const spec = typeof body.spec === 'string' ? body.spec.trim() : '';
  if (!spec) {
    return { status: 400, body: { error: 'Playwright spec is required', passed: false, source: 'unavailable' } };
  }
  if (/\b(?:child_process|node:child_process|node:fs|fs\.unlink|fs\.rm)\b/.test(spec)) {
    return { status: 400, body: { error: 'Spec uses disallowed Node APIs', passed: false, source: 'unavailable' } };
  }
  const cli = playwrightCli();
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
  const baseUrl = String(body.baseUrl || DEFAULT_PLAYWRIGHT_BASE_URL).replace(/\/$/, '');
  const timeoutSec = Math.min(240, Math.max(20, Number(body.timeoutSec) || 90));
  const dir = join(process.cwd(), '.aos-runs', `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const started = Date.now();
  writeRunnerFiles(dir, spec, baseUrl, timeoutSec);
  try {
    const ran = await runCommand(
      process.execPath,
      [cli, 'test', `--config=${join(dir, 'playwright.config.ts')}`],
      process.cwd(),
      (timeoutSec + 30) * 1000,
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
    const summary = flattenPlaywrightJsonReport(report);
    const missingBrowser = /Executable doesn't exist|browserType\.launch/i.test(`${ran.stdout}\n${ran.stderr}`);
    if (summary.total === 0 && (ran.code !== 0 || missingBrowser)) {
      return {
        status: missingBrowser ? 500 : 200,
        body: {
          passed: false,
          total: 0,
          failed: 0,
          results: [],
          source: missingBrowser ? 'unavailable' : 'playwright',
          error: missingBrowser
            ? 'Playwright Chromium is not installed. Run npx playwright install chromium.'
            : (ran.stderr || ran.stdout || 'Playwright produced no results').slice(0, 4000),
          stdout: ran.stdout.slice(-4000),
          durationMs: Date.now() - started,
          baseUrl,
        },
      };
    }
    return {
      status: 200,
      body: {
        ...summary,
        source: 'playwright',
        stdout: ran.stdout.slice(-4000),
        stderr: ran.stderr.slice(-2000),
        durationMs: Date.now() - started,
        baseUrl,
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function discoverLocators(body: Record<string, unknown>) {
  const baseUrl = String(body.baseUrl || DEFAULT_PLAYWRIGHT_BASE_URL).replace(/\/$/, '');
  const paths = Array.isArray(body.paths) && body.paths.length
    ? body.paths.map((p) => String(p))
    : ['/', '/register.htm'];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const locators: string[] = [];
    const pages: { path: string; title: string }[] = [];
    for (const path of paths.slice(0, 4)) {
      const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        pages.push({ path, title: await page.title() });
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
      body: {
        locators,
        pages,
        source: 'playwright',
        baseUrl,
      },
    };
  } finally {
    await browser.close();
  }
}

export function playwrightDevRunner(): Plugin {
  return {
    name: 'playwright-dev-runner',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (req.method !== 'POST' || (path !== '/__studio/playwright-execute' && path !== '/__studio/playwright-locators')) {
          next();
          return;
        }
        try {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const result = path === '/__studio/playwright-execute'
            ? await executeSpec(body)
            : await discoverLocators(body);
          json(res, result.status, result.body);
        } catch (err) {
          json(res, 500, {
            error: err instanceof Error ? err.message : 'Playwright runner failed',
            passed: false,
            source: 'unavailable',
          });
        }
      });
    },
  };
}
