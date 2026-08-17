import { describe, expect, it } from 'vitest';
import { isMissingRelation, isTransientNetworkError } from '@/lib/network';

describe('isTransientNetworkError', () => {
  it('ignores aborted hydrates and Failed to fetch', () => {
    // Regression: ISSUE-013 — hard reload logged aborted Supabase hydrates as errors.
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))).toBe(true);
  });

  it('still treats real API failures as errors', () => {
    expect(isTransientNetworkError(new Error('JWT expired'))).toBe(false);
    expect(isTransientNetworkError({ message: 'relation workflow_runs does not exist' })).toBe(false);
  });
});

describe('isMissingRelation', () => {
  it('recognizes missing-table errors so catalog hydrate can fall back', () => {
    expect(isMissingRelation({ code: '42P01', message: 'relation studio_catalogs does not exist' })).toBe(true);
    expect(isMissingRelation({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingRelation(new Error('JWT expired'))).toBe(false);
  });
});
