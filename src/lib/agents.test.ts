import { describe, expect, it } from 'vitest';
import { AGENTS } from '@/data/mock';
import { agentHasHardcodedData, isPublishedAgent, publishReadyErrors, sanitizeAgent } from '@/lib/agents';

describe('isPublishedAgent', () => {
  it('requires a persisted published status', () => {
    expect(isPublishedAgent({ status: 'published', persisted: true })).toBe(true);
    expect(isPublishedAgent({ status: 'draft', persisted: true })).toBe(false);
    expect(isPublishedAgent({ status: 'published', persisted: false })).toBe(false);
  });
});

describe('publishReadyErrors', () => {
  const prompt = { systemPrompt: 'Be helpful', userPromptTemplate: 'Use {{workflow_input}}' };

  it('accepts a named agent with a prompt', () => {
    expect(publishReadyErrors({
      displayName: 'Triage Bot',
      type: 'Custom',
      prompt,
      status: 'draft',
    })).toEqual([]);
  });

  it('blocks untitled agents and empty prompts', () => {
    expect(publishReadyErrors({
      displayName: 'Untitled Agent',
      type: 'Custom',
      prompt: { systemPrompt: '', userPromptTemplate: '' },
      status: 'draft',
    })).toEqual(['Give the agent a display name', 'Add a system or user prompt']);
  });
});

describe('library agents', () => {
  it('ships without hardcoded product samples or fallbacks', () => {
    for (const agent of AGENTS) {
      expect(agentHasHardcodedData(agent), agent.id).toBe(false);
      expect(JSON.stringify(agent)).not.toMatch(/parabank|customer\.firstName|Ada Lovelace|john\.doe/i);
    }
  });

  it('replaces a stored Parabank fallback with the catalog agent', () => {
    const catalog = AGENTS.find((agent) => agent.id === 'a3');
    expect(catalog).toBeTruthy();
    const dirty = {
      ...catalog!,
      output: {
        ...catalog!.output,
        fallbackResponse: 'await page.goto("register.htm"); await page.locator(\'[name="customer.firstName"]\').fill("Ada");',
      },
    };
    expect(agentHasHardcodedData(dirty)).toBe(true);
    const next = sanitizeAgent(dirty, catalog);
    expect(next.output.fallbackResponse).toBe(catalog!.output.fallbackResponse);
    expect(agentHasHardcodedData(next)).toBe(false);
  });
});
