import { callEdgeFunction } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { LlmModel, ModelProvider } from '@/types';
import { MODEL_PROVIDERS } from '@/types';

export interface StudioModelConfig {
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  configured: boolean;
  status: string;
}

export const FALLBACK_STUDIO_MODEL: StudioModelConfig = {
  provider: 'OpenAI',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  configured: false,
  status: 'unknown',
};

export function asModelProvider(value: unknown): ModelProvider {
  return MODEL_PROVIDERS.includes(value as ModelProvider) ? value as ModelProvider : 'OpenAI';
}

export function providerLabel(provider: string): string {
  if (provider === 'OpenAI') return 'OpenAI (ChatGPT)';
  return provider;
}

export function parseStudioModelConfig(raw: unknown): StudioModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const model = typeof rec.model === 'string' && rec.model.trim() ? rec.model.trim() : '';
  if (!model) return null;
  return {
    provider: asModelProvider(rec.provider),
    model,
    baseUrl: typeof rec.baseUrl === 'string' ? rec.baseUrl : FALLBACK_STUDIO_MODEL.baseUrl,
    configured: rec.configured === true,
    status: typeof rec.status === 'string' ? rec.status : (rec.configured === true ? 'active' : 'not-configured'),
  };
}

export async function loadStudioModelConfig(): Promise<StudioModelConfig | null> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return FALLBACK_STUDIO_MODEL;
  try {
    const res = await fetch(`${base}/functions/v1/model-config`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) return FALLBACK_STUDIO_MODEL;
    return parseStudioModelConfig(data) ?? FALLBACK_STUDIO_MODEL;
  } catch {
    return FALLBACK_STUDIO_MODEL;
  }
}

const LLM_CATALOG_ID = 'llmModels';
const LLM_LOCAL_KEY = 'aos-llm-models';

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function defaultBaseUrl(provider: ModelProvider): string {
  if (provider === 'Anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'Google Gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (provider === 'Ollama') return 'https://api.openai.com/v1';
  return 'https://api.openai.com/v1';
}

export function seedLlmModel(config: StudioModelConfig): LlmModel {
  return {
    id: 'm-studio',
    name: providerLabel(config.provider),
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    source: 'studio',
    active: true,
    apiKeyMasked: config.configured ? 'studio secret' : '',
  };
}

export function studioConfigFromLlm(model: LlmModel, fallback?: StudioModelConfig | null): StudioModelConfig {
  return {
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    configured: Boolean(model.apiKey || model.apiKeyMasked || fallback?.configured),
    status: model.active ? 'active' : 'ready',
  };
}

function parseLlmModel(raw: unknown): LlmModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const model = typeof rec.model === 'string' ? rec.model.trim() : '';
  const id = typeof rec.id === 'string' ? rec.id : '';
  if (!model || !id) return null;
  return {
    id,
    name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : model,
    provider: asModelProvider(rec.provider),
    model,
    baseUrl: typeof rec.baseUrl === 'string' && rec.baseUrl.trim() ? rec.baseUrl.trim() : FALLBACK_STUDIO_MODEL.baseUrl,
    apiKey: typeof rec.apiKey === 'string' && rec.apiKey.trim() ? rec.apiKey.trim() : undefined,
    apiKeyMasked: typeof rec.apiKeyMasked === 'string' ? rec.apiKeyMasked : (typeof rec.apiKey === 'string' ? maskApiKey(rec.apiKey) : undefined),
    source: rec.source === 'studio' ? 'studio' : 'custom',
    active: rec.active === true,
    lastTestedAt: typeof rec.lastTestedAt === 'string' ? rec.lastTestedAt : undefined,
    lastTestOk: typeof rec.lastTestOk === 'boolean' ? rec.lastTestOk : undefined,
  };
}

function readLocalLlmModels(): LlmModel[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LLM_LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(parseLlmModel).filter((row): row is LlmModel => !!row) : [];
  } catch {
    return [];
  }
}

function writeLocalLlmModels(models: LlmModel[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LLM_LOCAL_KEY, JSON.stringify(models));
  } catch {
    // Ignore quota errors.
  }
}

export async function loadLlmModels(): Promise<LlmModel[]> {
  try {
    const { data, error } = await supabase
      .from('studio_catalogs')
      .select('data')
      .eq('id', LLM_CATALOG_ID)
      .maybeSingle();
    if (!error && Array.isArray(data?.data)) {
      const rows = data.data.map(parseLlmModel).filter((row): row is LlmModel => !!row);
      if (rows.length) {
        writeLocalLlmModels(rows);
        return rows;
      }
    } else if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to load LLM models', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to load LLM models', err);
    }
  }
  return readLocalLlmModels();
}

export async function persistLlmModels(models: LlmModel[]): Promise<void> {
  writeLocalLlmModels(models);
  try {
    const { error } = await supabase.from('studio_catalogs').upsert({
      id: LLM_CATALOG_ID,
      data: models,
      updated_at: new Date().toISOString(),
    });
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to persist LLM models', error);
    }
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to persist LLM models', err);
    }
  }
}

export async function testLlmConnection(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  useStudioSecret?: boolean;
}): Promise<{ ok: boolean; latencyMs?: number; model?: string; error?: string }> {
  const { ok, data } = await callEdgeFunction<{ ok?: boolean; latencyMs?: number; model?: string; error?: string }>(
    'model-test',
    {
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      useStudioSecret: input.useStudioSecret !== false && !input.apiKey,
    },
  );
  if (data.ok === true) {
    return { ok: true, latencyMs: data.latencyMs, model: data.model };
  }
  if (input.useStudioSecret !== false && !input.apiKey) {
    const started = Date.now();
    const fallback = await callEdgeFunction<{ error?: string }>('agent-processor', {
      agentType: 'Custom',
      displayName: 'Model test',
      systemPrompt: 'Reply with the word pong.',
      userPrompt: 'ping',
      modelName: input.model,
      maxTokens: 8,
      temperature: 0,
      upstreamData: {},
    });
    if (fallback.ok && !fallback.data.error) {
      return { ok: true, latencyMs: Date.now() - started, model: input.model };
    }
    if (fallback.data.error) return { ok: false, error: fallback.data.error, latencyMs: Date.now() - started };
  }
  if (!ok && !data.error) return { ok: false, error: 'Could not reach the model test function.' };
  return {
    ok: false,
    latencyMs: data.latencyMs,
    model: data.model,
    error: data.error,
  };
}
