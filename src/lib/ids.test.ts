import { describe, expect, it } from 'vitest';
import { uniquePrefixedId } from '@/lib/ids';

describe('uniquePrefixedId', () => {
  it('allocates the next free workflow id after hydrate collisions', () => {
    // Regression: ISSUE-011 — wfIdCounter started at 100 while DB already had w101.
    expect(uniquePrefixedId('w', ['w1', 'w101', 'w102'])).toBe('w103');
  });

  it('does not reuse an existing agent id', () => {
    expect(uniquePrefixedId('a', ['a1', 'a2', 'a9'])).toBe('a10');
  });

  it('starts at 1 when nothing is taken', () => {
    expect(uniquePrefixedId('w', [])).toBe('w1');
  });
});
