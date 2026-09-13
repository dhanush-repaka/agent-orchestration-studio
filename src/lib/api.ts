const ADO_SLUGS = new Set(['ado-retrieval', 'ado-upload']);
export const ADO_INVOKE_TIMEOUT_MS = 15_000;

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function withLocalAdoSecrets(slug: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!ADO_SLUGS.has(slug) || typeof localStorage === 'undefined') return payload;
  const adoPat = localStorage.getItem('aos-ado-pat');
  const adoOrg = payload.adoOrg || localStorage.getItem('aos-ado-org');
  return {
    ...payload,
    ...(adoOrg ? { adoOrg } : {}),
    ...(adoPat ? { adoPat } : {}),
  };
}

const LOCAL_SLUGS: Record<string, string> = {
  'ado-retrieval': '/__studio/ado-retrieval',
  'ado-upload': '/__studio/ado-upload',
  'playwright-execute': '/__studio/playwright-execute',
  'playwright-locators': '/__studio/playwright-locators',
};

function studioPaths(slug: string): string[] {
  const primary = LOCAL_SLUGS[slug];
  if (!primary) return [];
  const direct = `/.netlify/functions/${slug}`;
  return primary === direct ? [primary] : [primary, direct];
}

function looksLikeJson(contentType: string, raw: string): boolean {
  return contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[');
}

function playwrightHtmlError(status: number): string {
  if (status === 502 || status === 504 || status === 408) {
    return 'Playwright runner timed out on the host. qefoundry.com functions stop at 26s; run the suite locally with npm run dev.';
  }
  if (status === 404) {
    return 'Chromium function is missing from this Netlify deploy. /__studio/playwright-execute returned HTML, not JSON.';
  }
  return 'Playwright runner did not return JSON. /__studio/playwright-execute must reach the Netlify Chromium function.';
}

export async function callEdgeFunction<T = unknown>(
  slug: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T }> {
  const body = withLocalAdoSecrets(slug, payload);
  const paths = studioPaths(slug);
  if (paths.length) {
    let lastHtmlStatus = 0;
    try {
      for (const localPath of paths) {
        const localRes = await fetch(localPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ADO_SLUGS.has(slug) ? timeoutSignal(ADO_INVOKE_TIMEOUT_MS) : undefined,
        });
        const contentType = localRes.headers.get('content-type') || '';
        const raw = await localRes.text();
        if (!looksLikeJson(contentType, raw)) {
          lastHtmlStatus = localRes.status;
          if (slug.startsWith('ado-')) continue;
          if (slug.startsWith('playwright-')) continue;
        }
        const localData = (looksLikeJson(contentType, raw) ? (() => { try { return JSON.parse(raw) as T; } catch { return {} as T; } })() : {} as T);
        if (localRes.ok || slug.startsWith('playwright-')) {
          return { ok: localRes.ok, status: localRes.status, data: localData };
        }
        if (slug.startsWith('ado-')) continue;
      }
      if (slug.startsWith('playwright-') && lastHtmlStatus) {
        return {
          ok: false,
          status: lastHtmlStatus,
          data: {
            error: playwrightHtmlError(lastHtmlStatus),
            source: 'unavailable',
            passed: false,
          } as T,
        };
      }
    } catch (err) {
      if (slug.startsWith('playwright-')) {
        return {
          ok: false,
          status: 0,
          data: {
            error: 'Playwright runner is not reachable from this host.',
            source: 'unavailable',
            passed: false,
            cause: err instanceof Error ? err.message : 'Network error',
          } as T,
        };
      }
      // Fall through to the deployed function for ADO.
    }
  }
  if (slug.startsWith('playwright-')) {
    return {
      ok: false,
      status: 404,
      data: {
        error: 'Playwright runner is not deployed. Redeploy qefoundry.com so /__studio/playwright-execute reaches the Netlify Chromium function.',
        source: 'unavailable',
        passed: false,
      } as T,
    };
  }
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ADO_SLUGS.has(slug) ? timeoutSignal(ADO_INVOKE_TIMEOUT_MS) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const timedOut = err instanceof Error && /abort|timeout/i.test(err.name + err.message);
    return {
      ok: false,
      status: 0,
      data: {
        error: timedOut
          ? 'Azure DevOps retrieval timed out. Check the PAT on the Credentials page.'
          : err instanceof Error ? err.message : 'Network error',
      } as T,
    };
  }
}

export type AgentProcessorPayload = {
  agentType: string;
  displayName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  outputInstructions?: string;
  outputFormat?: string;
  jsonSchema?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  modelName?: string;
  upstreamData: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
  workflowName?: string;
  workflowInput?: unknown;
};

export type AgentProcessorResult = {
  agentType?: string;
  result?: unknown;
  llmUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: string;
};
