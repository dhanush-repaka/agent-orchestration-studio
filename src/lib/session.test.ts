import { describe, expect, it } from 'vitest';
import { acceptAuthListenerEvent } from '@/lib/session';

describe('session events', () => {
  it('lets a sign-in session through unless logout is in progress', () => {
    expect(acceptAuthListenerEvent('SIGNED_IN', true, 'idle')).toBe(true);
    expect(acceptAuthListenerEvent('SIGNED_IN', true, 'in')).toBe(true);
    expect(acceptAuthListenerEvent('SIGNED_IN', true, 'out')).toBe(false);
  });

  it('does not let a stale sign-out wipe a login that just succeeded', () => {
    expect(acceptAuthListenerEvent('SIGNED_OUT', false, 'idle')).toBe(false);
    expect(acceptAuthListenerEvent('SIGNED_OUT', false, 'in')).toBe(false);
    expect(acceptAuthListenerEvent('SIGNED_OUT', false, 'out')).toBe(true);
  });

  it('uses the first session check to show the login screen', () => {
    expect(acceptAuthListenerEvent('INITIAL_SESSION', false, 'idle')).toBe(true);
    expect(acceptAuthListenerEvent('INITIAL_SESSION', false, 'in')).toBe(false);
    expect(acceptAuthListenerEvent('TOKEN_REFRESHED', false, 'idle')).toBe(false);
  });
});
