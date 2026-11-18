import { create } from 'zustand';

import { ACTIVE_ORG_KEY, api, TOKEN_KEY, USER_KEY } from '../api/client';

export interface SessionUser {
  email: string;
  role: string;
  name?: string;
  tenant_id?: string | null;
}

interface LoginResponse {
  access_token: string;
  user?: SessionUser;
}

interface SessionState {
  user: SessionUser | null;
  authed: boolean;
  busy: boolean;
  error: string | null;
  /** The project currently scoping the console (null = all projects). */
  activeProjectId: string | null;
  activeProjectName: string | null;
  /** Organization that owns the scoped project (null = unknown or none). */
  activeOrgId: string | null;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  hydrate(): void;
  setActiveProject(id: string | null, name?: string | null, orgId?: string | null): void;
  setActiveOrg(orgId: string | null): void;
}

const readUser = (): SessionUser | null => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
};

export const useSession = create<SessionState>((set) => ({
  user: readUser(),
  authed: Boolean(localStorage.getItem(TOKEN_KEY)),
  busy: false,
  error: null,
  activeProjectId: localStorage.getItem('sentrai_active_project_id') || null,
  activeProjectName: localStorage.getItem('sentrai_active_project_name') || null,
  activeOrgId: localStorage.getItem(ACTIVE_ORG_KEY) || null,

  async login(username, password) {
    set({ busy: true, error: null });
    try {
      const res = await api<LoginResponse>('/auth/token', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem(TOKEN_KEY, res.access_token);
      // The classic console stores the same keys — sessions stay interchangeable.
      const me = await api<SessionUser>('/auth/me').catch(() => res.user ?? { email: username, role: 'VIEWER' });
      localStorage.setItem(USER_KEY, JSON.stringify(me));
      set({ authed: true, user: me, busy: false });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : 'Sign-in failed' });
      throw e;
    }
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ authed: false, user: null });
  },

  hydrate() {
    set({ authed: Boolean(localStorage.getItem(TOKEN_KEY)), user: readUser() });
  },

  setActiveProject(id, name, orgId) {
    if (id) {
      localStorage.setItem('sentrai_active_project_id', id);
      localStorage.setItem('sentrai_active_project_name', name ?? '');
    } else {
      localStorage.removeItem('sentrai_active_project_id');
      localStorage.removeItem('sentrai_active_project_name');
    }
    if (id && orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    else localStorage.removeItem(ACTIVE_ORG_KEY);
    set({ activeProjectId: id, activeProjectName: name ?? null, activeOrgId: (id && orgId) || null });
  },

  setActiveOrg(orgId) {
    if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    else localStorage.removeItem(ACTIVE_ORG_KEY);
    set({ activeOrgId: orgId });
  },
}));
