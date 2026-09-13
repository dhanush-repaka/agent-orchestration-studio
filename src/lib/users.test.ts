import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/types';
import {
  applyPinnedRole, asRole, isAuthUserId, mergeUserRoster, parseUserRoster, pickSignedInUser,
  preferUserRecord, readLocalUserRoster, rememberExactUser, signedInFromAuth,
  userFromRoleRow, writeLocalUserRoster,
} from '@/lib/users';

const admin: User = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Admin',
  email: 'admin@qefoundry.com',
  role: 'Administrator',
};

const viewer: User = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Admin',
  email: 'admin@qefoundry.com',
  role: 'Viewer',
};

const colleague: User = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Priya',
  email: 'priya@qefoundry.com',
  role: 'Agent Designer',
};

function installMemoryStorage() {
  const store = new Map<string, string>();
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
}

describe('user roles', () => {
  it('accepts Administrator regardless of case', () => {
    expect(asRole('Administrator')).toBe('Administrator');
    expect(asRole('administrator')).toBe('Administrator');
    expect(asRole('ADMINISTRATOR')).toBe('Administrator');
    expect(asRole('admin', 'Viewer')).toBe('Viewer');
  });

  it('keeps a stored role when the row is incomplete', () => {
    expect(userFromRoleRow({ id: admin.id, name: 'A', email: admin.email }, admin).role).toBe('Administrator');
    expect(userFromRoleRow({ id: admin.id, role: 'viewer' }).role).toBe('Viewer');
  });

  it('ignores mock catalog ids in a persisted roster', () => {
    expect(isAuthUserId('u1')).toBe(false);
    expect(isAuthUserId(admin.id)).toBe(true);
    expect(parseUserRoster([
      { id: 'u1', name: 'Suribabu M', email: 'alex@example.com', role: 'Administrator' },
      admin,
    ])).toEqual([admin]);
  });

  it('does not wipe remembered people when the table read is empty or failed', () => {
    expect(mergeUserRoster([], [admin, colleague], viewer)).toEqual([admin, colleague]);
    expect(mergeUserRoster(null, [admin, colleague], viewer)).toEqual([admin, colleague]);
  });

  it('keeps a remembered administrator when a table read returns Viewer', () => {
    expect(mergeUserRoster([{ ...admin, role: 'Viewer' }], [admin, colleague], viewer)).toEqual([
      admin,
      colleague,
    ]);
  });

  it('keeps remembered people when the remote list is only the signed-in viewer', () => {
    expect(mergeUserRoster([viewer], [admin, colleague], viewer)).toEqual([
      admin,
      colleague,
    ]);
  });

  it('does not copy the mock studio admin onto a newly signed-in user', () => {
    const mockAdmin: User = { id: 'u1', name: 'Suribabu M', email: 'alex@example.com', role: 'Administrator' };
    expect(signedInFromAuth(viewer, mockAdmin).role).toBe('Viewer');
  });

  it('keeps a remembered administrator across sign-in', () => {
    expect(signedInFromAuth(viewer, { ...viewer, id: 'u1', role: 'Administrator' }, admin).role).toBe('Administrator');
    expect(signedInFromAuth(viewer, admin).role).toBe('Administrator');
  });

  it('does not let a Viewer hydrate overwrite a restored administrator', () => {
    expect(pickSignedInUser(admin, viewer).role).toBe('Administrator');
    expect(preferUserRecord(viewer, admin).role).toBe('Administrator');
  });

  it('pins the founder email as Administrator even when the table says Viewer', () => {
    const founder: User = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Studio user',
      email: 'dhanush@qefoundry.com',
      role: 'Viewer',
    };
    expect(applyPinnedRole(founder)).toMatchObject({
      name: 'Dhanush Repaka',
      role: 'Administrator',
    });
    expect(signedInFromAuth(founder, founder).role).toBe('Administrator');
    expect(mergeUserRoster([founder], [], founder)[0]?.role).toBe('Administrator');
    expect(pickSignedInUser(applyPinnedRole(founder), founder).role).toBe('Administrator');
  });

  describe('local roster cache', () => {
    beforeEach(() => {
      installMemoryStorage();
    });

    it('does not let a Viewer stub wipe remembered people', () => {
      writeLocalUserRoster([admin, colleague]);
      writeLocalUserRoster([viewer]);
      expect(readLocalUserRoster()).toEqual([admin, colleague]);
    });

    it('keeps an explicit role change', () => {
      writeLocalUserRoster([admin, colleague]);
      rememberExactUser({ ...admin, role: 'Operator' });
      expect(readLocalUserRoster().find((user) => user.id === admin.id)?.role).toBe('Operator');
      expect(readLocalUserRoster().find((user) => user.id === colleague.id)).toEqual(colleague);
    });
  });
});
