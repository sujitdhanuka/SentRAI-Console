/**
 * Which of the four report frameworks (RBI FREE-AI, NIST AI RMF, EU AI Act,
 * ISO/IEC 42001) apply to a model. With governance settings on, an
 * organisation's packs are the NIST + ISO baseline plus the region packs it
 * switched on in Governance > Setup; the criteria of a pack that is off are
 * not asked for, not shown and not counted. Nothing recorded for a switched-off
 * pack is deleted: switching the pack back on brings its criteria back with the
 * answers already on the model.
 *
 * With no settings in force (flag off, or a model outside any organisation)
 * every framework applies, exactly as before.
 */
import type { AIModelEntry } from '../domain/model-inventory';
import { governanceHooks } from '../governance/hooks';
import { frameworkBlockingGaps, validateEuAiAct, validateIso42001, validateNistRmf, ValidationContext } from './frameworks.validator';
import { sutrasBlockingGaps, sutrasOverallPass, validateSutrasCompliance } from './sutras.validator';

export type ReportFrameworkId = 'rbi_free_ai' | 'nist_ai_rmf' | 'eu_ai_act' | 'iso_42001';
export type ReportFrameworkKey = 'rbi' | 'nist' | 'eu' | 'iso';

export const REPORT_FRAMEWORKS: ReadonlyArray<{ id: ReportFrameworkId; key: ReportFrameworkKey; packId: string; label: string }> = [
  { id: 'rbi_free_ai', key: 'rbi', packId: 'rbi-free-ai', label: 'RBI FREE-AI' },
  { id: 'nist_ai_rmf', key: 'nist', packId: 'nist-ai-rmf', label: 'NIST AI RMF' },
  { id: 'eu_ai_act', key: 'eu', packId: 'eu-ai-act', label: 'EU AI Act' },
  { id: 'iso_42001', key: 'iso', packId: 'iso-42001', label: 'ISO 42001' },
];

export const ALL_REPORT_FRAMEWORKS: ReportFrameworkId[] = REPORT_FRAMEWORKS.map((f) => f.id);

export interface FrameworkScope {
  /** Packs that apply to the organisation; null when no settings are in force (every pack, as before). */
  pack_ids: string[] | null;
  /** Report frameworks whose criteria apply. */
  frameworks: ReportFrameworkId[];
  /** Report frameworks switched off for the organisation (kept, not asked for, not counted). */
  excluded: ReportFrameworkId[];
  /** True when the organisation's settings narrowed the frameworks. */
  restricted: boolean;
}

export const UNRESTRICTED_SCOPE: FrameworkScope = { pack_ids: null, frameworks: ALL_REPORT_FRAMEWORKS, excluded: [], restricted: false };

/** The scope for an organisation (its enabled packs), or every framework when no settings apply. */
export async function frameworkScopeForOrg(orgId: string | null): Promise<FrameworkScope> {
  const packIds = await governanceHooks.orgPackIds?.(orgId);
  if (!packIds) return UNRESTRICTED_SCOPE;
  const frameworks = REPORT_FRAMEWORKS.filter((f) => packIds.includes(f.packId)).map((f) => f.id);
  return { pack_ids: packIds, frameworks, excluded: ALL_REPORT_FRAMEWORKS.filter((id) => !frameworks.includes(id)), restricted: true };
}

/** One framework's report inside a compliance-check response (RBI is the top-level object). */
export function frameworkReportOf(report: Record<string, any> | null | undefined, id: ReportFrameworkId): Record<string, any> | null {
  if (!report) return null;
  if (id === 'rbi_free_ai') return report;
  if (id === 'nist_ai_rmf') return report.nist_rmf ?? null;
  if (id === 'eu_ai_act') return report.eu_ai_act ?? null;
  return report.iso_42001 ?? null;
}

/** The frameworks a compliance-check response says apply (every one for a response without the field). */
export function frameworksInScopeOf(report: { frameworks_in_scope?: string[] } | null | undefined): ReportFrameworkId[] {
  const s = report?.frameworks_in_scope;
  return Array.isArray(s) ? ALL_REPORT_FRAMEWORKS.filter((id) => s.includes(id)) : ALL_REPORT_FRAMEWORKS;
}

export const frameworkKey = (id: ReportFrameworkId): ReportFrameworkKey => REPORT_FRAMEWORKS.find((f) => f.id === id)!.key;
export const frameworkLabel = (id: ReportFrameworkId): string => REPORT_FRAMEWORKS.find((f) => f.id === id)!.label;

/**
 * The verdict the model list, model detail and project counts show. Without
 * settings it is the RBI Sutras verdict, as before; with settings it is every
 * in-scope framework (a model passes when none of them has a blocking gap).
 */
export function scopedVerdict(entry: AIModelEntry, ctx: ValidationContext, scope: FrameworkScope): { pass: boolean; gaps: number } {
  if (!scope.restricted) {
    const r = validateSutrasCompliance(entry, ctx);
    return { pass: sutrasOverallPass(r), gaps: sutrasBlockingGaps(r).length };
  }
  const gaps = scope.frameworks.reduce((n, id) => n + (
    id === 'rbi_free_ai' ? sutrasBlockingGaps(validateSutrasCompliance(entry, ctx)).length
      : id === 'nist_ai_rmf' ? frameworkBlockingGaps(validateNistRmf(entry, ctx)).length
        : id === 'eu_ai_act' ? frameworkBlockingGaps(validateEuAiAct(entry, ctx)).length
          : frameworkBlockingGaps(validateIso42001(entry, ctx)).length), 0);
  return { pass: gaps === 0 && scope.frameworks.length > 0, gaps };
}
