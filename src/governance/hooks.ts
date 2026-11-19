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
  /** E3.3: a reason the incident cannot be resolved or closed yet (senior sign-off), or null. Undefined while the flag is off. */
  incidentCloseCheck?: (incidentId: string, toStatus: string) => Promise<string | null>;
  /**
   * E3.8: the organisation's policy for sending data to external AI providers.
   * Undefined (or no hook) means calls are allowed, as before.
   */
  externalAiPolicy?: (tenantId: string | null) => Promise<ExternalAiPolicy | undefined>;
  /** E3.4: a reason a model cannot be moved to DECOMMISSIONED directly (retirement workflow), or null. */
  retirementCheck?: (modelId: string) => Promise<string | null>;
}

export interface ExternalAiPolicy {
  /** ALLOWED: as before. ATTESTED_ONLY: only providers with a current no-training attestation. BLOCKED: local endpoints only. */
  mode: 'ALLOWED' | 'ATTESTED_ONLY' | 'BLOCKED';
  /** Provider configuration ids with a current no-training attestation. */
  attestedProviderIds: string[];
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

/** Chain a transparency-card contributor onto the hook (E1.3/E1.5 residual risks, E3.5 energy). */
export function addCardFields(fn: (modelId: string) => Promise<Record<string, any> | undefined>): void {
  const prev = governanceHooks.cardGovernance;
  governanceHooks.cardGovernance = async (modelId) => {
    const merged = { ...((await prev?.(modelId)) ?? {}), ...((await fn(modelId)) ?? {}) };
    return Object.keys(merged).length ? merged : undefined;
  };
}

/** Whether an external call to `endpoint` (provider config id `providerId`, null for the platform default) is allowed. */
export function externalCallAllowed(policy: ExternalAiPolicy | undefined, isLocal: boolean, providerId: string | null): boolean {
  if (!policy || policy.mode === 'ALLOWED' || isLocal) return true;
  if (policy.mode === 'BLOCKED') return false;
  return providerId !== null && policy.attestedProviderIds.includes(providerId);
}
