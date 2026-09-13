import { describe, expect, it } from 'vitest';
import { authErrorMessage, clearLocalAuthSession, userFromAuth } from '@/lib/auth';
import { pageFromPath } from '@/lib/routes';

describe('auth', () => {
  it('maps a Supabase user onto the studio user', () => {
    const user = userFromAuth({
      id: 'abc-123',
      email: 'dhanush@qefoundry.com',
      user_metadata: { full_name: 'Dhanush Repaka' },
    } as never);
    expect(user).toMatchObject({
      id: 'abc-123',
      email: 'dhanush@qefoundry.com',
      name: 'Dhanush Repaka',
      role: 'Viewer',
    });
  });

  it('falls back to the email prefix when no name is set', () => {
    expect(userFromAuth({
      id: 'x',
      email: 'ops@qefoundry.com',
      user_metadata: {},
    } as never).name).toBe('ops');
  });

  it('explains common auth failures', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'))).toContain('incorrect');
    expect(authErrorMessage(new Error('User already registered'))).toContain('already exists');
  });

  it('clears persisted Supabase session keys', () => {
    const store = new Map<string, string>([
      ['aos-auth', '{"access_token":"x"}'],
      ['sb-example-auth-token', '{"access_token":"y"}'],
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() { return store.size; },
      },
    });
    clearLocalAuthSession();
    expect(store.has('aos-auth')).toBe(false);
    expect(store.has('sb-example-auth-token')).toBe(false);
  });

  it('does not treat /login as a studio page', () => {
    expect(pageFromPath('/login')).toBe('dashboard');
    expect(pageFromPath('/workflows')).toBe('workflows');
    expect(pageFromPath('/workflows/builder')).toBe('workflow-builder');
    expect(pageFromPath('/approvals')).toBe('approvals');
    expect(pageFromPath('/runs/compare')).toBe('run-compare');
  });
});
