import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { Role, User } from '@/types';

const ROLES: Role[] = [
  'Administrator', 'Agent Designer', 'Workflow Designer', 'Operator', 'Approver', 'Viewer',
];

const ROSTER_KEY = 'aos-user-roles';
const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asRole(value: unknown, fallback: Role = 'Viewer'): Role {
  if (typeof value === 'string') {
    const exact = ROLES.find((role) => role === value);
    if (exact) return exact;
    const match = ROLES.find((role) => role.toLowerCase() === value.trim().toLowerCase());
    if (match) return match;
  }
  return fallback;
}

export function isAuthUserId(id: string | undefined): boolean {
  return Boolean(id && AUTH_USER_ID.test(id));
}

export function userFromRoleRow(row: Record<string, unknown>, fallback?: User): User {
  return {
    id: String(row.id ?? fallback?.id ?? ''),
    name: String(row.name ?? fallback?.name ?? 'Studio user'),
    email: String(row.email ?? fallback?.email ?? ''),
    role: asRole(row.role, fallback?.role ?? 'Viewer'),
  };
}

export function roleRank(role: Role | undefined): number {
  switch (role) {
    case 'Administrator': return 5;
    case 'Approver': return 4;
    case 'Agent Designer':
    case 'Workflow Designer': return 3;
    case 'Operator': return 2;
    case 'Viewer': return 1;
    default: return 0;
  }
}

export function preferUserRecord(a: User, b: User): User {
  const role = roleRank(a.role) >= roleRank(b.role) ? a.role : b.role;
  return {
    id: a.id || b.id,
    name: (b.name && b.name !== 'Studio user' ? b.name : a.name) || b.name,
    email: b.email || a.email,
    role,
    allowedEnvironments: b.allowedEnvironments ?? a.allowedEnvironments,
  };
}

export function parseUserRoster(raw: unknown): User[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, User>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = userFromRoleRow(item as Record<string, unknown>);
    if (!isAuthUserId(row.id)) continue;
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

export function readLocalUserRoster(): User[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    return raw ? parseUserRoster(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function persistRoster(users: User[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }))));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function writeLocalUserRoster(users: User[]): void {
  persistRoster(mergeUserRoster(parseUserRoster(users), readLocalUserRoster()));
}

export function rememberExactUser(user: User): void {
  if (!isAuthUserId(user.id)) return;
  persistRoster([
    ...readLocalUserRoster().filter((row) => row.id !== user.id),
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  ]);
}

export function rememberedUser(id: string | undefined): User | undefined {
  if (!id) return undefined;
  return readLocalUserRoster().find((user) => user.id === id);
}

export function mergeUserRoster(remote: User[] | null, local: User[], current?: User): User[] {
  const byId = new Map<string, User>();
  const add = (user: User | undefined) => {
    if (!user?.id || !isAuthUserId(user.id)) return;
    const prev = byId.get(user.id);
    byId.set(user.id, prev ? preferUserRecord(prev, user) : user);
  };
  for (const user of remote ?? []) add(user);
  for (const user of local) add(user);
  add(current);
  return Array.from(byId.values());
}

export function signedInFromAuth(authStub: User, current: User, remembered?: User): User {
  const same = current.id === authStub.id;
  const rememberedRole = remembered?.id === authStub.id ? remembered.role : undefined;
  const currentRole = same ? current.role : undefined;
  const role = rememberedRole === 'Administrator' || currentRole === 'Administrator'
    ? 'Administrator'
    : (currentRole && currentRole !== 'Viewer'
      ? currentRole
      : (rememberedRole && rememberedRole !== 'Viewer' ? rememberedRole : 'Viewer'));
  return {
    ...authStub,
    role,
    allowedEnvironments: same ? current.allowedEnvironments : remembered?.allowedEnvironments,
  };
}

export function pickSignedInUser(promoted: User, fromRoster?: User): User {
  if (!fromRoster || fromRoster.id !== promoted.id) return promoted;
  return {
    ...fromRoster,
    name: promoted.name || fromRoster.name,
    email: promoted.email || fromRoster.email,
    role: roleRank(promoted.role) >= roleRank(fromRoster.role) ? promoted.role : fromRoster.role,
    allowedEnvironments: fromRoster.allowedEnvironments ?? promoted.allowedEnvironments,
  };
}

export type UserRolesLoad = { ok: boolean; users: User[] };

export async function loadUserRolesResult(): Promise<UserRolesLoad> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('id, name, email, role, updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      if (!isMissingRelation(error) && !isTransientNetworkError(error)) {
        logStoreError('Failed to load users', error);
      }
      return { ok: false, users: [] };
    }
    return { ok: true, users: (data ?? []).map((row) => userFromRoleRow(row as Record<string, unknown>)) };
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to load users', err);
    }
    return { ok: false, users: [] };
  }
}

export async function loadUserRoles(): Promise<User[]> {
  const result = await loadUserRolesResult();
  return result.users;
}

async function restoreUserRoster(users: User[]): Promise<void> {
  const real = users.filter((user) => isAuthUserId(user.id));
  if (!real.length) return;
  await Promise.all(real.map((user) => upsertUserRole(user)));
}

export async function ensureAdministratorExists(user: User): Promise<User> {
  const loaded = await loadUserRolesResult();
  const local = readLocalUserRoster();
  const rows = loaded.ok ? loaded.users : local;
  const mine = rows.find((row) => row.id === user.id);
  if (rows.some((row) => row.role === 'Administrator')) {
    return mine ?? user;
  }
  const next: User = { ...(mine ?? user), role: 'Administrator' };
  await upsertUserRole(next);
  rememberUsers([next, ...rows]);
  return next;
}

function rememberUsers(users: User[]): void {
  const byId = new Map(readLocalUserRoster().map((user) => [user.id, user]));
  for (const user of users) {
    if (!isAuthUserId(user.id)) continue;
    const prev = byId.get(user.id);
    byId.set(user.id, prev ? preferUserRecord(prev, user) : user);
  }
  writeLocalUserRoster(Array.from(byId.values()));
}

export async function ensureUserRow(user: User): Promise<User> {
  const remembered = rememberedUser(user.id);
  const readRow = async (): Promise<{ user: User | null; failed: boolean }> => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, name, email, role, updated_at')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        if (!isMissingRelation(error) && !isTransientNetworkError(error)) {
          logStoreError('Failed to load user role', error);
        }
        return { user: null, failed: true };
      }
      return { user: data ? userFromRoleRow(data as Record<string, unknown>, user) : null, failed: false };
    } catch (err) {
      if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
        logStoreError('Failed to load user role', err);
      }
      return { user: null, failed: true };
    }
  };

  const preservedRole = (): Role => {
    if (user.role === 'Administrator' || remembered?.role === 'Administrator') return 'Administrator';
    if (user.role && user.role !== 'Viewer') return user.role;
    return remembered?.role ?? 'Viewer';
  };

  try {
    const existing = await readRow();
    if (existing.failed) {
      return { ...user, role: preservedRole(), name: user.name || remembered?.name || user.name, email: user.email || remembered?.email || user.email };
    }
    if (existing.user) {
      const name = user.name.trim() || existing.user.name;
      const email = user.email.trim() || existing.user.email;
      if (name !== existing.user.name || email !== existing.user.email) {
        await supabase.from('user_roles').update({
          name,
          email,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
      }
      const next = { ...existing.user, name, email };
      rememberUsers([next]);
      return next;
    }
    const { count, error: countError } = await supabase.from('user_roles').select('id', { count: 'exact', head: true });
    if (countError) {
      if (!isMissingRelation(countError) && !isTransientNetworkError(countError)) {
        logStoreError('Failed to count users', countError);
      }
      return { ...user, role: preservedRole() };
    }
    const role: Role = (count ?? 0) === 0 || preservedRole() === 'Administrator'
      ? 'Administrator'
      : 'Viewer';
    const next: User = { ...user, role };
    const { error: insertError } = await supabase.from('user_roles').insert({
      id: next.id,
      name: next.name,
      email: next.email,
      role: next.role,
      updated_at: new Date().toISOString(),
    });
    if (insertError) {
      const raced = await readRow();
      if (raced.user) return raced.user;
      if (!isMissingRelation(insertError) && !isTransientNetworkError(insertError)) {
        logStoreError('Failed to create user role', insertError);
      }
    }
    rememberUsers([next]);
    return next;
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to ensure user role', err);
    }
    const fallback = await readRow().catch(() => ({ user: null, failed: true }));
    return fallback.user ?? { ...user, role: preservedRole() };
  }
}

export async function upsertUserRole(user: User): Promise<boolean> {
  try {
    const { error } = await supabase.from('user_roles').upsert({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      if (isMissingRelation(error) || isTransientNetworkError(error)) return false;
      logStoreError('Failed to save user', error);
      return false;
    }
    rememberExactUser(user);
    return true;
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return false;
    logStoreError('Failed to save user', err);
    return false;
  }
}

export async function resolveSignedInWorkspace(user: User): Promise<{ current: User; users: User[] }> {
  const persisted = await ensureUserRow(user);
  const promoted = await ensureAdministratorExists(persisted);
  const { users } = await hydrateUserRoster(promoted);
  const listed = users.find((row) => row.id === promoted.id);
  const current = pickSignedInUser(promoted, listed);
  const roster = mergeUserRoster(users, [], current);
  writeLocalUserRoster(roster);
  return { current, users: roster };
}

export async function hydrateUserRoster(current?: User): Promise<{ users: User[]; fromRemote: boolean }> {
  const loaded = await loadUserRolesResult();
  const local = readLocalUserRoster();
  const users = mergeUserRoster(loaded.ok ? loaded.users : null, local, current);
  const remoteById = new Map((loaded.ok ? loaded.users : []).map((user) => [user.id, user]));
  const heal = users.filter((user) => {
    const remote = remoteById.get(user.id);
    return !remote || roleRank(user.role) > roleRank(remote.role);
  });
  if (heal.length && (loaded.ok || local.length)) {
    await restoreUserRoster(heal);
  }
  writeLocalUserRoster(users);
  return { users, fromRemote: loaded.ok && loaded.users.length > 0 };
}
