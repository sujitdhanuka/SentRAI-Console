import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { InventoryDashboard } from './pages/InventoryDashboard';
import { isDemoMode } from './providers';
import { useConsoleUi } from './stores/consoleUi';

/** Live mode reuses the classic console's JWT (same origin, same localStorage
 *  key) — so /console sign-in IS the dashboard sign-in. */
function AuthGate() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent font-heading text-xl font-bold text-white">S</div>
      <h1 className="font-heading text-lg font-medium">sentRAI Console · Model Inventory</h1>
      <p className="max-w-sm text-center text-[12px] text-text-secondary">
        Sign in through the SentRAI Console first — this dashboard reuses your console session.
      </p>
      <div className="flex gap-2">
        <a href="/console" className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
          <ShieldCheck size={14} /> Open console to sign in
        </a>
        <a href="?demo=1" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover">
          <ExternalLink size={14} /> View with demo data
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const theme = useConsoleUi((s) => s.theme);
  const [authed, setAuthed] = useState(() => Boolean(localStorage.getItem('sentrai_access_token')));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    // Re-check when returning from the console sign-in tab.
    const onFocus = () => setAuthed(Boolean(localStorage.getItem('sentrai_access_token')));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  if (!isDemoMode && !authed) return <AuthGate />;
  return <InventoryDashboard />;
}
