import { describe, expect, it } from 'vitest';
import { asModelProvider, maskApiKey, parseStudioModelConfig, providerLabel, seedLlmModel } from '@/lib/models';

describe('studio model config', () => {
  it('maps known providers and falls back to OpenAI', () => {
    expect(asModelProvider('OpenAI')).toBe('OpenAI');
    expect(asModelProvider('Anthropic')).toBe('Anthropic');
    expect(asModelProvider('unknown')).toBe('OpenAI');
  });

  it('labels OpenAI as ChatGPT for the picker', () => {
    expect(providerLabel('OpenAI')).toBe('OpenAI (ChatGPT)');
    expect(providerLabel('Azure OpenAI')).toBe('Azure OpenAI');
  });

  it('parses the model-config payload', () => {
    expect(parseStudioModelConfig({
      model: 'gpt-4o-mini',
      provider: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      configured: true,
      status: 'active',
    })).toMatchObject({
      model: 'gpt-4o-mini',
      provider: 'OpenAI',
      configured: true,
    });
    expect(parseStudioModelConfig({})).toBeNull();
  });

  it('masks API keys and seeds the studio model', () => {
    expect(maskApiKey('sk-test-1234')).toBe('••••1234');
    expect(seedLlmModel({
      provider: 'OpenAI',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      configured: true,
      status: 'active',
    })).toMatchObject({
      id: 'm-studio',
      source: 'studio',
      active: true,
      model: 'gpt-4o-mini',
    });
  });
});
