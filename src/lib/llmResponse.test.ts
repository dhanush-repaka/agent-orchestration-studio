import { describe, expect, it } from 'vitest';
import { extractLlmText, parseLlmJson, recoverTestCases, usesCompletionTokenBudget } from '@/lib/llmResponse';

describe('llmResponse', () => {
  it('reads string and array message content', () => {
    expect(extractLlmText({ choices: [{ message: { content: '{"ok":true}' } }] })).toBe('{"ok":true}');
    expect(extractLlmText({
      choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] } }],
    })).toBe('{"ok":true}');
  });

  it('pulls JSON out of prose and fences', () => {
    expect(parseLlmJson('Here you go:\n```json\n{"testCases":[{"title":"A"}]}\n```\nThanks')).toEqual({
      testCases: [{ title: 'A' }],
    });
    expect(parseLlmJson('[{"title":"A"}]')).toEqual({ testCases: [{ title: 'A' }] });
  });

  it('recovers test cases from a raw wrapper', () => {
    expect(recoverTestCases({
      raw: 'Sure.\n{"testCases":[{"title":"Reset email","expectedOutcome":"sent"}]}',
    })).toEqual([{ title: 'Reset email', expectedOutcome: 'sent' }]);
  });

  it('flags reasoning models that reject max_tokens', () => {
    expect(usesCompletionTokenBudget('gpt-5')).toBe(true);
    expect(usesCompletionTokenBudget('o3-mini')).toBe(true);
    expect(usesCompletionTokenBudget('gpt-4o')).toBe(false);
  });
});
