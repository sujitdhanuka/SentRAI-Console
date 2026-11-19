/**
 * EU AI Act workspace (E5.1): the pure part. Reference lists from Regulation
 * (EU) 2024/1689 (paraphrased), the per-system EU profile and its validation,
 * the tier derivation from the signed Art. 5 screening and Annex III
 * classification, Annex IV readiness, Annex V, VIII and Art. 13 documents,
 * the Art. 73 serious-incident clocks and the facts the EU controls read.
 *
 * Nothing here is legal advice: SentRAI records what the organisation decides
 * and checks the records are complete and consistent.
 */
import { createHash } from 'crypto';

export const DAY_MS = 86_400_000;

/* ------------------------------------------------------------ reference lists */

export const EU_ROLES = ['PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REP'] as const;
export type EuRole = (typeof EU_ROLES)[number];

/** Art. 2 exclusions that take a system out of scope. */
export const SCOPE_EXCLUSIONS = [
  { key: 'MILITARY', label: 'Exclusively military, defence or national security purposes (Art. 2(3))' },
  { key: 'RESEARCH', label: 'Developed and put into service solely for scientific research and development (Art. 2(6))' },
  { key: 'PRE_MARKET_RD', label: 'Research, testing or development before being placed on the market or put into service (Art. 2(8))' },
  { key: 'PERSONAL', label: 'Used by a natural person in a purely personal, non-professional activity (Art. 2(10))' },
  { key: 'OPEN_SOURCE', label: 'Released under a free and open-source licence and not high-risk, prohibited or Art. 50 (Art. 2(12))' },
] as const;

/** Art. 5(1) prohibited practices. `exception` marks practices with a narrow exception that must be described. */
export const ART5_PRACTICES = [
  { key: 'manipulation', ref: 'Art. 5(1)(a)', label: 'Subliminal, purposefully manipulative or deceptive techniques that materially distort behaviour and cause significant harm', exception: false },
  { key: 'vulnerabilities', ref: 'Art. 5(1)(b)', label: 'Exploiting vulnerabilities due to age, disability or a social or economic situation to distort behaviour and cause significant harm', exception: false },
  { key: 'social_scoring', ref: 'Art. 5(1)(c)', label: 'Social scoring leading to detrimental or unfavourable treatment out of context or out of proportion', exception: false },
  { key: 'crime_prediction', ref: 'Art. 5(1)(d)', label: 'Predicting the risk of a person committing a crime based solely on profiling or personality traits', exception: false },
  { key: 'facial_scraping', ref: 'Art. 5(1)(e)', label: 'Building facial recognition databases by untargeted scraping of facial images from the internet or CCTV', exception: false },
  { key: 'emotion_work_school', ref: 'Art. 5(1)(f)', label: 'Inferring emotions in the workplace or in education (except for medical or safety reasons)', exception: true },
  { key: 'biometric_categorisation', ref: 'Art. 5(1)(g)', label: 'Biometric categorisation to infer race, political opinions, trade union membership, religion, sex life or sexual orientation (except lawful labelling or filtering of datasets)', exception: true },
  { key: 'realtime_rbi', ref: 'Art. 5(1)(h)', label: 'Real-time remote biometric identification in publicly accessible spaces for law enforcement (except the Art. 5(1)(h)(i)–(iii) cases with authorisation)', exception: true },
] as const;

/** Annex III areas and points. */
export const ANNEX_III = [
  { area: 1, title: 'Biometrics', points: [
    { code: '1(a)', label: 'Remote biometric identification (not verification)' },
    { code: '1(b)', label: 'Biometric categorisation by sensitive or protected attributes' },
    { code: '1(c)', label: 'Emotion recognition' },
  ] },
  { area: 2, title: 'Critical infrastructure', points: [
    { code: '2', label: 'Safety component in critical digital infrastructure, road traffic, or the supply of water, gas, heating or electricity' },
  ] },
  { area: 3, title: 'Education and vocational training', points: [
    { code: '3(a)', label: 'Determining access or admission, or assigning people to institutions' },
    { code: '3(b)', label: 'Evaluating learning outcomes, including steering the learning process' },
    { code: '3(c)', label: 'Assessing the appropriate level of education a person will receive or access' },
    { code: '3(d)', label: 'Monitoring and detecting prohibited behaviour of students during tests' },
  ] },
  { area: 4, title: 'Employment, workers management and access to self-employment', points: [
    { code: '4(a)', label: 'Recruitment or selection: targeted job ads, filtering applications, evaluating candidates' },
    { code: '4(b)', label: 'Decisions on terms of work, promotion, termination, task allocation, monitoring and evaluating performance' },
  ] },
  { area: 5, title: 'Access to essential private and public services and benefits', points: [
    { code: '5(a)', label: 'Eligibility for public assistance benefits and services, or granting, reducing, revoking or reclaiming them' },
    { code: '5(b)', label: 'Creditworthiness or credit score of natural persons (except detecting financial fraud)' },
    { code: '5(c)', label: 'Risk assessment and pricing for life and health insurance' },
    { code: '5(d)', label: 'Evaluating and classifying emergency calls, dispatching or triage of emergency services' },
  ] },
  { area: 6, title: 'Law enforcement', points: [
    { code: '6(a)', label: 'Risk of a person becoming a victim of criminal offences' },
    { code: '6(b)', label: 'Polygraphs and similar tools' },
    { code: '6(c)', label: 'Evaluating the reliability of evidence' },
    { code: '6(d)', label: 'Risk of offending or re-offending not solely based on profiling, or assessing personality traits or past criminal behaviour' },
    { code: '6(e)', label: 'Profiling in the detection, investigation or prosecution of criminal offences' },
  ] },
  { area: 7, title: 'Migration, asylum and border control management', points: [
    { code: '7(a)', label: 'Polygraphs and similar tools' },
    { code: '7(b)', label: 'Assessing a security, irregular migration or health risk of a person entering a Member State' },
    { code: '7(c)', label: 'Examining applications for asylum, visa or residence permits and related complaints' },
    { code: '7(d)', label: 'Detecting, recognising or identifying persons (except verifying travel documents)' },
  ] },
  { area: 8, title: 'Administration of justice and democratic processes', points: [
    { code: '8(a)', label: 'Assisting a judicial authority in researching and interpreting facts and law and applying the law' },
    { code: '8(b)', label: 'Influencing the outcome of an election or referendum or voting behaviour' },
  ] },
] as const;
export const ANNEX_III_CODES = ANNEX_III.flatMap((a) => a.points.map((p) => p.code));

/** Art. 6(3) conditions a provider may rely on to consider an Annex III system not high-risk. */
export const DEROGATION_CONDITIONS = [
  { key: 'NARROW_PROCEDURAL', label: 'Performs a narrow procedural task (Art. 6(3)(a))' },
  { key: 'IMPROVE_HUMAN_ACTIVITY', label: 'Improves the result of a previously completed human activity (Art. 6(3)(b))' },
  { key: 'DETECT_PATTERNS', label: 'Detects decision-making patterns or deviations without replacing or influencing the human assessment (Art. 6(3)(c))' },
  { key: 'PREPARATORY', label: 'Performs a preparatory task to an assessment relevant to an Annex III use case (Art. 6(3)(d))' },
] as const;

/** Art. 113 application dates. */
export const APPLICATION_DATES = {
  prohibitions: '2025-02-02',
  gpai: '2025-08-02',
  general: '2026-08-02',
  annexIProducts: '2027-08-02',
} as const;

/** Art. 73 serious-incident classes (Art. 3(49)) and their reporting deadline in days. */
export const SERIOUS_INCIDENT_CLASSES = [
  { key: 'WIDESPREAD_INFRINGEMENT', days: 2, ref: 'Art. 73(3)', label: 'Widespread infringement (Art. 3(61))' },
  { key: 'CRITICAL_INFRASTRUCTURE', days: 2, ref: 'Art. 73(3)', label: 'Serious and irreversible disruption of critical infrastructure (Art. 3(49)(b))' },
  { key: 'DEATH', days: 10, ref: 'Art. 73(4)', label: 'Death of a person (Art. 3(49)(a))' },
  { key: 'SERIOUS_HEALTH_HARM', days: 15, ref: 'Art. 73(2)', label: 'Serious harm to a person’s health (Art. 3(49)(a))' },
  { key: 'FUNDAMENTAL_RIGHTS', days: 15, ref: 'Art. 73(2)', label: 'Infringement of obligations protecting fundamental rights (Art. 3(49)(c))' },
  { key: 'PROPERTY_ENVIRONMENT', days: 15, ref: 'Art. 73(2)', label: 'Serious harm to property or the environment (Art. 3(49)(d))' },
  { key: 'NOT_SERIOUS', days: null, ref: '', label: 'Not a serious incident under Art. 3(49)' },
] as const;
export type SeriousClass = (typeof SERIOUS_INCIDENT_CLASSES)[number]['key'];

export const CE_FORMS = ['DIGITAL', 'PHYSICAL', 'PACKAGING', 'DOCUMENTATION'] as const;
export const MARKING_METHODS = ['WATERMARK', 'METADATA', 'C2PA', 'FINGERPRINT', 'OTHER'] as const;
export const MARKET_STATUSES = ['NOT_PLACED', 'ON_MARKET', 'IN_SERVICE', 'NO_LONGER_ON_MARKET', 'RECALLED'] as const;
export const NONCONFORMITY_ACTIONS = ['CORRECT', 'WITHDRAW', 'DISABLE', 'RECALL'] as const;
export const ANNEX_VI_ITEMS = [
  { key: 'QMS', label: 'The quality management system complies with Art. 17 (Annex VI point 2)' },
  { key: 'TECH_DOC', label: 'The technical documentation shows the system meets the Chapter III Section 2 requirements (Annex VI point 3)' },
  { key: 'DESIGN_PMM', label: 'The design and development process and the post-market monitoring (Art. 72) are consistent with the technical documentation (Annex VI point 4)' },
] as const;
export const IMPORTER_CHECKS = [
  { key: 'conformity', label: 'The provider carried out the conformity assessment (Art. 23(1)(a))', roles: ['IMPORTER'] },
  { key: 'techDoc', label: 'The provider drew up the technical documentation (Art. 23(1)(b))', roles: ['IMPORTER'] },
  { key: 'ceMarking', label: 'The system bears the CE marking (Art. 23(1)(c), 24(1))', roles: ['IMPORTER', 'DISTRIBUTOR'] },
  { key: 'declaration', label: 'The EU declaration of conformity and instructions for use accompany it (Art. 23(1)(c), 24(1))', roles: ['IMPORTER', 'DISTRIBUTOR'] },
  { key: 'authorisedRep', label: 'The provider appointed an authorised representative (Art. 23(1)(d))', roles: ['IMPORTER'] },
  { key: 'registered', label: 'The provider registered the system in the EU database where required (Art. 24(1))', roles: ['DISTRIBUTOR'] },
] as const;

/** Minimums the EU pack sets (also pack parameters, strictest wins). */
export const EU_LOG_RETENTION_MONTHS = 6; // Art. 19(1), 26(6)
export const EU_DOC_RETENTION_YEARS = 10; // Art. 18(1)
export const EU_LOG_STORES = ['telemetry', 'ledger', 'audit', 'explainability'] as const;
export const EU_EXPLANATION_DAYS = 30;

/* --------------------------------------------------------------- the profile */

/**
 * Field spec for the per-system EU profile. Paths are dotted; every value the
 * API accepts is listed here, so unknown keys are dropped and types checked.
 */
type Spec = 'bool' | 'text' | 'longtext' | 'date' | 'int' | 'list' | readonly string[];
export const PROFILE_FIELDS: Record<string, Spec> = {
  // Art. 2–3 scope and operator role
  'scope.placedOnEuMarket': 'bool',
  'scope.outputUsedInEu': 'bool',
  'scope.exclusion': ['NONE', ...SCOPE_EXCLUSIONS.map((e) => e.key)],
  'scope.note': 'longtext',
  roles: 'list',
  // Art. 16(b) provider identity, Art. 22
  'provider.name': 'text',
  'provider.address': 'text',
  'provider.contact': 'text',
  'provider.establishedInEu': 'bool',
  // Market facts (Art. 49, 111, Annex VIII)
  'market.status': MARKET_STATUSES,
  'market.placedOnMarketAt': 'date',
  'market.memberStates': 'list',
  'market.tradeName': 'text',
  'market.publicAuthorityDeployer': 'bool',
  'market.legacyBeforeAug2026': 'bool',
  // Art. 16(l) accessibility
  'accessibility.applies': 'bool',
  'accessibility.evidenceRef': 'text',
  // Annex IV extra sections
  'annexIV.designChoices': 'longtext',
  'annexIV.architecture': 'longtext',
  'annexIV.computeResources': 'longtext',
  'annexIV.predeterminedChanges': 'longtext',
  'annexIV.cybersecurity': 'longtext',
  'annexIV.standardsApplied': 'list',
  'annexIV.harmonisedFullyApplied': 'bool',
  'annexIV.technicalDocumentationDocId': 'text',
  'annexIV.qmsDocId': 'text',
  // Art. 13 instructions for use
  'instructions.declaredAccuracy': 'longtext',
  'instructions.expectedLifetime': 'text',
  'instructions.computeNeeds': 'longtext',
  'instructions.maintenance': 'longtext',
  'instructions.inputSpecification': 'longtext',
  'instructions.logging': 'longtext',
  // Art. 72 post-market monitoring plan
  'pmm.dataCollected': 'longtext',
  'pmm.metrics': 'longtext',
  'pmm.reviewFrequencyMonths': 'int',
  'pmm.owner': 'text',
  'pmm.lastReviewAt': 'date',
  // Art. 10 data governance
  'data.representativeness': 'longtext',
  'data.statisticalProperties': 'longtext',
  'data.knownGaps': 'longtext',
  'data.specialCategoryUsed': 'bool',
  'data.specialCategory.purpose': 'longtext',
  'data.specialCategory.pseudonymisation': 'longtext',
  'data.specialCategory.accessControls': 'longtext',
  'data.specialCategory.deleteBy': 'date',
  // Art. 48 CE marking
  'ce.affixedAt': 'date',
  'ce.form': CE_FORMS,
  'ce.notifiedBodyNumber': 'text',
  // Art. 50 transparency
  'art50.interactsWithPersons': 'bool',
  'art50.obviousToPersons': 'bool',
  'art50.noticeText': 'longtext',
  'art50.noticeEvidenceRef': 'text',
  'art50.syntheticOutputs': 'bool',
  'art50.markingMethod': MARKING_METHODS,
  'art50.markingTestResult': ['PASS', 'FAIL'],
  'art50.markingTestedAt': 'date',
  'art50.emotionOrBiometricDeployer': 'bool',
  'art50.personsInformedRef': 'text',
  'art50.deepfakeOrPublicText': 'bool',
  'art50.disclosureRef': 'text',
  // Art. 26 deployer duties
  'deployer.controlsInputData': 'bool',
  'deployer.inputDatasetId': 'text',
  'deployer.inputSuitability': 'longtext',
  'deployer.inputCheckedAt': 'date',
  'deployer.workplace': 'bool',
  'deployer.workersInformedAt': 'date',
  'deployer.workersConsultationRef': 'text',
  'deployer.personNoticeTemplate': 'longtext',
  'deployer.personNoticeFirstSentAt': 'date',
  // Art. 27(3) FRIA notification
  'fria.required': 'bool',
  'fria.authorityNotifiedAt': 'date',
  'fria.authority': 'text',
  'fria.reference': 'text',
  // Art. 53 GPAI providers; Art. 25(4), 53(1)(b) downstream
  'gpai.isGpaiProvider': 'bool',
  'gpai.annexXIDocRef': 'text',
  'gpai.annexXIIDocRef': 'text',
  'gpai.copyrightPolicyRef': 'text',
  'gpai.trainingSummaryUrl': 'text',
  'gpai.usesUpstreamGpai': 'bool',
  'gpai.upstreamProvider': 'text',
  'gpai.upstreamAnnexXIIRef': 'text',
  'gpai.upstreamCopyrightUrl': 'text',
  'gpai.upstreamTrainingSummaryUrl': 'text',
  // Art. 23–24 importer and distributor verification
  ...Object.fromEntries(IMPORTER_CHECKS.map((c) => [`verification.${c.key}`, 'bool' as const])),
  'verification.verifiedAt': 'date',
  'verification.note': 'longtext',
};

export type Profile = Record<string, any>;

function getPath(o: any, path: string): any {
  return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}
function setPath(o: any, path: string, v: any): void {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) cur = cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {};
  cur[keys[keys.length - 1]] = v;
}
export const get = getPath;

/**
 * Merge a patch (nested or dotted keys) into a profile. Returns the new
 * profile and the list of field errors; null and '' clear a field.
 */
export function mergeProfile(current: Profile, patch: Record<string, any>): { profile: Profile; errors: string[]; changed: string[] } {
  const flat: Record<string, any> = {};
  const walk = (o: any, prefix: string) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (PROFILE_FIELDS[p] !== undefined) flat[p] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
    }
  };
  walk(patch, '');
  const out: Profile = JSON.parse(JSON.stringify(current ?? {}));
  const errors: string[] = [];
  const changed: string[] = [];
  for (const [path, raw] of Object.entries(flat)) {
    const spec = PROFILE_FIELDS[path];
    let v: any = raw;
    if (raw === null || raw === '' || raw === undefined) v = null;
    else if (spec === 'bool') {
      if (typeof raw !== 'boolean') { errors.push(`${path} must be true or false`); continue; }
    } else if (spec === 'text' || spec === 'longtext') {
      if (typeof raw !== 'string') { errors.push(`${path} must be text`); continue; }
      v = raw.trim().slice(0, spec === 'text' ? 500 : 8000) || null;
    } else if (spec === 'date') {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) { errors.push(`${path} must be a date`); continue; }
      v = d.toISOString().slice(0, 10);
    } else if (spec === 'int') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 120) { errors.push(`${path} must be a whole number from 1 to 120`); continue; }
      v = n;
    } else if (spec === 'list') {
      if (!Array.isArray(raw)) { errors.push(`${path} must be a list`); continue; }
      v = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].slice(0, 50);
      if (path === 'roles') {
        v = v.map((r: string) => r.toUpperCase());
        const bad = v.filter((r: string) => !(EU_ROLES as readonly string[]).includes(r));
        if (bad.length) { errors.push(`roles must be from ${EU_ROLES.join(', ')}`); continue; }
      }
      if (path === 'market.memberStates') v = v.map((s: string) => s.toUpperCase().slice(0, 2));
    } else if (Array.isArray(spec)) {
      const s = String(raw).toUpperCase();
      if (!spec.includes(s)) { errors.push(`${path} must be one of ${spec.join(', ')}`); continue; }
      v = s;
    }
    if (JSON.stringify(getPath(out, path) ?? null) !== JSON.stringify(v)) changed.push(path);
    setPath(out, path, v);
  }
  return { profile: out, errors, changed };
}

/* ---------------------------------------------------------- Art. 5 screening */

export interface Art5Answer { answer: 'YES' | 'NO'; exception?: string | null }
export interface Art5Screening { answers: Record<string, Art5Answer>; signedBy?: string | null; signedAt?: string | null; note?: string | null }

export function parseArt5(body: any): { answers: Record<string, Art5Answer>; errors: string[] } {
  const answers: Record<string, Art5Answer> = {};
  const errors: string[] = [];
  for (const p of ART5_PRACTICES) {
    const raw = body?.[p.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const a = typeof raw === 'object' ? raw : { answer: raw };
    const ans = String(a.answer ?? '').toUpperCase();
    if (ans !== 'YES' && ans !== 'NO') { errors.push(`${p.key}: answer YES or NO`); continue; }
    const exception = typeof a.exception === 'string' && a.exception.trim() ? a.exception.trim().slice(0, 2000) : null;
    if (exception && !p.exception) { errors.push(`${p.key}: ${p.ref} has no exception`); continue; }
    if (exception && exception.length < 20) { errors.push(`${p.key}: describe the exception relied on (at least 20 characters)`); continue; }
    answers[p.key] = { answer: ans as 'YES' | 'NO', ...(exception && ans === 'YES' ? { exception } : {}) };
  }
  return { answers, errors };
}

export function art5Result(s: Art5Screening | null | undefined) {
  const answers = s?.answers ?? {};
  const unanswered = ART5_PRACTICES.filter((p) => !answers[p.key]).map((p) => p.key);
  const prohibited = ART5_PRACTICES.filter((p) => answers[p.key]?.answer === 'YES' && !answers[p.key]?.exception).map((p) => p.key);
  const excepted = ART5_PRACTICES.filter((p) => answers[p.key]?.answer === 'YES' && !!answers[p.key]?.exception).map((p) => p.key);
  return { signed: !!s?.signedAt, signedBy: s?.signedBy ?? null, signedAt: s?.signedAt ?? null, unanswered, prohibited, excepted, complete: unanswered.length === 0 };
}

/* ------------------------------------------------ Annex III / Art. 6 classification */

export interface Classification {
  annexIII: string[];
  annexIProduct: boolean | null;
  profiling: boolean | null;
  derogation: string | null;
  derogationReasoning: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
}

export function parseClassification(body: any): { value: Classification; errors: string[] } {
  const errors: string[] = [];
  const annexIII = Array.isArray(body?.annex_iii) ? [...new Set(body.annex_iii.map(String))] as string[] : [];
  const bad = annexIII.filter((c) => !ANNEX_III_CODES.includes(c));
  if (bad.length) errors.push(`annex_iii has unknown points: ${bad.join(', ')}`);
  const bool = (v: any, f: string) => (v === undefined || v === null || v === '' ? null : typeof v === 'boolean' ? v : (errors.push(`${f} must be true or false`), null));
  const annexIProduct = bool(body?.annex_i_product, 'annex_i_product');
  const profiling = bool(body?.profiling, 'profiling');
  let derogation: string | null = body?.derogation ? String(body.derogation).toUpperCase() : null;
  if (derogation && !DEROGATION_CONDITIONS.some((d) => d.key === derogation)) { errors.push(`derogation must be one of ${DEROGATION_CONDITIONS.map((d) => d.key).join(', ')}`); derogation = null; }
  const reasoning = typeof body?.derogation_reasoning === 'string' && body.derogation_reasoning.trim() ? body.derogation_reasoning.trim().slice(0, 8000) : null;
  if (derogation && !annexIII.length) errors.push('An Art. 6(3) derogation only applies to a system in an Annex III area');
  if (derogation && profiling) errors.push('Art. 6(3): a system that profiles natural persons is always high-risk; the derogation cannot be used');
  if (derogation && (!reasoning || reasoning.length < 50)) errors.push('Art. 6(4): document the derogation assessment (at least 50 characters)');
  return { value: { annexIII: annexIII.filter((c) => ANNEX_III_CODES.includes(c)), annexIProduct, profiling, derogation, derogationReasoning: reasoning }, errors };
}

export type EuTier = 'Prohibited' | 'High Risk' | 'Limited Risk' | 'Minimal Risk';

/**
 * The EU tier from the signed records: Art. 5 first, then Art. 6 (Annex I
 * product route from 2 Aug 2027, Annex III unless a valid Art. 6(3)
 * derogation), then Art. 50. Null while neither record is signed (the
 * keyword match on the functional area stays as the hint).
 */
export function deriveTier(profile: Profile, art5: Art5Screening | null, cls: Classification | null, now: Date): { tier: EuTier | null; basis: string; highRisk: boolean; derogation: boolean } {
  const a5 = art5Result(art5);
  if (a5.signed && a5.prohibited.length) return { tier: 'Prohibited', basis: `Art. 5 practice: ${a5.prohibited.join(', ')}`, highRisk: false, derogation: false };
  if (!cls?.signedAt) return { tier: null, basis: 'Not classified: keyword hint from the functional area', highRisk: false, derogation: false };
  const annexI = cls.annexIProduct === true && now.getTime() >= Date.parse(APPLICATION_DATES.annexIProducts);
  const derog = !!cls.derogation && cls.profiling !== true;
  if (annexI) return { tier: 'High Risk', basis: 'Art. 6(1): safety component or product under Annex I legislation', highRisk: true, derogation: false };
  if (cls.annexIII.length && !derog) return { tier: 'High Risk', basis: `Art. 6(2), Annex III point ${cls.annexIII.join(', ')}`, highRisk: true, derogation: false };
  const a50 = profile.art50 ?? {};
  const limited = (a50.interactsWithPersons && !a50.obviousToPersons) || a50.syntheticOutputs || a50.emotionOrBiometricDeployer || a50.deepfakeOrPublicText;
  const basis = derog ? `Annex III ${cls.annexIII.join(', ')} with an Art. 6(3) derogation (${cls.derogation})` : 'No Annex I or Annex III use';
  return { tier: limited ? 'Limited Risk' : 'Minimal Risk', basis: limited ? `${basis}; Art. 50 transparency applies` : basis, highRisk: false, derogation: derog };
}

/* ---------------------------------------------------------------- Annex IV */

export interface AnnexIVInput {
  model: { name: string; modelType: string; functionalArea: string; useCaseDescription: string; developedBy: string | null; ownerTeam: string | null; humanOversightRequired: boolean; sourceRefs: string[]; dependencies: any[]; performanceBenchmarks: any[] };
  profile: Profile;
  contextProfile: Record<string, any> | null;
  datasets: Array<{ name: string; provenance: string | null; lawfulBasis: string | null }>;
  tevv: { testSets: number; withCriteria: number; latestPassing: number; segments: string[] };
  validations: number;
  risks: { assessed: number } | null;
  cardVersions: number;
  ledgerEvents: number;
  declaration: { issuedAt: string; hash: string } | null;
}

const filled = (v: any) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim().length > 0);

/** Annex IV sections with the content SentRAI holds for each, and a readiness score. */
export function annexIV(i: AnnexIVInput) {
  const p = i.profile ?? {};
  const ctx = i.contextProfile ?? {};
  const f = (label: string, value: any, required = true) => ({ label, value: Array.isArray(value) ? value.join('; ') : value ?? null, filled: filled(value), required });
  const sections = [
    { id: 'general', ref: 'Annex IV(1)', title: 'General description', fields: [
      f('Intended purpose', i.model.useCaseDescription && i.model.useCaseDescription.trim().length >= 20 ? i.model.useCaseDescription : null),
      f('Provider', p.provider?.name),
      f('System type and version', `${i.model.modelType}${i.model.sourceRefs.length ? ` · ${i.model.sourceRefs[0]}` : ''}`),
      f('Interaction with other hardware or software', i.model.dependencies.length ? i.model.dependencies.map((d: any) => (typeof d === 'string' ? d : d?.name ?? JSON.stringify(d))) : null, false),
      f('Instructions for use (Art. 13)', p.instructions?.declaredAccuracy ? 'Generated from this record (Art. 13 export)' : null),
    ] },
    { id: 'development', ref: 'Annex IV(2)', title: 'Elements and development process', fields: [
      f('Design choices and assumptions', p.annexIV?.designChoices),
      f('System architecture', p.annexIV?.architecture),
      f('Computational resources', p.annexIV?.computeResources),
      f('Data: training, validation and test sets', i.datasets.length ? i.datasets.map((d) => `${d.name}${d.provenance ? ` (${d.provenance})` : ''}`) : null),
      f('Human oversight measures (Art. 14)', i.model.humanOversightRequired ? (ctx.oversightPattern ? `Human oversight required; pattern ${ctx.oversightPattern}` : 'Human oversight required') : null),
      f('Pre-determined changes', p.annexIV?.predeterminedChanges, false),
      f('Validation and testing', i.tevv.testSets || i.validations ? `${i.tevv.testSets} test set(s), ${i.tevv.latestPassing} passing; ${i.validations} validation(s)` : null),
      f('Cybersecurity measures (Art. 15)', p.annexIV?.cybersecurity),
    ] },
    { id: 'monitoring', ref: 'Annex IV(3)', title: 'Monitoring, functioning and control', fields: [
      f('Capabilities and limitations, including accuracy for groups', i.tevv.segments.length ? `Segment results for ${i.tevv.segments.join(', ')}` : p.instructions?.declaredAccuracy),
      f('Foreseeable unintended outcomes', ctx.knownLimitations ?? null),
      f('Input data specifications', p.instructions?.inputSpecification),
    ] },
    { id: 'metrics', ref: 'Annex IV(4)', title: 'Appropriateness of the performance metrics', fields: [
      f('Performance metrics', i.model.performanceBenchmarks.length ? i.model.performanceBenchmarks.map((b: any) => (typeof b === 'string' ? b : b?.metric ? `${b.metric}: ${b.value ?? ''}` : JSON.stringify(b))) : p.instructions?.declaredAccuracy),
    ] },
    { id: 'risk', ref: 'Annex IV(5)', title: 'Risk management system (Art. 9)', fields: [
      f('Risk register', i.risks ? (i.risks.assessed ? `${i.risks.assessed} assessed risk(s)` : null) : null),
    ] },
    { id: 'changes', ref: 'Annex IV(6)', title: 'Changes over the lifecycle', fields: [
      f('Change record', i.ledgerEvents || i.cardVersions ? `${i.ledgerEvents} ledger event(s), ${i.cardVersions} model card version(s)` : null),
    ] },
    { id: 'standards', ref: 'Annex IV(7)', title: 'Harmonised standards and other specifications applied', fields: [
      f('Standards applied', p.annexIV?.standardsApplied),
    ] },
    { id: 'declaration', ref: 'Annex IV(8)', title: 'EU declaration of conformity', fields: [
      f('Declaration', i.declaration ? `Issued ${i.declaration.issuedAt.slice(0, 10)} (sha256 ${i.declaration.hash.slice(0, 12)})` : null, false),
    ] },
    { id: 'pmm', ref: 'Annex IV(9)', title: 'Post-market monitoring plan (Art. 72(3))', fields: [
      f('Data collected', p.pmm?.dataCollected),
      f('Metrics', p.pmm?.metrics),
      f('Review frequency (months)', p.pmm?.reviewFrequencyMonths),
      f('Owner', p.pmm?.owner),
    ] },
  ];
  const out = sections.map((s) => {
    const req = s.fields.filter((x) => x.required);
    const done = req.filter((x) => x.filled).length;
    const status = done === req.length ? 'COMPLETE' : done === 0 ? 'MISSING' : 'PARTIAL';
    return { ...s, status, missing: req.filter((x) => !x.filled).map((x) => x.label) };
  });
  const req = out.flatMap((s) => s.fields.filter((x) => x.required));
  const score = req.length ? Math.round((req.filter((x) => x.filled).length / req.length) * 100) : 100;
  return { sections: out, score, missing: out.filter((s) => s.status !== 'COMPLETE').map((s) => s.title) };
}

export function annexIVMarkdown(modelName: string, a: ReturnType<typeof annexIV>, generatedAt: Date): string {
  const lines = [`# Technical documentation (EU AI Act Art. 11, Annex IV): ${modelName}`, '', `Generated ${generatedAt.toISOString().slice(0, 10)} by SentRAI. Readiness ${a.score}%.`, ''];
  for (const s of a.sections) {
    lines.push(`## ${s.ref} ${s.title} (${s.status.toLowerCase()})`, '');
    for (const f of s.fields) lines.push(`- **${f.label}:** ${f.filled ? String(f.value) : f.required ? '_missing_' : '_not recorded_'}`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------- Annex V, VIII */

export function sha256(v: unknown): string {
  return createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
}

/** Annex V content of the EU declaration of conformity. */
export function declarationContent(x: {
  model: { id: string; name: string; modelType: string };
  profile: Profile;
  conformity: { route: string; notifiedBody?: { name?: string; number?: string; certificateRef?: string } | null };
  personalData: boolean;
  signer: { name: string; function: string };
  place: string;
  issuedAt: Date;
}) {
  const p = x.profile;
  return {
    annex: 'Annex V',
    system: { name: p.market?.tradeName || x.model.name, type: x.model.modelType, reference: x.model.id },
    provider: { name: p.provider?.name ?? null, address: p.provider?.address ?? null, authorised_representative: null as any },
    statement: 'This EU declaration of conformity is issued under the sole responsibility of the provider.',
    conformity: 'The AI system is in conformity with Regulation (EU) 2024/1689' + (x.personalData ? ' and with Regulations (EU) 2016/679 and 2018/1725 and Directive (EU) 2016/680 where it processes personal data.' : '.'),
    standards: p.annexIV?.standardsApplied ?? [],
    notified_body: x.conformity.route === 'NOTIFIED_BODY' ? x.conformity.notifiedBody ?? null : null,
    procedure: x.conformity.route === 'NOTIFIED_BODY' ? 'Annex VII (quality management system and technical documentation assessed by a notified body)' : 'Annex VI (internal control)',
    place_of_issue: x.place,
    date_of_issue: x.issuedAt.toISOString().slice(0, 10),
    signed_for_provider: { name: x.signer.name, function: x.signer.function },
  };
}

/** Which Annex VIII sections a system needs. */
export function registrationSections(roles: string[], tier: EuTier | null, derogation: boolean, profile: Profile): Array<'A' | 'B' | 'C'> {
  const out: Array<'A' | 'B' | 'C'> = [];
  if (roles.includes('PROVIDER') && tier === 'High Risk') out.push('A');
  if (roles.includes('PROVIDER') && derogation) out.push('B');
  if (roles.includes('DEPLOYER') && tier === 'High Risk' && profile.market?.publicAuthorityDeployer) out.push('C');
  return out;
}

/** Annex VIII content for one section. */
export function annexVIII(section: 'A' | 'B' | 'C', x: {
  model: { id: string; name: string; useCaseDescription: string; modelType: string; functionalArea: string };
  profile: Profile;
  authorisedRep: { name?: string; contact?: string } | null;
  classification: Classification | null;
  conformity: { notifiedBody?: { name?: string; number?: string; certificateRef?: string; validUntil?: string } | null } | null;
  declaration: { id: string; issuedAt: string; hash: string } | null;
  fria: { status: string; version: number; signedAt: string | null } | null;
  deployerName: string | null;
  providerEntryUrl: string | null;
}) {
  const p = x.profile;
  const provider = { name: p.provider?.name ?? null, address: p.provider?.address ?? null, contact: p.provider?.contact ?? null };
  if (section === 'A') {
    return {
      section: 'A', title: 'Providers of high-risk AI systems (Art. 49(1))',
      fields: {
        '1 Provider name, address and contact': provider,
        '3 Authorised representative': x.authorisedRep,
        '4 Trade name and unambiguous reference': { trade_name: p.market?.tradeName ?? x.model.name, reference: x.model.id },
        '5 Intended purpose, components and functions': x.model.useCaseDescription,
        '6 Information used and operating logic': { model_type: x.model.modelType, input_specification: p.instructions?.inputSpecification ?? null },
        '7 Status': p.market?.status ?? null,
        '8 Notified-body certificate': x.conformity?.notifiedBody ?? null,
        '10 Member States': p.market?.memberStates ?? [],
        '11 EU declaration of conformity': x.declaration,
        '12 Instructions for use': 'Art. 13 instructions for use (SentRAI export)',
      },
    };
  }
  if (section === 'B') {
    const cond = DEROGATION_CONDITIONS.find((d) => d.key === x.classification?.derogation);
    return {
      section: 'B', title: 'Providers relying on Art. 6(3) (Art. 49(2))',
      fields: {
        '1 Provider name, address and contact': provider,
        '3 Authorised representative': x.authorisedRep,
        '4 Trade name and unambiguous reference': { trade_name: p.market?.tradeName ?? x.model.name, reference: x.model.id },
        '5 Intended purpose': x.model.useCaseDescription,
        '6 Art. 6(3) condition relied on': cond?.label ?? null,
        '7 Grounds for considering the system not high-risk': x.classification?.derogationReasoning ?? null,
        '8 Status': p.market?.status ?? null,
        '9 Member States': p.market?.memberStates ?? [],
      },
    };
  }
  return {
    section: 'C', title: 'Deployers that are public authorities (Art. 49(3))',
    fields: {
      '1 Deployer name, address and contact': x.deployerName,
      '3 Provider’s EU database entry (URL)': x.providerEntryUrl,
      '4 Summary of the fundamental rights impact assessment (Art. 27)': x.fria ? `Version ${x.fria.version}, ${x.fria.status}${x.fria.signedAt ? `, signed ${x.fria.signedAt}` : ''}` : null,
      '5 Summary of the data protection impact assessment': null,
    },
  };
}

/* ------------------------------------------------------------ Art. 73 clocks */

export interface EuIncidentExt {
  classification?: SeriousClass | null;
  awareAt?: string | null;
  deadlineAt?: string | null;
  reportedAt?: string | null;
  authority?: string | null;
  reference?: string | null;
  initialReportOnly?: boolean;
  providerInformedAt?: string | null;
  authorityInformedAt?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  stateRecordedAt?: string | null;
  stateDescription?: string | null;
  notAltered?: boolean | null;
  alterationReason?: string | null;
  classifiedBy?: string | null;
}

export function seriousClass(key: string | null | undefined) {
  return SERIOUS_INCIDENT_CLASSES.find((c) => c.key === key) ?? null;
}

/** The Art. 73 deadline from awareness, or null for an incident that is not serious. */
export function euDeadline(cls: string, awareAt: Date): Date | null {
  const c = seriousClass(cls);
  if (!c || c.days === null) return null;
  return new Date(awareAt.getTime() + c.days * DAY_MS);
}

export function euIncidentStatus(ext: EuIncidentExt | null | undefined, inc: { severity: string; status: string }, now: Date, roles: string[]) {
  const e = ext ?? {};
  const cls = seriousClass(e.classification);
  const serious = !!cls && cls.days !== null;
  const deadline = e.deadlineAt ? new Date(e.deadlineAt) : null;
  const problems: string[] = [];
  if (!cls) {
    if (/^P[12]/.test(String(inc.severity).toUpperCase())) problems.push('P1/P2 incident not classified under Art. 3(49)');
  } else if (serious) {
    if (!e.reportedAt && deadline && deadline.getTime() < now.getTime()) problems.push(`authority report overdue since ${deadline.toISOString().slice(0, 10)}`);
    if (!e.stateRecordedAt) problems.push('system state before investigation not recorded (Art. 73(6))');
    if (e.notAltered === false && !e.alterationReason) problems.push('system altered before investigation without a reason');
    if (roles.includes('DEPLOYER') && !roles.includes('PROVIDER') && !e.providerInformedAt) problems.push('provider not informed (Art. 26(5))');
  }
  return {
    classification: cls?.key ?? null,
    serious,
    days: cls?.days ?? null,
    deadline_at: deadline?.toISOString() ?? null,
    overdue: serious && !e.reportedAt && !!deadline && deadline.getTime() < now.getTime(),
    reported_at: e.reportedAt ?? null,
    problems,
  };
}

/** A report to the market surveillance authority, built from the incident and the EU record. */
export function seriousIncidentReport(x: {
  incident: { id: string; description: string; observedAt: Date; detectedAt: Date; severity: string; immediateActionTaken: string; systemSuspended: boolean; affectedConsumers: any };
  model: { id: string; name: string };
  profile: Profile;
  ext: EuIncidentExt;
  registration: { euDatabaseId: string | null } | null;
}) {
  const c = seriousClass(x.ext.classification);
  return {
    title: 'Serious incident report (EU AI Act Art. 73)',
    report_type: x.ext.initialReportOnly ? 'INITIAL' : 'COMPLETE',
    provider: { name: x.profile.provider?.name ?? null, contact: x.profile.provider?.contact ?? null },
    system: { name: x.profile.market?.tradeName ?? x.model.name, reference: x.model.id, eu_database_id: x.registration?.euDatabaseId ?? null },
    incident: {
      reference: x.incident.id,
      classification: c ? `${c.label} (${c.ref})` : null,
      occurred_at: x.incident.observedAt,
      became_aware_at: x.ext.awareAt ?? x.incident.detectedAt,
      deadline_at: x.ext.deadlineAt ?? null,
      description: x.incident.description,
      affected: x.incident.affectedConsumers ?? null,
      member_states: x.profile.market?.memberStates ?? [],
    },
    measures: {
      immediate_action: x.incident.immediateActionTaken,
      system_suspended: x.incident.systemSuspended || !!x.ext.suspendedAt,
      state_before_investigation: x.ext.stateDescription ?? null,
      not_altered_before_investigation: x.ext.notAltered ?? null,
      alteration_reason: x.ext.alterationReason ?? null,
    },
    authority: { name: x.ext.authority ?? null, reference: x.ext.reference ?? null, reported_at: x.ext.reportedAt ?? null },
  };
}

/* ------------------------------------------------------------ Art. 13 export */

export function instructionsForUse(x: {
  model: { id: string; name: string; useCaseDescription: string; humanOversightRequired: boolean; modelType: string };
  profile: Profile;
  contextProfile: Record<string, any> | null;
  tevv: Array<{ name: string; criteria: any; latest: { passed: boolean; results: any; runAt: string } | null }>;
  risks: string[];
}) {
  const p = x.profile;
  const ctx = x.contextProfile ?? {};
  const doc = {
    title: 'Instructions for use (EU AI Act Art. 13)',
    '13(3)(a) Provider identity and contact': { name: p.provider?.name ?? null, address: p.provider?.address ?? null, contact: p.provider?.contact ?? null },
    '13(3)(b)(i) Intended purpose': x.model.useCaseDescription,
    '13(3)(b)(ii) Accuracy, robustness and cybersecurity levels': { declared: p.instructions?.declaredAccuracy ?? null, cybersecurity: p.annexIV?.cybersecurity ?? null },
    '13(3)(b)(iii) Known or foreseeable risks and misuse': { limitations: ctx.knownLimitations ?? [], out_of_scope_uses: ctx.outOfScopeUses ?? [], residual_risks: x.risks },
    '13(3)(b)(iv) Explainability features': 'Per-decision explainability records: the top contributing features and a plain-language summary for each scored decision',
    '13(3)(b)(v) Performance on specific persons or groups': x.tevv.map((t) => ({ test_set: t.name, criteria: t.criteria, latest: t.latest })),
    '13(3)(b)(vi) Input data specifications': p.instructions?.inputSpecification ?? null,
    '13(3)(d) Human oversight measures': { required: x.model.humanOversightRequired, pattern: ctx.oversightPattern ?? null },
    '13(3)(e) Computational resources, lifetime and maintenance': { compute: p.instructions?.computeNeeds ?? null, expected_lifetime: p.instructions?.expectedLifetime ?? null, maintenance: p.instructions?.maintenance ?? null },
    '13(3)(f) Logging mechanisms': p.instructions?.logging ?? 'SentRAI records runtime telemetry, the model ledger and per-decision explainability records.',
  };
  const missing = Object.entries(doc).filter(([k, v]) => k !== 'title' && (v === null || (typeof v === 'object' && !Array.isArray(v) && Object.values(v as any).every((y) => y === null || (Array.isArray(y) && !y.length))))).map(([k]) => k);
  return { document: doc, missing };
}

/* ---------------------------------------------------------- Art. 86 explanation */

export function explanationText(x: { modelName: string; decisionRef: string; outcome: string; method: string; topFeatures: Record<string, number>; summary: string; humanOversight: boolean }) {
  const factors = Object.entries(x.topFeatures ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  return [
    `Decision ${x.decisionRef}: ${x.outcome}.`,
    `Role of the AI system: ${x.modelName} produced an output that was used in this decision${x.humanOversight ? ', and a person reviewed it before the decision was made' : ''}.`,
    factors.length ? `Main elements of the decision: ${factors.map(([k, v]) => `${k} (${v >= 0 ? '+' : ''}${Number(v).toFixed(2)})`).join(', ')}.` : 'Main elements of the decision: not recorded.',
    x.summary ? `Summary: ${x.summary}` : '',
    `Method: ${x.method}.`,
  ].filter(Boolean).join('\n');
}
