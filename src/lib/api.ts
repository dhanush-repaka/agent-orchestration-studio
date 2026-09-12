const ADO_SLUGS = new Set(['ado-retrieval', 'ado-upload']);

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

export async function callEdgeFunction<T = unknown>(
  slug: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T }> {
  const body = withLocalAdoSecrets(slug, payload);
  const localPath = LOCAL_SLUGS[slug];
  if (localPath) {
    try {
      const localRes = await fetch(localPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const localData = (await localRes.json().catch(() => ({}))) as T;
      if (localRes.ok || slug.startsWith('playwright-')) {
        return { ok: localRes.ok, status: localRes.status, data: localData };
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
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: err instanceof Error ? err.message : 'Network error' } as T,
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
