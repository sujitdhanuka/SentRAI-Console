import { LogIn } from 'lucide-react';
import { FormEvent, useState } from 'react';

import { useSession } from '../stores/session';

const FIELD =
  'w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-[12px] text-text placeholder:text-text-tertiary focus:border-accent';

/** The console's own sign-in — the React app is self-sufficient; it no longer
 *  bounces to the classic console to authenticate. */
export function Login() {
  const { login, busy, error } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await login(username, password).catch(() => undefined); // error surfaces in the store
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg px-4 font-ui text-text">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent font-heading text-lg font-bold text-white">
            S
          </div>
          <h1 className="font-heading text-[15px] font-medium">sentRAI Console</h1>
          <p className="text-center text-[11px] text-text-secondary">
            AI governance · RBI FREE-AI · NIST AI RMF · EU AI Act · ISO 42001
          </p>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-border bg-surface p-4">
          <label className="mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Email</label>
          <input
            className={`${FIELD} mb-3`}
            type="email"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="you@organization"
          />
          <label className="mb-1 block text-[9px] font-medium uppercase tracking-widest text-text-tertiary">Password</label>
          <input
            className={`${FIELD} mb-4`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && (
            <p className="mb-3 rounded border border-negative bg-negative-soft px-2 py-1.5 text-[11px] text-negative" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent py-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <LogIn size={14} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          <a href="?demo=1" className="hover:text-accent">View with demo data</a>
          <span className="mx-1.5">·</span>
          <a href="/console" className="hover:text-accent">Classic console</a>
        </p>
      </div>
    </div>
  );
}
