/**
 * Model card v2: the field catalogue format (spec §3).
 *
 * One declarative catalogue drives the form, validation, applicability,
 * scoring, framework mapping and the PDF. Entries are data. A change to an
 * existing field is a new CATALOGUE_VERSION, and every card records the
 * version it was assessed against.
 */
import { RecordType, RECORD_TYPES } from '../record-types';

export const CATALOGUE_VERSION = '2.0.0';

export type Requirement = 'MANDATORY' | 'CONDITIONAL' | 'RECOMMENDED';

/**
 * - text / longtext: free text (longtext may hold Markdown)
 * - enum / multi: one or several of allowed_values
 * - tristate: YES | NO | UNKNOWN (personal data and other facts that must not be guessed)
 * - date, number, url, boolean
 * - user: a user id (owner fields: a named human, see owners.ts)
 * - records: ids of other records (links)
 * - list: a list of short strings
 * - table: rows with the typed columns in `columns`
 * - count: a metric that distinguishes ZERO_RECORDED, NO_DATA and NOT_MONITORED (defect D9)
 */
export type DataType = 'text' | 'longtext' | 'enum' | 'multi' | 'tristate' | 'date' | 'number' | 'url' | 'boolean' | 'user' | 'records' | 'list' | 'table' | 'count';

export const TRISTATE = ['YES', 'NO', 'UNKNOWN'] as const;
export const COUNT_STATES = ['ZERO_RECORDED', 'RECORDED', 'NO_DATA', 'NOT_MONITORED'] as const;

export interface ColumnDef {
  key: string;
  label: string;
  data_type: Exclude<DataType, 'table' | 'records'>;
  allowed_values?: readonly string[];
  required?: boolean;
}

export interface EvidenceSpec {
  required: boolean;
  /** Evidence type id; its freshness window is configured in governance settings. */
  type?: string;
}

export interface FieldDef {
  field_id: string;
  section_id: string;
  label: string;
  help_text: string;
  data_type: DataType;
  allowed_values?: readonly string[];
  columns?: ColumnDef[];
  applies_to_record_types: readonly RecordType[];
  /** Rule that makes a CONDITIONAL field mandatory (applicability/rules.ts). */
  applicability_rule_id: string | null;
  default_requirement: Requirement;
  evidence_required: EvidenceSpec;
  /** "<frameworkId>:<controlId>" entries of the framework registry. */
  framework_control_refs: readonly string[];
  sensitive: boolean;
  triggers_reassessment: boolean;
  /** Narrative field the suggestion engine may draft (never risk tier, classification, applicability or compliance). */
  ai_suggestable: boolean;
  /** Read from an existing register (provenance INTEGRATION) instead of typed on the card. */
  source_register: string | null;
  catalogue_version: string;
}

export interface SectionDef {
  section_id: string;
  number: number;
  title: string;
  /** Rule that makes the whole section applicable; null = always applicable. */
  applicability_rule_id: string | null;
  fields: FieldDef[];
}

export interface FieldOpts {
  values?: readonly string[];
  columns?: ColumnDef[];
  req?: Requirement;
  rule?: string;
  rt?: readonly RecordType[];
  ev?: string;
  refs?: readonly string[];
  sensitive?: boolean;
  reassess?: boolean;
  suggest?: boolean;
  register?: string;
}

/** Builds the fields of one section with the catalogue's defaults (applies to every record type, RECOMMENDED). */
export function sectionFields(section_id: string, rows: Array<[string, string, DataType, string, FieldOpts?]>): FieldDef[] {
  return rows.map(([id, label, data_type, help_text, o = {}]) => ({
    field_id: id,
    section_id,
    label,
    help_text,
    data_type,
    ...(o.values ? { allowed_values: o.values } : data_type === 'tristate' ? { allowed_values: TRISTATE } : {}),
    ...(o.columns ? { columns: o.columns } : {}),
    applies_to_record_types: o.rt ?? RECORD_TYPES,
    applicability_rule_id: o.rule ?? null,
    default_requirement: o.req ?? (o.rule ? 'CONDITIONAL' : 'RECOMMENDED'),
    evidence_required: o.ev ? { required: true, type: o.ev } : { required: false },
    framework_control_refs: o.refs ?? [],
    sensitive: o.sensitive ?? false,
    triggers_reassessment: o.reassess ?? false,
    ai_suggestable: o.suggest ?? false,
    source_register: o.register ?? null,
    catalogue_version: CATALOGUE_VERSION,
  }));
}

/** Shorthands used by the section files. */
export const M: Requirement = 'MANDATORY';
export const R: Requirement = 'RECOMMENDED';
export const MODEL_LIKE: readonly RecordType[] = ['AI_MODEL', 'AI_SYSTEM', 'AGENT', 'RAG_PIPELINE'];
export const WITH_TRAINING: readonly RecordType[] = ['AI_MODEL', 'AI_SYSTEM'];
