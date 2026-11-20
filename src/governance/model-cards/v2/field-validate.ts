/**
 * Model card v2: validates a value against its catalogue entry. The
 * catalogue is the typed schema: data_type, allowed_values and table columns.
 * "UNKNOWN" is accepted for every field (spec §11.3: never guess).
 */
import { ColumnDef, COUNT_STATES, FieldDef } from './catalogue';

const MAX_TEXT = 20_000;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const isUrlish = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000;

function scalar(type: ColumnDef['data_type'], allowed: readonly string[] | undefined, v: any, label: string): string | null {
  switch (type) {
    case 'text':
    case 'longtext':
    case 'user':
      return typeof v === 'string' && v.trim() && v.length <= MAX_TEXT ? null : `${label} must be text`;
    case 'url':
      return isUrlish(v) ? null : `${label} must be a reference or URL`;
    case 'enum':
    case 'tristate':
      return allowed?.includes(v) ? null : `${label} must be one of ${allowed?.join(', ')}`;
    case 'multi':
      return Array.isArray(v) && v.length > 0 && v.every((x) => allowed?.includes(x)) ? null : `${label} must be a list of ${allowed?.join(', ')}`;
    case 'date':
      return isDate(v) ? null : `${label} must be a date (YYYY-MM-DD)`;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : `${label} must be a number of 0 or more`;
    case 'boolean':
      return typeof v === 'boolean' ? null : `${label} must be true or false`;
    case 'list':
      return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() && x.length <= 2000) ? null : `${label} must be a list of text`;
    case 'count': {
      if (!v || typeof v !== 'object' || !COUNT_STATES.includes(v.state)) return `${label} must say ${COUNT_STATES.join(', ')}`;
      if (v.state === 'RECORDED') return Number.isInteger(v.count) && v.count > 0 ? null : `${label}: RECORDED needs a count above 0`;
      return v.count === undefined || v.count === null || (v.state === 'ZERO_RECORDED' && v.count === 0) ? null : `${label}: only RECORDED carries a count`;
    }
    default:
      return `${label} has an unsupported type`;
  }
}

/** Every problem with `value` for this field; empty when valid. */
export function validateValue(def: FieldDef, value: any): string[] {
  if (value === 'UNKNOWN') return [];
  if (value === null || value === undefined) return [`${def.label} needs a value (or UNKNOWN, or not applicable)`];
  if (def.data_type === 'records') {
    return Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'string' && x.length <= 36) ? [] : [`${def.label} must be a list of record ids`];
  }
  if (def.data_type !== 'table') {
    const e = scalar(def.data_type, def.allowed_values, value, def.label);
    return e ? [e] : [];
  }
  if (!Array.isArray(value) || value.length === 0) return [`${def.label} must have at least one row`];
  const errors: string[] = [];
  value.forEach((row, i) => {
    if (!row || typeof row !== 'object') return errors.push(`${def.label} row ${i + 1} is not a row`);
    for (const c of def.columns ?? []) {
      const v = row[c.key];
      if (v === undefined || v === null || v === '') {
        if (c.required) errors.push(`${def.label} row ${i + 1}: ${c.label} is required`);
        continue;
      }
      const e = scalar(c.data_type, c.allowed_values, v, `${def.label} row ${i + 1}: ${c.label}`);
      if (e) errors.push(e);
    }
    const extra = Object.keys(row).filter((k) => !(def.columns ?? []).some((c) => c.key === k));
    if (extra.length) errors.push(`${def.label} row ${i + 1}: unknown column ${extra.join(', ')}`);
  });
  return errors;
}
