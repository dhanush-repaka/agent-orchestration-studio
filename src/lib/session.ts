import type { User as AuthUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authErrorMessage, clearLocalAuthSession } from '@/lib/auth';

export type AuthIntent = 'idle' | 'in' | 'out';

export function acceptAuthListenerEvent(
  event: string,
  hasUser: boolean,
  intent: AuthIntent,
): boolean {
  if (hasUser) return intent !== 'out';
  if (event === 'INITIAL_SESSION') return intent !== 'in';
  if (event === 'SIGNED_OUT') return intent === 'out';
  return false;
}

export async function loginWithPassword(email: string, password: string): Promise<{
  ok: boolean;
  error: string;
  user: AuthUser | null;
}> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { ok: false, error: authErrorMessage(error), user: null };
  if (!data.session || !data.user) {
    return { ok: false, error: 'Authentication failed.', user: null };
  }
  return { ok: true, error: '', user: data.user };
}

export async function registerWithPassword(email: string, password: string, name?: string): Promise<{
  ok: boolean;
  error: string;
  user: AuthUser | null;
  needsConfirm?: boolean;
}> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: name?.trim() || undefined } },
  });
  if (error) return { ok: false, error: authErrorMessage(error), user: null };
  if (data.user && !data.session) {
    return { ok: true, error: '', user: data.user, needsConfirm: true };
  }
  if (!data.user) return { ok: false, error: 'Authentication failed.', user: null };
  return { ok: true, error: '', user: data.user };
}

export async function logoutLocal(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    clearLocalAuthSession();
  }
}

let listenerBound = false;

export function startAuthListener(onChange: (event: string, user: AuthUser | null) => void): void {
  if (listenerBound) return;
  listenerBound = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    setTimeout(() => onChange(event, user), 0);
  });
}
