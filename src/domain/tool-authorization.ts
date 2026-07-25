/**
 * Static tool authorization (Roadmap Pillar 2 — Control).
 *
 * Given the tools a model is *permitted* to use (declared governance) and the
 * tools it is *detected* using (from the static scan), decide whether it is
 * operating within its sanctioned capability boundary. This is the check the CI
 * gate and the console both run — the enforcement point that makes "declare
 * what your agent may do, and we'll fail the build if it does more" real.
 */

export interface ToolAuthorization {
  permitted: string[];
  detected: string[];
  /** Detected tools that are NOT in the permitted set — the violations. */
  unauthorized: string[];
  /** Detected tools that ARE permitted — the sanctioned surface actually used. */
  authorized: string[];
  /** True when tools are detected but nothing is permitted yet — scope undeclared. */
  undeclared: boolean;
  /** Convenience: the model is fully within its authorized boundary. */
  compliant: boolean;
}

const norm = (list?: string[] | null): string[] =>
  [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))];

export function authorizeTools(permittedRaw?: string[] | null, detectedRaw?: string[] | null): ToolAuthorization {
  const permitted = norm(permittedRaw);
  const detected = norm(detectedRaw);
  const permittedSet = new Set(permitted);

  const unauthorized = detected.filter((t) => !permittedSet.has(t));
  const authorized = detected.filter((t) => permittedSet.has(t));
  const undeclared = detected.length > 0 && permitted.length === 0;

  return {
    permitted,
    detected,
    unauthorized,
    authorized,
    undeclared,
    // Compliant = no unauthorized tool use. (Undeclared implies unauthorized,
    // so this also covers "used tools without declaring any".)
    compliant: unauthorized.length === 0,
  };
}
