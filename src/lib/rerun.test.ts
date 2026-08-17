import { describe, expect, it } from 'vitest';
import { resolveRerunInput } from '@/lib/rerun';

describe('resolveRerunInput', () => {
  it('prefers the stored runtime input from the failed run', () => {
    expect(resolveRerunInput(
      { runtimeInput: '{"workItemId": 21}' },
      { defaultInput: '{"workItemId": 99}' },
    )).toBe('{"workItemId": 21}');
  });

  it('skips placeholder mock node input and uses the workflow default', () => {
    expect(resolveRerunInput(
      { nodeExecutions: [{ input: '{"sample":"input"}' }] },
      { defaultInput: '{"workItemId": 21}' },
    )).toBe('{"workItemId": 21}');
  });

  it('falls back to empty JSON', () => {
    expect(resolveRerunInput({}, {})).toBe('{}');
  });
});
