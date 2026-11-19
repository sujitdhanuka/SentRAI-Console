/**
 * The single HTTP seam for the console. Every page uses this — it attaches the
 * bearer token, normalizes errors to readable messages, and clears the session
 * on 401 so the app falls back to the login screen instead of looping.
 */

export const API = '/api/v1';
export const TOKEN_KEY = 'sentrai_access_token';
export const USER_KEY = 'sentrai_user';
/** Organization of the selected project scope. A global OWNER/ADMIN works in
 *  that organization's governance; the server ignores it for org members. */
export const ACTIVE_ORG_KEY = 'sentrai_active_org_id';
/** The selected project scope. Governance lists and overviews show only this
 *  project's models (plus organisation-level records) while it is set. */
export const ACTIVE_PROJECT_KEY = 'sentrai_active_project_id';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  const org = localStorage.getItem(ACTIVE_ORG_KEY);
  const project = localStorage.getItem(ACTIVE_PROJECT_KEY);
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(org ? { 'X-SentrAI-Org': org } : {}),
    ...(project ? { 'X-SentrAI-Project': project } : {}),
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const m = body?.message ?? body?.error;
    return Array.isArray(m) ? m.join(', ') : String(m ?? `Request failed (${res.status})`);
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...init?.headers },
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('sentrai:signed-out'));
    throw new ApiError('Session expired — sign in again.', 401);
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Multipart upload (codebase zip / folder) — no JSON content-type. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: authHeader(), body: form });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return res.json() as Promise<T>;
}

/** Authenticated file download → object URL (PDF exports). */
export async function apiBlobUrl(path: string, method: 'GET' | 'POST' = 'GET'): Promise<string> {
  const res = await fetch(`${API}${path}`, method === 'POST'
    ? { method, headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: '{}' }
    : { headers: authHeader() });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return URL.createObjectURL(await res.blob());
}
