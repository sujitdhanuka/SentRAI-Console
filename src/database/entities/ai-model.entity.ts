import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { largeJsonColumnType, safeJsonTransformer } from '../json-transformer';
import type { LlmRecordConfig } from '../../discovery/llm-config-detector';
import type { LlmModelsAttestation } from '../../telemetry/llm-models';

/**
 * AI model inventory entry (REC 23). Enum-valued columns are stored as
 * varchar (SQLite has no native enum); DTO validation enforces the allowed set.
 */
@Entity({ name: 'ai_models' })
export class AIModelEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  projectId!: string | null;

  @Column('varchar', { length: 255 })
  name!: string;

  @Column('varchar', { length: 50 })
  modelType!: string;

  @Column('varchar', { length: 255 })
  functionalArea!: string;

  @Column('text')
  useCaseDescription!: string;

  @Column('simple-json')
  targetCustomerSegments!: string[];

  @Column('varchar', { length: 50 })
  riskLevel!: string;

  @Column('varchar', { length: 50 })
  lifecycleStage!: string;

  @Column('varchar', { length: 255 })
  ownerTeam!: string;

  @Column('varchar', { length: 255 })
  developedBy!: string;

  @Column('datetime', { nullable: true })
  deploymentDate!: Date | null;

  @Column('simple-json')
  dependencies!: any[];

  @Column('simple-json')
  performanceBenchmarks!: any[];

  @Column('simple-json')
  sutrasAlignment!: string[];

  @Column('boolean', { default: true })
  humanOversightRequired!: boolean;

  @Column('text', { nullable: true })
  autonomousScope!: string | null;

  @Column('varchar', { length: 255 })
  boardPolicyRef!: string;

  @Column('datetime', { nullable: true })
  lastRedTeamDate!: Date | null;

  @Column('datetime', { nullable: true })
  nextAuditDue!: Date | null;

  @Column('int', { default: 0 })
  grievanceCount!: number;

  @Column('text', { default: '' })
  grievanceResolutionNotes!: string;

  @Column('varchar', { length: 500, nullable: true })
  sourceRef!: string | null;

  /** Attached evidence artifacts: bias-test reports, red-team reports, etc.
   *  `data` carries a parsed structured summary (e.g. behavioral-eval results). */
  @Column('simple-json', { nullable: true })
  evidenceArtifacts!: Array<{ type: string; ref: string; description?: string; added_at: string; data?: Record<string, any> }> | null;

  /**
   * Hardcoded secrets / credentials found in the model's source at scan time
   * (values are masked). Carried over from discovery so the security warning
   * surfaced during the scan survives into the governed inventory record.
   */
  @Column('simple-json', { nullable: true })
  securityFindings!: Array<{ type: string; masked_value: string; line: number }> | null;

  /** Provenance of useCaseDescription: 'static' (docstring), 'heuristic' (local
   *  auto-summary), 'ai' (LLM-drafted), or 'human' (edited/confirmed). Lets the
   *  UI flag an unreviewed AI/auto draft. Null = legacy/unknown (treat as static). */
  @Column('varchar', { length: 20, nullable: true })
  descriptionSource!: string | null;

  /** The model that produced an AI description, e.g. 'claude-sonnet-5'. */
  @Column('varchar', { length: 100, nullable: true })
  descriptionModel!: string | null;

  /** Unique static-analysis signal categories from discovery (llm_api,
   *  decision_function, …) — evidence for summaries and risk rationale. */
  @Column('simple-json', { nullable: true })
  detectionSignals!: string[] | null;

  /** Tools/capabilities the model is DETECTED using in source (Pillar 2 —
   *  Control): `capability:shell`, `tool:transfer_funds`, … Refreshed on scan. */
  @Column('simple-json', { nullable: true })
  detectedTools!: string[] | null;

  /** Tools/capabilities the model is AUTHORIZED to use (declared governance).
   *  A detected tool outside this set is an authorization violation. */
  @Column('simple-json', { nullable: true })
  permittedTools!: string[] | null;

  /** Where the scan found this record's LLM models named or stored (schema
   *  columns, settings keys, env vars, defaults, seeds). Refreshed on scan. */
  @Column({ type: largeJsonColumnType(), nullable: true, transformer: safeJsonTransformer })
  llmConfig!: LlmRecordConfig | null;

  /** The per-task LLM models an owner confirmed are in use. Runtime llm_call
   *  telemetry outside this list is flagged. */
  @Column('simple-json', { nullable: true })
  llmModels!: LlmModelsAttestation | null;

  /** Deliberate operational control state (kill switch): ACTIVE | SUSPENDED.
   *  Distinct from the drift-driven BCP fallback — this is an operator action. */
  @Column('varchar', { length: 20, default: 'ACTIVE' })
  operationalState!: string;

  @Column('varchar', { length: 500, nullable: true })
  operationalStateReason!: string | null;

  @Column('datetime', { nullable: true })
  operationalStateSince!: Date | null;

  /** Auditor-facing justification of the assigned risk level, with the same
   *  provenance scheme as the description ('heuristic' | 'ai' | 'human'). */
  @Column('text', { nullable: true })
  riskRationale!: string | null;

  @Column('varchar', { length: 20, nullable: true })
  riskRationaleSource!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  riskRationaleModel!: string | null;

  /** Remediation plan covering every open framework gap, same provenance scheme. */
  @Column('text', { nullable: true })
  gapRemediation!: string | null;

  @Column('varchar', { length: 20, nullable: true })
  gapRemediationSource!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  gapRemediationModel!: string | null;

  /** The gap lines the remediation plan was drafted for, so a later read can tell it is out of date. */
  @Column('simple-json', { nullable: true })
  gapRemediationGaps!: string[] | null;

  /**
   * Every file this model was discovered in. A scan often finds the same model
   * defined or invoked in several places; those are merged into one governed
   * record rather than dropped, so the inventory count matches what the scan
   * actually found. sourceRef stays the primary/first file for compatibility.
   */
  @Column('simple-json', { nullable: true })
  sourceRefs!: string[] | null;

  /** Every file this model was discovered in, with the line numbers of the
   *  evidence found there (signals, tool calls, secrets). Refreshed on scan. */
  @Column('simple-json', { nullable: true })
  sourceLocations!: Array<{ file: string; lines: number[] }> | null;

  /** Audit trail of merges: which file was folded in, when, and by what match. */
  @Column('simple-json', { nullable: true })
  mergeHistory!: Array<{ source_ref: string; merged_at: string; matched_on: string }> | null;

  /** Structured context profile (intended users, limitations, oversight pattern, ...) — governance E1.5. */
  @Column('simple-json', { nullable: true })
  contextProfile!: Record<string, any> | null;

  /** Feature → Reg B reason code map for adverse-action notices (governance E2.2). */
  @Column('simple-json', { nullable: true })
  reasonCodeMap!: Record<string, { code: string; text: string }> | null;

  /** Which sign of a feature contribution pushes this model towards the adverse outcome: POSITIVE or NEGATIVE (governance E2.2). */
  @Column('varchar', { length: 10, nullable: true })
  reasonCodeSign!: string | null;

  /** SR 26-2 model-risk scope (governance E2.3); null until decided. */
  @Column('boolean', { nullable: true })
  mrmInScope!: boolean | null;

  @Column('varchar', { length: 500, nullable: true })
  mrmExclusionReason!: string | null;

  /** Set when the CI gate sees a risk escalation (governance E2.8); cleared by a later red-team exercise. */
  @Column('datetime', { nullable: true })
  redTeamRequiredAt!: Date | null;

  @Column('varchar', { length: 500, nullable: true })
  redTeamRequiredReason!: string | null;

  /** Named accountable owner (a user) in addition to ownerTeam — governance E1.9. */
  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  /** Governance E3.5: measured energy use (kWh) and emissions (kg CO2e), summed over recorded readings. */
  @Column('double', { nullable: true })
  energyKwh!: number | null;

  @Column('double', { nullable: true })
  co2eKg!: number | null;

  @Column('boolean', { default: true })
  isActive!: boolean;

  @Column('datetime')
  registeredAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
