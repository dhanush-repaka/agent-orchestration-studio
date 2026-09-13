import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { discoverLocators, executeSpec } from './server/playwright-run';

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

export function playwrightDevRunner(): Plugin {
  return {
    name: 'playwright-dev-runner',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (req.method === 'GET' && path.startsWith('/__studio/playwright-artifacts/')) {
          servePlaywrightArtifact(path, res);
          return;
        }
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

const ARTIFACT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.webm': 'video/webm',
};

function servePlaywrightArtifact(urlPath: string, res: ServerResponse) {
  const match = urlPath.match(/^\/__studio\/playwright-artifacts\/(pw-[A-Za-z0-9-]+)\/(.+)$/);
  if (!match) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const rel = decodeURIComponent(match[2]);
  if (rel.includes('..')) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  const root = resolve(process.cwd(), '.aos-runs', match[1]);
  const file = resolve(root, rel);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', ARTIFACT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  createReadStream(file).pipe(res);
}
