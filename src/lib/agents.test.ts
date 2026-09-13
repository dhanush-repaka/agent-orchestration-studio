import { describe, expect, it } from 'vitest';
import { isPublishedAgent, publishReadyErrors } from '@/lib/agents';

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
