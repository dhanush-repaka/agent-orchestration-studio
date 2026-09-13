import type { User as AuthUser } from '@supabase/supabase-js';
import type { User } from '@/types';

export function userFromAuth(authUser: AuthUser): User {
  const email = authUser.email?.trim() || '';
  const metaName = typeof authUser.user_metadata?.full_name === 'string'
    ? authUser.user_metadata.full_name.trim()
    : '';
  const name = metaName || (email.includes('@') ? email.split('@')[0] : 'Studio user');
  return {
    id: authUser.id,
    name,
    email,
    role: 'Viewer',
  };
}

export function authErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/invalid login credentials/i.test(raw)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(raw)) return 'Confirm this email in Supabase Auth before signing in.';
  if (/user already registered/i.test(raw)) return 'An account with this email already exists. Sign in instead.';
  if (/signup is disabled|signups not allowed/i.test(raw)) return 'New accounts are disabled. Ask an admin to create your user in Supabase.';
  if (/password should be at least/i.test(raw)) return 'Password must be at least 6 characters.';
  if (/unable to validate email/i.test(raw)) return 'Enter a valid email address.';
  return raw || 'Authentication failed.';
}
