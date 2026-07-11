import { homedir } from 'os';
import { resolve } from 'path';
import { statSync } from 'fs';

/** Expands a leading ~ to the user's home directory, then resolves to absolute. */
export function expandAndResolve(p: string): string {
  let out = p;
  if (out === '~') out = homedir();
  else if (out.startsWith('~/')) out = homedir() + out.slice(1);
  return resolve(out);
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(expandAndResolve(p)).isDirectory();
  } catch {
    return false;
  }
}
