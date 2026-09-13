import type { User as AuthUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authErrorMessage } from '@/lib/auth';

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

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loginWithPassword(email: string, password: string): Promise<{
  ok: boolean;
  error: string;
  user: AuthUser | null;
}> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      }),
      15000,
      'Sign-in is taking too long. Refresh the page and try again.',
    );
    if (error) return { ok: false, error: authErrorMessage(error), user: null };
    if (!data.session || !data.user) {
      return { ok: false, error: 'Authentication failed.', user: null };
    }
    return { ok: true, error: '', user: data.user };
  } catch (err) {
    return { ok: false, error: authErrorMessage(err), user: null };
  }
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
    await withTimeout(
      supabase.auth.signOut(),
      4000,
      'Sign-out timed out',
    );
  } catch {
    // Reload after logout resets a stuck auth client.
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
