import * as yaml from 'js-yaml';

/**
 * Policy-as-code contract, read from `.sentrai/policy.yaml` in the scanned repo.
 * A gate rule fails the build when a detected model of the given severity is
 * missing any of the listed governance requirements.
 */
export interface PolicyContract {
  gates: {
    block_on: Array<{
      severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL';
      missing: string[];
    }>;
    frameworks: string[];
  };
}

/** Governance requirement keys a policy may reference in `missing:`. */
export const KNOWN_REQUIREMENTS = [
  'registered', // a governed model exists for this asset (not shadow AI)
  'owner_team',
  'board_policy_ref',
  'human_oversight',
  'bias_test_evidence',
  'red_team_evidence',
] as const;

export function defaultPolicy(): PolicyContract {
  return {
    gates: {
      block_on: [
        { severity: 'CRITICAL', missing: ['registered', 'owner_team', 'board_policy_ref'] },
        { severity: 'HIGH', missing: ['registered', 'owner_team', 'board_policy_ref'] },
      ],
      frameworks: ['eu_ai_act', 'nist_ai_rmf'],
    },
  };
}

/**
 * Parse a policy.yaml string into a validated PolicyContract, falling back to
 * the default policy on any malformed or missing input (fail-safe: a broken
 * policy file must not silently disable the gate).
 */
export function parsePolicy(raw: string | undefined): { policy: PolicyContract; usedDefault: boolean } {
  if (!raw || !raw.trim()) return { policy: defaultPolicy(), usedDefault: true };
  try {
    const parsed = yaml.load(raw) as Partial<PolicyContract> | undefined;
    const rules = parsed?.gates?.block_on;
    if (!parsed?.gates || !Array.isArray(rules) || rules.length === 0) {
      return { policy: defaultPolicy(), usedDefault: true };
    }
    // Normalize/whitelist to guard against arbitrary YAML shapes.
    const block_on = rules
      .filter((r) => r && typeof r.severity === 'string' && Array.isArray(r.missing))
      .map((r) => ({
        severity: String(r.severity).toUpperCase() as PolicyContract['gates']['block_on'][number]['severity'],
        missing: r.missing.map((m) => String(m)),
      }));
    if (block_on.length === 0) return { policy: defaultPolicy(), usedDefault: true };
    return {
      policy: { gates: { block_on, frameworks: Array.isArray(parsed.gates.frameworks) ? parsed.gates.frameworks.map(String) : [] } },
      usedDefault: false,
    };
  } catch {
    return { policy: defaultPolicy(), usedDefault: true };
  }
}
