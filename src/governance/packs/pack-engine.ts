/**
 * Pack engine (E1.1). Evaluates a model against a framework pack: each clause
 * runs its library control, the pack supplies the code, wording, mandatory
 * rule and parameters. Produces the same report shapes as the legacy
 * validators, so frameworks.validator.ts and sutras.validator.ts become thin
 * adapters when GOV_E1_1_PACKS is on.
 */
import { RiskLevel } from '../../common/enums';
import { FeatureFlags, getFeatureFlags } from '../../common/feature-flags';
import type { FrameworkCheck, FrameworkComplianceReport } from '../../compliance/frameworks.validator';
import type { SutraCheck, SutrasComplianceReport } from '../../compliance/sutras.validator';
import { AIModelEntry } from '../../domain/model-inventory';
import { getControl } from '../controls/control-library';
import { ControlContext, ControlOutcome } from '../controls/control.types';
import { euRiskTier } from '../controls/model-controls';
import { LoadedPackVersion, PackClause, PackDefinition, ResolvedParameters } from './pack.types';
import { BASELINE_PACK_IDS, packRegistry } from './pack-loader';
import { environmentParameters, PLATFORM_DEFAULTS, resolveParameters } from './parameter-resolver';

export interface EngineOptions {
  flags?: FeatureFlags;
  /** Resolved parameters; resolved over `packIds` when omitted. */
  params?: ResolvedParameters;
  /** Packs whose parameters take part in the strictest-wins vote (default: every pack in force). */
  packIds?: string[];
  /** Extra parameter sources (governance settings in E1.2). */
  extraSources?: Array<{ source: string; version?: string; parameters: Record<string, any> }>;
  /** Regenerate as of this date: pack versions in force then. */
  asOf?: Date;
  now?: Date;
  /** 'MODEL' (default) evaluates per-model controls; 'ORG' evaluates organisation-level controls (E1.6). */
  scope?: 'MODEL' | 'ORG';
}

export interface ClauseResult {
  code: string;
  clause: string | null;
  name: string;
  controlId: string;
  passed: boolean;
  mandatory: boolean;
  notAssessed: boolean;
  evidence: string;
  gap: string;
  evidenceRefs: string[];
}

export interface PackEvaluation {
  packId: string;
  version: string;
  contentHash: string;
  tier: string;
  clauses: ClauseResult[];
  outcomes: Map<string, ControlOutcome>;
}

function interpolate(template: string, facts: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in facts ? String(facts[name]) : m));
}

/** A clause that needs a register fact the organisation does not have (feature off, or pack not enabled) is not evaluated. */
function lacksFact(ctx: ControlContext, fact: string): boolean {
  return ctx.governance?.[fact] === undefined && ctx.org?.[fact] === undefined;
}

function isMandatory(rule: PackClause['mandatory'], risk: RiskLevel): boolean {
  return typeof rule === 'boolean' ? rule : rule.riskIn.includes(risk);
}

function classifyTier(def: PackDefinition, entry: AIModelEntry, ctx: ControlContext, params: ResolvedParameters, flags: FeatureFlags): string {
  switch (def.tierClassifier) {
    case 'nist':
      return entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL ? 'High' : 'Standard';
    case 'iso':
      return [RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL].includes(entry.riskLevel) ? 'Elevated' : 'Standard';
    case 'eu': {
      // An operator-configured list (EU_AI_ACT_HIGH_RISK_DOMAINS) replaces the pack list, as before.
      const hint = euRiskTier(entry, ctx.euHighRiskDomains ?? (params.values.euHighRiskDomains as string[]) ?? []);
      // E5.1: the signed Art. 5 screening and Annex III classification decide the tier; the keyword match stays as the hint.
      const eu = flags.euAiAct ? ctx.governance?.euAct : undefined;
      return eu?.tier ?? hint;
    }
    case 'au': {
      // DTA policy v2.1 Appendix C: the in-scope answer comes from the latest
      // signed or revalidation-due impact assessment (E1.4); HIGH or CRITICAL
      // in-scope use cases are the policy's high-risk use cases.
      const au = ctx.governance?.auDta;
      if (!au || au.inScope === null || au.inScope === undefined) return 'Not assessed';
      if (!au.inScope) return 'Out of scope';
      return entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL ? 'In scope (high risk)' : 'In scope';
    }
    case 'us': {
      // OMB M-25-21 high-impact determination from the impact assessment; until
      // it is answered, HIGH and CRITICAL systems are treated as high impact.
      const us = ctx.governance?.usPolicy;
      if (us && us.highImpact !== null && us.highImpact !== undefined) return us.highImpact ? 'High impact' : 'Standard';
      return entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL ? 'High impact' : 'Standard';
    }
    default:
      return '';
  }
}

/** Parameters for an evaluation: packs in force + settings/environment, strictest wins, platform defaults last. */
export function resolveForPacks(packs: LoadedPackVersion[], extra: EngineOptions['extraSources'] = []): ResolvedParameters {
  return resolveParameters(
    [
      ...packs.map((p) => ({ source: p.definition.id, version: p.definition.version, parameters: p.definition.parameters ?? {} })),
      ...(extra ?? []),
      { source: 'environment', parameters: environmentParameters() },
    ],
    PLATFORM_DEFAULTS,
  );
}

export function evaluatePack(
  pack: LoadedPackVersion,
  entry: AIModelEntry,
  ctx: ControlContext,
  opts: EngineOptions = {},
): PackEvaluation {
  const flags = opts.flags ?? getFeatureFlags();
  const now = opts.now ?? new Date();
  const params =
    opts.params ??
    resolveForPacks(
      packRegistry().activeAt(opts.asOf ?? now).filter((p) => (opts.packIds ?? packRegistry().defaultPackIds(opts.asOf ?? now)).includes(p.definition.id)),
      opts.extraSources,
    );
  const def = pack.definition;
  const tier = classifyTier(def, entry, ctx, params, flags);
  // E5.1: the operator roles recorded for the system select the provider or deployer clauses.
  const euRoles: string[] | null = flags.euAiAct && Array.isArray(ctx.governance?.euAct?.roles) && ctx.governance!.euAct.roles.length ? ctx.governance!.euAct.roles : null;
  const evalAt = opts.asOf ?? now;
  const outcomes = new Map<string, ControlOutcome>();
  const clauses: ClauseResult[] = [];

  for (const clause of def.clauses) {
    if (clause.flag && !flags[clause.flag]) continue;
    if (clause.appliesWhenTier && !clause.appliesWhenTier.includes(tier)) continue;
    if (clause.requiresFact && lacksFact(ctx, clause.requiresFact)) continue;
    if (flags.euAiAct && clause.effectiveFrom && Date.parse(clause.effectiveFrom) > evalAt.getTime()) continue;
    if (euRoles && clause.roles && !clause.roles.some((r) => euRoles.includes(r))) continue;
    const control = getControl(clause.control)!;
    if (control.scope !== (opts.scope ?? 'MODEL')) continue;
    const out = control.evaluate({ entry, ctx, params, flags, opts: clause.opts ?? {}, now });
    outcomes.set(`${clause.control}|${JSON.stringify(clause.opts ?? {})}`, out);
    const facts = out.facts ?? {};
    const tmpl = clause.evidence?.[out.key];
    const evidence = tmpl !== undefined ? interpolate(tmpl, facts) : out.evidence;
    let gap: string;
    if (typeof clause.gap === 'string') gap = interpolate(clause.gap, facts);
    else gap = (out.gapKeys ?? []).map((k) => interpolate((clause.gap as Record<string, string>)[k] ?? '', facts)).filter(Boolean).join(' ');
    clauses.push({
      code: clause.code,
      clause: clause.clause ?? null,
      name: clause.name,
      controlId: clause.control,
      passed: out.passed,
      mandatory: isMandatory(clause.mandatory, entry.riskLevel),
      notAssessed: Boolean(out.notAssessed),
      evidence,
      gap,
      evidenceRefs: out.evidenceRefs ?? [],
    });
  }
  return { packId: def.id, version: def.version, contentHash: pack.contentHash, tier, clauses, outcomes };
}

/** Framework-format report (NIST, ISO, EU) in the legacy validator shape. */
export function toFrameworkReport(def: PackDefinition, ev: PackEvaluation, entry: AIModelEntry): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = ev.clauses.map((c) => {
    const check: FrameworkCheck = { controlCode: c.code, name: c.name, passed: c.passed, evidence: c.evidence, gap: c.gap, mandatory: c.mandatory };
    if (c.notAssessed) check.notAssessed = true;
    return check;
  });
  return { frameworkName: def.reportName, modelId: entry.modelId, modelName: entry.name, riskTier: ev.tier, checks };
}

/** Sutras-format report (RBI FREE-AI): evidence only on a pass, gap only on a failure. */
export function toSutrasReport(ev: PackEvaluation, entry: AIModelEntry): SutrasComplianceReport {
  const checks: SutraCheck[] = ev.clauses.map((c) => ({
    sutra: c.code as SutraCheck['sutra'],
    passed: c.passed,
    evidence: c.passed ? c.evidence : '',
    gap: c.passed ? '' : c.gap,
    mandatory: c.mandatory,
  }));
  return { modelId: entry.modelId, modelName: entry.name, checks };
}

/** Evaluate the pack in force (or as of a date) by id. Throws on an unknown pack. */
export function evaluatePackById(packId: string, entry: AIModelEntry, ctx: ControlContext, opts: EngineOptions = {}): PackEvaluation & { definition: PackDefinition } {
  const pack = packRegistry().versionAt(packId, opts.asOf ?? opts.now ?? new Date());
  if (!pack) throw new Error(`No version of pack ${packId} in force`);
  return { ...evaluatePack(pack, entry, ctx, opts), definition: pack.definition };
}

export { BASELINE_PACK_IDS };
