import { Plus, Trash2 } from 'lucide-react';

import { Button } from '../components/ui/Button';
import { fieldClass as FIELD, labelClass as LABEL } from '../components/ui/form';

/**
 * Form fields for each AIMS record type. The form edits the same content
 * object the API stores (and checkContent in aims.model.ts validates), so
 * people fill in labelled boxes and SentRAI writes the JSON.
 */

type Leaf = 'text' | 'textarea' | 'date' | 'bool';
export interface FieldDef {
  key: string;
  label: string;
  kind: Leaf | 'list' | 'items';
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** For kind 'items': the fields of each row. */
  item?: FieldDef[];
  /** For kind 'items': a new row. */
  blank?: Record<string, any>;
  /** For kind 'items': singular name for the add button. */
  noun?: string;
}
export interface FieldGroup { title?: string; note?: string; path?: string; fields: FieldDef[] }

const ISO_POLICY: FieldDef[] = [
  { key: 'purpose_alignment', label: 'Purpose of the organisation and how AI fits it', kind: 'textarea', required: true },
  { key: 'objectives_framework', label: 'Framework for setting AI objectives', kind: 'textarea', required: true },
  { key: 'requirements_commitment', label: 'Commitment to meet applicable requirements', kind: 'textarea', required: true },
  { key: 'continual_improvement', label: 'Commitment to continual improvement of the AIMS', kind: 'textarea', required: true },
];
const RBI_POLICY: FieldDef[] = [
  { key: 'governance_structure', label: 'Governance structure', kind: 'textarea' },
  { key: 'accountability', label: 'Accountability', kind: 'textarea' },
  { key: 'risk_appetite', label: 'Risk appetite', kind: 'textarea' },
  { key: 'operational_safeguards', label: 'Operational safeguards', kind: 'textarea' },
  { key: 'auditability', label: 'Auditability', kind: 'textarea' },
  { key: 'consumer_protection', label: 'Consumer protection', kind: 'textarea' },
  { key: 'ai_disclosures', label: 'AI disclosures', kind: 'textarea' },
  { key: 'model_lifecycle', label: 'Model lifecycle', kind: 'textarea' },
  { key: 'liability', label: 'Liability', kind: 'textarea' },
];
const PERSON: FieldDef[] = [
  { key: 'person_or_role', label: 'Person or role', kind: 'text', required: true, placeholder: 'e.g. Model risk analysts' },
  { key: 'evidence', label: 'Evidence', kind: 'textarea', required: true, help: 'What shows it, for example a certificate, an assessment or a signed acknowledgement, and where it is kept.' },
  { key: 'date', label: 'Date', kind: 'date' },
];
const DESCRIPTION: FieldDef[] = [{ key: 'description', label: 'Description', kind: 'textarea', required: true }];

export const AIMS_FORMS: Record<string, FieldGroup[]> = {
  SCOPE: [{ fields: [
    { key: 'boundaries', label: 'Boundaries', kind: 'textarea', required: true, help: 'Which parts of the organisation, sites, products and activities the AI management system covers.' },
    { key: 'ai_systems', label: 'AI systems in scope', kind: 'textarea', required: true, help: 'The AI systems or families of models covered, for example "all customer-facing credit and fraud models".' },
    { key: 'exclusions', label: 'Exclusions', kind: 'textarea', help: 'Anything deliberately left out.' },
    { key: 'justification', label: 'Justification for exclusions', kind: 'textarea' },
  ] }],
  POLICY: [
    { title: 'ISO/IEC 42001 clause 5.2', note: 'All four are required.', path: 'sections', fields: ISO_POLICY },
    { title: 'RBI FREE-AI Recommendation 14', note: 'What a board-approved AI policy should set out. Needed when the RBI pack is in force.', path: 'sections', fields: RBI_POLICY },
  ],
  CONTEXT: [{ fields: [
    { key: 'internal_issues', label: 'Internal issues', kind: 'textarea', required: true, help: 'Culture, capabilities, systems and constraints inside the organisation that affect AI.' },
    { key: 'external_issues', label: 'External issues', kind: 'textarea', required: true, help: 'Regulation, market, customers, technology and suppliers.' },
    { key: 'climate_change_relevant', label: 'Climate change is a relevant issue (ISO amendment 2024)', kind: 'bool' },
  ] }],
  INTERESTED_PARTY: [{ fields: [
    { key: 'party', label: 'Interested party', kind: 'text', required: true, placeholder: 'e.g. Retail borrowers, RBI, internal audit' },
    { key: 'needs', label: 'Their needs and expectations', kind: 'textarea', required: true },
    { key: 'requirements', label: 'Which of these become requirements for the AIMS', kind: 'textarea' },
  ] }],
  OBJECTIVE: [{ fields: [
    { key: 'objective', label: 'Objective', kind: 'text', required: true, placeholder: 'e.g. Every HIGH-risk model red-teamed before go-live' },
    { key: 'measure', label: 'How it is measured', kind: 'text', required: true },
    { key: 'target', label: 'Target', kind: 'text', required: true, placeholder: 'e.g. 100%' },
    { key: 'due_date', label: 'Due date', kind: 'date' },
  ] }],
  MGMT_REVIEW: [{ fields: [
    { key: 'review_date', label: 'Date the review was held', kind: 'date', required: true, help: 'Record a review after it happens. The date cannot be in the future.' },
    { key: 'attendees', label: 'Attendees', kind: 'list', placeholder: 'Name or role' },
    { key: 'decisions', label: 'Decisions', kind: 'list', placeholder: 'A decision the review took' },
    {
      key: 'actions', label: 'Actions', kind: 'items', noun: 'action', help: 'Each action becomes a corrective action when the review is approved.',
      blank: { action: '', nonconformity: '', due_at: '' },
      item: [
        { key: 'action', label: 'Action', kind: 'text', required: true },
        { key: 'nonconformity', label: 'Issue it addresses', kind: 'text' },
        { key: 'due_at', label: 'Due', kind: 'date' },
      ],
    },
  ] }],
  AUDIT_PROGRAMME: [{ fields: [
    { key: 'period', label: 'Period covered', kind: 'text', required: true, placeholder: 'e.g. FY 2026-27' },
    {
      key: 'audits', label: 'Planned audits', kind: 'items', noun: 'audit', required: true,
      help: 'ISO 9.2: an auditor cannot audit their own work, so each auditor must be independent of the area.',
      blank: { area: '', planned_date: '', auditor: '', auditor_independent: true, objectivity_note: '' },
      item: [
        { key: 'area', label: 'Area', kind: 'text', required: true },
        { key: 'planned_date', label: 'Planned date', kind: 'date', required: true },
        { key: 'auditor', label: 'Auditor', kind: 'text', required: true },
        { key: 'auditor_independent', label: 'Auditor is independent of this area', kind: 'bool' },
        { key: 'objectivity_note', label: 'How objectivity is kept', kind: 'text' },
      ],
    },
  ] }],
  RESOURCE: [{ fields: DESCRIPTION }],
  COMMUNICATION: [{ fields: DESCRIPTION }],
  CHANGE: [{ fields: DESCRIPTION }],
  COMPETENCE: [{ fields: PERSON }],
  AWARENESS: [{ fields: PERSON }],
};

/** A new record's content: every field present, so nothing the API checks is missing. */
export function blankContent(type: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const g of AIMS_FORMS[type] ?? []) {
    const target = g.path ? (out[g.path] ??= {}) : out;
    for (const f of g.fields) {
      target[f.key] = f.kind === 'bool' ? false : f.kind === 'list' ? [] : f.kind === 'items' ? (f.required ? [{ ...f.blank }] : []) : '';
    }
  }
  if (type === 'MGMT_REVIEW') out.review_date = new Date().toISOString().slice(0, 10);
  return out;
}

/** Required fields still empty, as labels, so Save can say what is missing. */
export function missingFields(type: string, content: Record<string, any>): string[] {
  const miss: string[] = [];
  const empty = (v: any) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  for (const g of AIMS_FORMS[type] ?? []) {
    const src = g.path ? content[g.path] ?? {} : content;
    for (const f of g.fields) {
      if (f.required && empty(src[f.key])) miss.push(f.label);
      if (f.kind === 'items') (src[f.key] ?? []).forEach((row: any, i: number) => {
        for (const sub of f.item ?? []) if (sub.required && empty(row?.[sub.key])) miss.push(`${f.noun ?? 'row'} ${i + 1}: ${sub.label}`);
      });
    }
  }
  return miss;
}

function LeafInput({ f, value, onChange, id }: { f: FieldDef; value: any; onChange: (v: any) => void; id: string }) {
  if (f.kind === 'bool') {
    return (
      <label className="flex items-center gap-1.5 text-[11px] text-text" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {f.label}
      </label>
    );
  }
  if (f.kind === 'textarea') return <textarea id={id} rows={3} className={FIELD} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  return <input id={id} type={f.kind === 'date' ? 'date' : 'text'} className={FIELD} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

function Label({ f, htmlFor }: { f: FieldDef; htmlFor?: string }) {
  return (
    <label className={LABEL} htmlFor={htmlFor}>
      {f.label}{f.required && <span className="text-negative"> *</span>}
    </label>
  );
}

function Field({ f, value, onChange, idPrefix }: { f: FieldDef; value: any; onChange: (v: any) => void; idPrefix: string }) {
  const id = `${idPrefix}-${f.key}`;
  const help = f.help && <p className="mt-0.5 text-[10px] text-text-tertiary">{f.help}</p>;
  if (f.kind === 'bool') return <div><LeafInput f={f} value={value} onChange={onChange} id={id} />{help}</div>;
  if (f.kind === 'list') {
    const list: string[] = Array.isArray(value) ? value : [];
    return (
      <div>
        <Label f={f} />
        <div className="space-y-1">
          {list.map((v, i) => (
            <div key={i} className="flex gap-1">
              <input aria-label={`${f.label} ${i + 1}`} className={FIELD} placeholder={f.placeholder} value={v} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button size="xs" variant="ghost" aria-label={`Remove ${f.label} ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={11} /></Button>
            </div>
          ))}
          <Button size="xs" variant="ghost" onClick={() => onChange([...list, ''])}><Plus size={10} /> Add</Button>
        </div>
        {help}
      </div>
    );
  }
  if (f.kind === 'items') {
    const rows: Array<Record<string, any>> = Array.isArray(value) ? value : [];
    return (
      <div>
        <Label f={f} />
        {help}
        <div className="mt-1 space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="rounded border border-border p-2">
              <div className="mb-1 flex items-center">
                <span className="font-mono text-[9.5px] text-text-tertiary">{f.noun ?? 'row'} {i + 1}</span>
                <Button className="ml-auto" size="xs" variant="ghost" aria-label={`Remove ${f.noun ?? 'row'} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 size={11} /></Button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(f.item ?? []).map((sub) => (
                  <div key={sub.key} className={sub.kind === 'bool' ? 'sm:col-span-2' : ''}>
                    {sub.kind !== 'bool' && <Label f={sub} htmlFor={`${idPrefix}-${f.key}-${i}-${sub.key}`} />}
                    <LeafInput f={sub} id={`${idPrefix}-${f.key}-${i}-${sub.key}`} value={row?.[sub.key]} onChange={(v) => onChange(rows.map((r, j) => (j === i ? { ...r, [sub.key]: v } : r)))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <Button size="xs" variant="secondary" onClick={() => onChange([...rows, { ...(f.blank ?? {}) }])}><Plus size={10} /> Add {f.noun ?? 'row'}</Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <Label f={f} htmlFor={id} />
      <LeafInput f={f} value={value} onChange={onChange} id={id} />
      {help}
    </div>
  );
}

/** The labelled form for one record type; unknown keys in content (e.g. management-review inputs) are kept as they are. */
export function AimsContentForm({ type, content, onChange }: { type: string; content: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  const groups = AIMS_FORMS[type] ?? [];
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => {
        const src = g.path ? content[g.path] ?? {} : content;
        const set = (key: string, v: any) => onChange(g.path ? { ...content, [g.path]: { ...src, [key]: v } } : { ...content, [key]: v });
        return (
          <fieldset key={gi} className="space-y-2">
            {g.title && (
              <legend className="mb-1">
                <span className="text-[11px] font-medium text-text">{g.title}</span>
                {g.note && <span className="ml-1.5 text-[10px] text-text-tertiary">{g.note}</span>}
              </legend>
            )}
            {g.fields.map((f) => <Field key={f.key} f={f} value={src[f.key]} onChange={(v) => set(f.key, v)} idPrefix={`aims-${type}`} />)}
          </fieldset>
        );
      })}
    </div>
  );
}
