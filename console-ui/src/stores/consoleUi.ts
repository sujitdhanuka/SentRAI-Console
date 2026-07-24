import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type EnvFilter = 'All' | 'PROD' | 'STAGING' | 'DEV';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'positive' | 'negative';
}

interface ConsoleUiState {
  theme: Theme;
  env: EnvFilter;
  selectedId: string | null;
  drawerOpen: boolean;
  grievanceOpen: boolean;
  toasts: Toast[];
  toggleTheme(): void;
  setEnv(env: EnvFilter): void;
  select(id: string): void;
  setDrawer(open: boolean): void;
  setGrievance(open: boolean): void;
  toast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

let toastSeq = 1;
// Paper is the default reading world (SR-DL-001); the plate world is opt-in dark.
const storedTheme = (localStorage.getItem('sentrai-theme') as Theme | null) ?? 'light';

export const useConsoleUi = create<ConsoleUiState>((set, get) => ({
  theme: storedTheme,
  env: 'All',
  selectedId: null,
  drawerOpen: false,
  grievanceOpen: false,
  toasts: [],

  toggleTheme() {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('sentrai-theme', theme);
    set({ theme });
  },
  setEnv(env) {
    set({ env });
  },
  select(id) {
    set({ selectedId: id });
  },
  setDrawer(open) {
    set({ drawerOpen: open });
  },
  setGrievance(open) {
    set({ grievanceOpen: open });
  },
  toast(message, tone = 'info') {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
