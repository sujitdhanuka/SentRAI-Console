/**
 * Model card v2: record types, relationships and the four state fields.
 *
 * A card documents one record. A record is no longer assumed to be "a model":
 * a settings screen that picks the default LLM is a MODEL_CONFIGURATION, and
 * its card links to the AI_MODEL records it can select. The scanner's
 * `modelType` (GENERATIVE_AI, ...) stays as a detection signal and is never
 * used as the record type.
 *
 * Pure: no database access, so the rules are unit tested directly.
 */

export const RECORD_TYPES = ['AI_MODEL', 'AI_SYSTEM', 'AI_COMPONENT', 'MODEL_CONFIGURATION', 'AGENT', 'RAG_PIPELINE'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Edges of the record graph. `from` is the record whose card shows the link. */
export const RELATIONS = ['uses_model', 'selects_model', 'part_of_system', 'retrieves_from', 'calls_tool', 'overrides'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Which record types a relation may point to (`null` = any record type). */
export const RELATION_TARGETS: Record<Relation, readonly RecordType[] | null> = {
  uses_model: ['AI_MODEL'],
  selects_model: ['AI_MODEL'],
  part_of_system: ['AI_SYSTEM'],
  retrieves_from: ['RAG_PIPELINE', 'AI_COMPONENT'],
  calls_tool: null,
  overrides: ['MODEL_CONFIGURATION'],
};

/** The four state fields (spec §4). Each is a separate catalogue field. */
export const COMPONENT_LIFECYCLE = ['PLANNED', 'IN_DEVELOPMENT', 'IN_TEST', 'RELEASED', 'DEPRECATED', 'RETIRED'] as const;
/** Model lifecycle reuses the inventory's existing stages (ai_models.lifecycleStage). */
export const MODEL_LIFECYCLE = ['DESIGN', 'DEVELOPMENT', 'VALIDATION', 'DEPLOYED', 'MONITORING', 'DECOMMISSIONED'] as const;
export const DEPLOYMENT_STATUS = ['NOT_DEPLOYED', 'DEPLOYED_NON_PRODUCTION', 'DEPLOYED_PRODUCTION', 'WITHDRAWN'] as const;
/** Operational status reuses ai_models.operationalState (the kill switch). */
export const OPERATIONAL_STATUS = ['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;

export type ComponentLifecycle = (typeof COMPONENT_LIFECYCLE)[number];
export type ModelLifecycle = (typeof MODEL_LIFECYCLE)[number];
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];
export type OperationalStatus = (typeof OPERATIONAL_STATUS)[number];

export const isRecordType = (v: unknown): v is RecordType => typeof v === 'string' && (RECORD_TYPES as readonly string[]).includes(v);
export const isRelation = (v: unknown): v is Relation => typeof v === 'string' && (RELATIONS as readonly string[]).includes(v);

/** Is `target` an allowed end for this relation? */
export function relationAllows(relation: Relation, target: RecordType | null): boolean {
  const allowed = RELATION_TARGETS[relation];
  if (allowed === null) return true;
  return target !== null && allowed.includes(target);
}

/** What a record-type suggestion is based on. */
export interface RecordTypeFacts {
  name: string;
  modelType: string | null;
  sourceRefs: string[];
  detectionSignals: string[];
  detectedTools: string[];
  /** A SentRAI provider configuration points at this record. */
  linkedFromProviderConfig?: boolean;
}

export interface RecordTypeSuggestion {
  type: RecordType | null;
  /** Plain-language reasons, shown with the CODE_SCAN suggestion. */
  reasons: string[];
}

const CONFIG_WORDS = /(setting|settings|config|configuration|preference|selector|picker|byok)/i;
const RAG_WORDS = /(rag|retriev|vector|embedding[_ -]?store|knowledge[_ -]?base|chunk)/i;
const UI_FILE = /\.(tsx|jsx|vue|svelte)$/i;

/**
 * A CODE_SCAN suggestion of the record type. It is never applied as an
 * accepted value: a person accepts or changes it on the card. Returns
 * `type: null` when nothing points clearly at one type.
 */
export function suggestRecordType(f: RecordTypeFacts): RecordTypeSuggestion {
  const files = f.sourceRefs ?? [];
  const words = [f.name, ...files].join(' ');
  const reasons: string[] = [];

  if (CONFIG_WORDS.test(words)) {
    reasons.push(`The name or source path suggests a settings or configuration component (${f.name}).`);
    if (files.some((p) => UI_FILE.test(p))) reasons.push('The source is a user-interface file, not model code.');
    if (f.modelType) reasons.push(`The scanner's detected type (${f.modelType}) describes the models it selects, not the record itself.`);
    return { type: 'MODEL_CONFIGURATION', reasons };
  }
  if (f.modelType === 'AGENT' || (f.detectedTools ?? []).length > 0) {
    reasons.push(f.modelType === 'AGENT' ? 'The scanner detected an agent.' : `Tool use was detected (${f.detectedTools.join(', ')}).`);
    return { type: 'AGENT', reasons };
  }
  if (RAG_WORDS.test([words, ...(f.detectionSignals ?? [])].join(' '))) {
    reasons.push('Retrieval or vector-store signals were detected.');
    return { type: 'RAG_PIPELINE', reasons };
  }
  if (f.linkedFromProviderConfig) {
    reasons.push('A provider configuration in SentRAI points at this record.');
    return { type: 'AI_MODEL', reasons };
  }
  return { type: null, reasons: ['Nothing in the scan points clearly at one record type; a person must classify it.'] };
}
