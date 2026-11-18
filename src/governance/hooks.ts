/**
 * Late-bound hooks from the governance module into older modules (inventory,
 * monitoring, CI). The governance module imports those modules, so they cannot
 * import it back; instead it registers these functions at boot. Every hook is
 * optional: when nothing is registered (or a flag is off) callers keep their
 * previous behaviour.
 */
import type { ResolvedParameters } from './packs/pack.types';

export interface GovernanceHooks {
  /** Parameters for an organisation (enabled packs + settings, strictest wins). */
  orgPackParams?: (orgId: string | null, at?: Date) => Promise<ResolvedParameters | undefined>;
  /** Register-backed facts per model for the controls (risk register, impact assessment). */
  modelGovernanceFacts?: (modelId: string, orgId: string | null) => Promise<Record<string, any> | undefined>;
  /** Events that trigger a risk re-review (incident, drift alert, red-team finding, material change). */
  onModelEvent?: (modelId: string, event: string, detail?: Record<string, any>) => Promise<void>;
  /** Residual-risk / impact-assessment gate for a model: findings that block or warn (E1.3/E1.4). */
  gateCheck?: (modelId: string) => Promise<{ mode: string; tier: string; block: Array<{ code: string; message: string }>; warn: Array<{ code: string; message: string }> } | null>;
  /** Residual risks and limitations for the public transparency card. */
  cardGovernance?: (modelId: string) => Promise<Record<string, any> | undefined>;
  /** A CI scan saw the code of a governed model escalate to a higher risk tier (E2.8). */
  onRiskEscalation?: (modelId: string, detail: { from: string; to: string; source: string }) => Promise<void>;
  /** Extra organisation facts for ORG controls from Phase 2 registers (training, DTA register, framework review). */
  extraOrgFacts?: (orgId: string) => Promise<Record<string, any>>;
  /** Resolve a controlled document an evidence artifact points to (E1.8); undefined while the flag is off. */
  evidenceDocument?: (modelId: string, documentId: string) => Promise<{ document_id: string; version: number; hash: string } | undefined>;
}

export const governanceHooks: GovernanceHooks = {};

/** Fire a model event without letting a governance failure break the caller. */
export async function emitModelEvent(modelId: string, event: string, detail?: Record<string, any>): Promise<void> {
  try {
    await governanceHooks.onModelEvent?.(modelId, event, detail);
  } catch {
    /* governance side effects never break the originating request */
  }
}

/** Chain a model-facts provider onto the hook, keeping every earlier provider. */
export function addModelFacts(fn: (modelId: string, orgId: string | null) => Promise<Record<string, any> | undefined>): void {
  const prev = governanceHooks.modelGovernanceFacts;
  governanceHooks.modelGovernanceFacts = async (modelId, orgId) => {
    const base = (await prev?.(modelId, orgId)) ?? {};
    const more = await fn(modelId, orgId);
    const merged = { ...base, ...(more ?? {}) };
    return Object.keys(merged).length ? merged : undefined;
  };
}

/** Chain an organisation-facts provider onto the hook. */
export function addOrgFacts(fn: (orgId: string) => Promise<Record<string, any> | undefined>): void {
  const prev = governanceHooks.extraOrgFacts;
  governanceHooks.extraOrgFacts = async (orgId) => ({ ...((await prev?.(orgId)) ?? {}), ...((await fn(orgId)) ?? {}) });
}
