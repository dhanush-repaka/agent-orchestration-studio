export async function callEdgeFunction<T = unknown>(
  slug: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T }> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
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
