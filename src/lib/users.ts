import { supabase } from '@/lib/supabase';
import { isMissingRelation, isTransientNetworkError, logStoreError } from '@/lib/network';
import type { Role, User } from '@/types';

const ROLES: Role[] = [
  'Administrator', 'Agent Designer', 'Workflow Designer', 'Operator', 'Approver', 'Viewer',
];

function asRole(value: unknown, fallback: Role = 'Viewer'): Role {
  return ROLES.includes(value as Role) ? value as Role : fallback;
}

export function userFromRoleRow(row: Record<string, unknown>, fallback?: User): User {
  return {
    id: String(row.id ?? fallback?.id ?? ''),
    name: String(row.name ?? fallback?.name ?? 'Studio user'),
    email: String(row.email ?? fallback?.email ?? ''),
    role: asRole(row.role, fallback?.role ?? 'Viewer'),
  };
}

export async function ensureAdministratorExists(user: User): Promise<User> {
  const rows = await loadUserRoles();
  const mine = rows.find((row) => row.id === user.id);
  if (rows.some((row) => row.role === 'Administrator')) {
    return mine ?? user;
  }
  const next: User = { ...(mine ?? user), role: 'Administrator' };
  await upsertUserRole(next);
  return next;
}

export async function loadUserRoles(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('id, name, email, role, updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      if (isMissingRelation(error) || isTransientNetworkError(error)) return [];
      logStoreError('Failed to load users', error);
      return [];
    }
    return (data ?? []).map((row) => userFromRoleRow(row as Record<string, unknown>));
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return [];
    logStoreError('Failed to load users', err);
    return [];
  }
}

export async function ensureUserRow(user: User): Promise<User> {
  const readRow = async () => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('id, name, email, role, updated_at')
      .eq('id', user.id)
      .maybeSingle();
    if (error && !isMissingRelation(error) && !isTransientNetworkError(error)) {
      logStoreError('Failed to load user role', error);
    }
    return data ? userFromRoleRow(data as Record<string, unknown>, user) : null;
  };

  try {
    const existing = await readRow();
    if (existing) {
      const name = user.name.trim() || existing.name;
      const email = user.email.trim() || existing.email;
      if (name !== existing.name || email !== existing.email) {
        await supabase.from('user_roles').update({
          name,
          email,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
      }
      return { ...existing, name, email };
    }
    const { count } = await supabase.from('user_roles').select('id', { count: 'exact', head: true });
    const role: Role = (count ?? 0) === 0 ? 'Administrator' : 'Viewer';
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
      if (raced) return raced;
      if (!isMissingRelation(insertError) && !isTransientNetworkError(insertError)) {
        logStoreError('Failed to create user role', insertError);
      }
    }
    return next;
  } catch (err) {
    if (!isMissingRelation(err) && !isTransientNetworkError(err)) {
      logStoreError('Failed to ensure user role', err);
    }
    const fallback = await readRow().catch(() => null);
    return fallback ?? { ...user, role: user.role || 'Viewer' };
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
    return true;
  } catch (err) {
    if (isMissingRelation(err) || isTransientNetworkError(err)) return false;
    logStoreError('Failed to save user', err);
    return false;
  }
}
