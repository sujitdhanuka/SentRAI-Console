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
