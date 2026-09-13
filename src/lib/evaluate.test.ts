import { describe, expect, it } from 'vitest';
import { scoreOutputs } from '@/lib/evaluate';

describe('scoreOutputs', () => {
  it('scores exact and equivalent JSON as 1', () => {
    expect(scoreOutputs('{"ok":true}', '{"ok":true}')).toBe(1);
    expect(scoreOutputs('{"ok": true}', '{"ok":true}')).toBe(1);
  });

  it('scores overlapping tokens between 0 and 1', () => {
    const score = scoreOutputs('quality score 85', 'quality score 82 with gaps');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});
