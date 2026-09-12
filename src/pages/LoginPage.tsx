import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '@/store';

export function LoginPage() {
  const signIn = useStore((s) => s.signIn);
  const signUp = useStore((s) => s.signUp);
  const theme = useStore((s) => s.theme);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const result = await signIn(email, password);
        if (!result.ok) setError(result.error);
        return;
      }
      const result = await signUp(email, password, name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.needsConfirm) {
        setInfo('Account created. Confirm the email in Supabase Auth, then sign in.');
        setMode('signin');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">AI Agent Orchestration Studio</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Sign in to open the workspace</p>
          </div>
        </div>

        <form onSubmit={(e) => { void submit(e); }} className="card p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Only signed-in users can view agents, workflows, and runs.
            </p>
          </div>

          {mode === 'signup' && (
            <label className="block">
              <span className="label">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
          )}
          <label className="block">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}
          {info && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            {mode === 'signin' ? 'Need an account?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }}
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </form>
        <p className="text-[11px] text-slate-400 text-center mt-4">
          {theme === 'dark' ? 'Dark' : 'Light'} theme follows your last studio session.
        </p>
      </div>
    </div>
  );
}
