import type { IncomingMessage, ServerResponse } from 'node:http';
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
