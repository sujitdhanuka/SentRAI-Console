/**
 * EU AI Act workspace (E5.1). Per system: scope and operator role (Art. 2–3),
 * the Art. 5 screening and the Annex III / Annex I classification (both
 * signed), Annex IV, Art. 13 and Art. 50 fields, the Annex VI / VII
 * conformity assessment, the Annex V declaration, CE marking, the Annex VIII
 * EU database registration, Art. 20 non-conformity actions, Art. 25 change
 * assessments, Art. 60 real-world testing plans, Art. 73 incident clocks and
 * Art. 86 explanation requests. Per organisation: the authorised
 * representative (Art. 22) and log retention (Art. 19, 26(6)).
 *
 * Everything answers 404 unless GOV_E5_1_EU_ACT is on, and a system's EU
 * records only take effect while its organisation has the EU AI Act pack
 * enabled in governance settings.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIIncidentEntity,
  AIModelEntity,
  ControlledDocumentEntity,
  DatasetEntity,
  EuActRecordEntity,
  ExplainabilityRecordEntity,
  ImpactAssessmentEntity,
  ModelCardEntity,
  ModelDatasetEntity,
  ModelDeployerEntity,
  ModelLedgerEventEntity,
  ModelValidationEntity,
  OrganizationEntity,
  ProjectEntity,
  RiskEntity,
  TestSetEntity,
  TevvRunEntity,
} from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, addOrgFacts, governanceHooks } from '../hooks';
import { DAY_MS, MAINTAINERS, OFFICERS, addMonths, isFuture, oneOf, optDate, optText, orgFor, orgOfModel, reqText, requireRole, scopedOrgModels } from '../phase2-util';
import { GateFinding, RisksService } from '../risks/risks.service';
import { GovernanceSettingsService } from '../settings/settings.service';
import {
  ANNEX_VI_ITEMS,
  annexIV,
  annexIVMarkdown,
  annexVIII,
  APPLICATION_DATES,
  art5Result,
  Art5Screening,
  Classification,
  declarationContent,
  deriveTier,
  euDeadline,
  euIncidentStatus,
  EuIncidentExt,
  EU_DOC_RETENTION_YEARS,
  EU_EXPLANATION_DAYS,
  EU_LOG_RETENTION_MONTHS,
  EU_LOG_STORES,
  explanationText,
  get,
  IMPORTER_CHECKS,
  instructionsForUse,
  mergeProfile,
  NONCONFORMITY_ACTIONS,
  parseArt5,
  parseClassification,
  Profile,
  registrationSections,
  SERIOUS_INCIDENT_CLASSES,
  seriousIncidentReport,
  sha256,
} from './eu-act.model';

export const EU_PACK_ID = 'eu-ai-act';
const SIGNERS: Role[] = [Role.OWNER, Role.CISO, Role.ADMIN, Role.APPROVER];
const MATERIAL_EVENTS = ['MATERIAL_CHANGE', 'CONTEXT_CHANGED', 'VENDOR_CHANGE'];

interface Workspace {
  profile: EuActRecordEntity | null;
  records: EuActRecordEntity[];
}

@Injectable()
export class EuActService implements OnModuleInit {
  constructor(
    @InjectRepository(EuActRecordEntity) private readonly rows: Repository<EuActRecordEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly impacts: Repository<ImpactAssessmentEntity>,
    @InjectRepository(ControlledDocumentEntity) private readonly documents: Repository<ControlledDocumentEntity>,
    @InjectRepository(ExplainabilityRecordEntity) private readonly explanations: Repository<ExplainabilityRecordEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly modelDatasets: Repository<ModelDatasetEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(TestSetEntity) private readonly testSets: Repository<TestSetEntity>,
    @InjectRepository(TevvRunEntity) private readonly tevvRuns: Repository<TevvRunEntity>,
    @InjectRepository(ModelValidationEntity) private readonly validations: Repository<ModelValidationEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(ModelCardEntity) private readonly cards: Repository<ModelCardEntity>,
    @InjectRepository(ModelDeployerEntity) private readonly deployers: Repository<ModelDeployerEntity>,
    @InjectRepository(RiskEntity) private readonly risks: Repository<RiskEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly riskService: RisksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId, orgId) => {
      if (!orgId || !(await this.active(orgId))) return undefined;
      return { euAct: await this.modelFacts(modelId, orgId) };
    });
    addOrgFacts(async (orgId) => {
      if (!(await this.active(orgId))) return undefined;
      return { euAct: await this.orgFacts(orgId) };
    });
    // Art. 5 always blocks, whatever the gate mode; the market-entry steps follow the organisation's gate mode.
    this.riskService.addHardGateContributor(async (model, orgId) => {
      if (!(await this.active(orgId))) return [];
      const ws = await this.workspace(model.id);
      const a5 = art5Result(this.art5Of(ws));
      return a5.signed && a5.prohibited.length
        ? [{ code: 'eu_prohibited_practice' as const, message: `EU AI Act Art. 5: the signed screening records a prohibited practice (${a5.prohibited.join(', ')}); the system cannot be placed on the market or used` }]
        : [];
    });
    this.riskService.addGateContributor(async (model, orgId) => {
      if (!(await this.active(orgId))) return [];
      const f = await this.modelFacts(model.id, orgId);
      const out: GateFinding[] = [];
      if (!f.art5.signed) out.push({ code: 'eu_art5_unsigned', message: 'EU AI Act Art. 5: prohibited-practice screening not signed' });
      if (f.tier === 'High Risk' && f.roles.includes('PROVIDER')) {
        if (f.conformity.status !== 'PASSED') out.push({ code: 'eu_conformity_missing', message: 'EU AI Act Art. 43: no passed conformity assessment for this high-risk system' });
        if (!f.declaration.issued || f.declaration.stale) out.push({ code: 'eu_declaration_missing', message: 'EU AI Act Art. 47: no current EU declaration of conformity' });
      }
      if (f.registration.missing.length) out.push({ code: 'eu_registration_missing', message: `EU AI Act Art. 49: EU database registration missing (Annex VIII section ${f.registration.missing.join(', ')})` });
      if (f.fria.required && !f.fria.signed) out.push({ code: 'eu_fria_missing', message: 'EU AI Act Art. 27: no signed fundamental rights impact assessment before first use' });
      return out;
    });
    // Art. 25: a material change opens a substantial-modification assessment.
    this.riskService.onEvent(async (modelId, event, detail) => {
      if (!this.flags.isEnabled('euAiAct') || !MATERIAL_EVENTS.includes(event)) return;
      const orgId = await orgOfModel(this.models, this.projects, modelId);
      if (!orgId || !(await this.active(orgId))) return;
      const open = await this.rows.count({ where: { modelId, kind: 'CHANGE', status: 'OPEN' } });
      if (open) return;
      await this.rows.save(this.rows.create({
        id: uuidv4(), orgId, modelId, kind: 'CHANGE', status: 'OPEN', data: { event, ref: detail?.ref ?? null }, contentHash: null,
        signedBy: null, signedAt: null, dueAt: null, createdBy: 'system', createdAt: new Date(), updatedAt: new Date(),
      }));
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'euAiAct');
  }

  /** The EU workspace applies to an organisation that enabled the EU AI Act pack (flag on). */
  async active(orgId: string | null): Promise<boolean> {
    if (!orgId || !this.flags.isEnabled('euAiAct') || !this.flags.isEnabled('governanceSettings')) return false;
    return (await this.settings.inForce(orgId)).settings.enabledPacks.includes(EU_PACK_ID);
  }

  private async requireActive(orgId: string | null): Promise<void> {
    if (!(await this.active(orgId))) throw new ConflictException('The EU AI Act pack is not enabled for this organization; switch it on in Governance › Settings');
  }

  /* -------------------------------------------------------------- loading */

  private async workspace(modelId: string): Promise<Workspace> {
    const records = await this.rows.find({ where: { modelId }, order: { createdAt: 'DESC' } });
    return { profile: records.find((r) => r.kind === 'PROFILE') ?? null, records: records.filter((r) => r.kind !== 'PROFILE') };
  }

  private profileOf(ws: Workspace): Profile {
    return ws.profile?.data?.profile ?? {};
  }
  private art5Of(ws: Workspace): Art5Screening | null {
    return ws.profile?.data?.art5 ?? null;
  }
  private classOf(ws: Workspace): Classification | null {
    return ws.profile?.data?.classification ?? null;
  }

  private async ensureProfile(orgId: string, modelId: string, user: CurrentUser): Promise<EuActRecordEntity> {
    const existing = await this.rows.findOne({ where: { modelId, kind: 'PROFILE' } });
    if (existing) return existing;
    const now = new Date();
    return this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'PROFILE', status: 'ACTIVE', data: { profile: {}, art5: null, classification: null }, contentHash: null,
      signedBy: null, signedAt: null, dueAt: null, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
  }

  private async loadModel(user: CurrentUser, modelId: string) {
    this.assert();
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new NotFoundException('Model not found');
    await this.requireActive(orgId);
    return { model, orgId };
  }

  private async loadRecord(user: CurrentUser, id: string, kind?: string) {
    this.assert();
    const r = await this.rows.findOne({ where: { id } });
    if (!r || (kind && r.kind !== kind) || r.orgId !== orgFor(user, r.orgId)) throw new NotFoundException('Record not found');
    await this.requireActive(r.orgId);
    return r;
  }

  private async orgRecord(orgId: string): Promise<EuActRecordEntity | null> {
    return this.rows.findOne({ where: { orgId, kind: 'ORG' } });
  }

  private async params(orgId: string): Promise<Record<string, any>> {
    return (await governanceHooks.orgPackParams?.(orgId))?.values ?? {};
  }

  /* --------------------------------------------------------------- facts */

  async orgFacts(orgId: string) {
    const o = (await this.orgRecord(orgId))?.data ?? {};
    const models = await this.rows.find({ where: { orgId, kind: 'PROFILE' } });
    const outsideEuProvider = models.some((m) => (m.data?.profile?.roles ?? []).includes('PROVIDER') && m.data?.profile?.provider?.establishedInEu === false);
    return {
      authRepRequired: outsideEuProvider,
      authRep: !!(o.authorisedRep?.name && o.authorisedRep?.contact && o.authorisedRep?.mandateRef),
      logRetention: o.logRetention ?? {},
      logStores: [...EU_LOG_STORES],
    };
  }

  async modelFacts(modelId: string, orgId: string, now = new Date()) {
    const model = await this.models.findOne({ where: { id: modelId } });
    const ws = await this.workspace(modelId);
    const p = this.profileOf(ws);
    const a5 = art5Result(this.art5Of(ws));
    const cls = this.classOf(ws);
    const derived = deriveTier(p, this.art5Of(ws), cls, now);
    const roles: string[] = p.roles ?? [];
    const has = (r: string) => roles.includes(r);
    const provider = has('PROVIDER');
    const deployer = has('DEPLOYER');
    const high = derived.tier === 'High Risk';
    const recs = (k: string) => ws.records.filter((r) => r.kind === k);
    const conformity = recs('CONFORMITY')[0] ?? null;
    const declaration = recs('DECLARATION').find((d) => d.status === 'ISSUED') ?? null;
    const regs = recs('REGISTRATION');

    // Annex IV
    const ax = annexIV(await this.annexIVInput(model!, p, declaration));
    // Art. 13
    const ifu = provider && high ? instructionsForUse(await this.instructionsInput(model!, p)).missing : [];
    // Art. 16
    const providerMissing: string[] = [];
    if (provider) {
      if (!p.provider?.name || !p.provider?.contact || !p.provider?.address) providerMissing.push('provider name, address and contact');
      if (p.accessibility?.applies === undefined || p.accessibility?.applies === null) providerMissing.push('accessibility requirements answered');
      else if (p.accessibility.applies && !p.accessibility.evidenceRef) providerMissing.push('accessibility evidence');
    }
    // Conformity
    const nbRequired = high && (cls?.annexIII ?? []).some((c) => c.startsWith('1')) && p.annexIV?.harmonisedFullyApplied !== true;
    const conf = {
      status: conformity?.status ?? 'NONE',
      route: conformity?.data?.route ?? null,
      at: conformity?.signedAt?.toISOString().slice(0, 10) ?? null,
      problem: nbRequired && conformity?.data?.route === 'INTERNAL_CONTROL' ? 'Annex III point 1 without harmonised standards fully applied needs a notified body (Art. 43(1))' : null,
    };
    // CE
    const ceProblem = p.ce?.affixedAt && !declaration ? 'CE marking recorded without an EU declaration of conformity' : p.ce?.affixedAt && conf.route === 'NOTIFIED_BODY' && !p.ce?.notifiedBodyNumber ? 'CE marking needs the notified body’s identification number (Art. 48(4))' : null;
    // Registration
    const regRequired = registrationSections(roles, derived.tier, derived.derogation, p);
    const regMissing = regRequired.filter((s) => !regs.some((r) => r.data?.section === s && r.status === 'REGISTERED'));
    // Art. 50
    const a50: string[] = [];
    if (provider && p.art50?.interactsWithPersons && !p.art50?.obviousToPersons && !(p.art50?.noticeText && p.art50?.noticeEvidenceRef)) a50.push('AI interaction notice text and evidence (Art. 50(1))');
    if (provider && p.art50?.syntheticOutputs && !(p.art50?.markingMethod && p.art50?.markingTestResult === 'PASS')) a50.push('machine-readable output marking with a passing test (Art. 50(2))');
    if (deployer && p.art50?.emotionOrBiometricDeployer && !p.art50?.personsInformedRef) a50.push('notice to persons exposed to emotion recognition or biometric categorisation (Art. 50(3))');
    if (deployer && p.art50?.deepfakeOrPublicText && !p.art50?.disclosureRef) a50.push('deep fake or AI-generated text disclosure (Art. 50(4))');
    if (p.art50?.interactsWithPersons === undefined && p.art50?.syntheticOutputs === undefined) a50.push('Art. 50 questions answered');
    // Art. 10
    const dataMissing: string[] = [];
    if (provider && high) {
      if (!p.data?.representativeness) dataMissing.push('representativeness');
      if (!p.data?.statisticalProperties) dataMissing.push('statistical properties');
      if (!p.data?.knownGaps) dataMissing.push('known data gaps');
      if (p.data?.specialCategoryUsed && !(p.data?.specialCategory?.purpose && p.data?.specialCategory?.pseudonymisation && p.data?.specialCategory?.accessControls && p.data?.specialCategory?.deleteBy)) dataMissing.push('Art. 10(5) safeguards (purpose, pseudonymisation, access, deletion date)');
    }
    // Art. 26
    const depMissing: string[] = [];
    if (deployer && high) {
      if (p.deployer?.controlsInputData && !(p.deployer?.inputSuitability && p.deployer?.inputCheckedAt)) depMissing.push('input data suitability check (Art. 26(4))');
      const employment = (cls?.annexIII ?? []).some((c) => c.startsWith('4'));
      if ((employment || p.deployer?.workplace) && !(p.deployer?.workersInformedAt && p.deployer?.workersConsultationRef)) depMissing.push('workers’ representatives and workers informed (Art. 26(7))');
      if (!(p.deployer?.personNoticeTemplate && p.deployer?.personNoticeFirstSentAt)) depMissing.push('notice to affected persons (Art. 26(11))');
    }
    // Art. 27
    const ia = await this.impacts.findOne({ where: { modelId }, order: { version: 'DESC' } });
    const friaSigned = !!ia && ['FINAL'].includes(ia.status) && (ia.packIds ?? []).includes('eu-fria');
    const friaRequired = deployer && high && (p.fria?.required === true || p.market?.publicAuthorityDeployer === true || (cls?.annexIII ?? []).some((c) => c === '5(b)' || c === '5(c)'));
    // Art. 53
    const gpaiApplies = !!(p.gpai?.isGpaiProvider || p.gpai?.usesUpstreamGpai);
    const gpaiMissing: string[] = [];
    if (p.gpai?.isGpaiProvider) {
      if (now.getTime() >= Date.parse(APPLICATION_DATES.gpai)) {
        if (!p.gpai.annexXIDocRef) gpaiMissing.push('Annex XI technical documentation');
        if (!p.gpai.annexXIIDocRef) gpaiMissing.push('Annex XII information for downstream providers');
        if (!p.gpai.copyrightPolicyRef) gpaiMissing.push('copyright policy');
        if (!p.gpai.trainingSummaryUrl) gpaiMissing.push('public training-content summary');
      }
    }
    if (p.gpai?.usesUpstreamGpai) {
      if (!p.gpai.upstreamProvider) gpaiMissing.push('upstream GPAI provider');
      if (!p.gpai.upstreamAnnexXIIRef) gpaiMissing.push('upstream Annex XII information');
    }
    // Art. 23–24
    const verifyMissing = IMPORTER_CHECKS.filter((c) => c.roles.some((r) => has(r)) && p.verification?.[c.key] !== true).map((c) => c.label.replace(/ \(Art\..*$/, ''));
    if ((has('IMPORTER') || has('DISTRIBUTOR')) && !p.verification?.verifiedAt) verifyMissing.push('verification date');
    // Art. 72
    const pmmMissing: string[] = [];
    if (provider && high) for (const [k, l] of [['dataCollected', 'data collected'], ['metrics', 'metrics'], ['reviewFrequencyMonths', 'review frequency'], ['owner', 'owner']]) if (!get(p, `pmm.${k}`)) pmmMissing.push(l);
    const freq = Number(p.pmm?.reviewFrequencyMonths ?? 0);
    const pmmOverdue = provider && high && freq > 0 && (!p.pmm?.lastReviewAt || addMonths(new Date(p.pmm.lastReviewAt), freq).getTime() < now.getTime()) && !!p.market?.placedOnMarketAt;
    // Art. 73
    const incs = await this.incidents.find({ where: { modelId } });
    const incStatus = incs.map((i) => euIncidentStatus(i.governanceExt?.euAct, i, now, roles));
    // Art. 20, 25, 60, 86
    const nonconf = recs('NONCONFORMITY');
    const changes = recs('CHANGE');
    const rwt = recs('RWT_PLAN');
    const rwtMissing = rwt.filter((r) => !(r.data?.registrationRef && r.data?.authorityApprovalRef && r.data?.consentRefs?.length)).map((r) => `plan ${r.data?.title ?? r.id}: registration, approval and consent`);
    const expl = recs('EXPLANATION');
    // Art. 18 retention
    const placed = p.market?.placedOnMarketAt ? new Date(p.market.placedOnMarketAt) : null;
    const docIds = [p.annexIV?.technicalDocumentationDocId, p.annexIV?.qmsDocId, ...recs('DECLARATION').map((d) => d.data?.documentId), conformity?.data?.notifiedBody?.certificateDocId].filter(Boolean) as string[];
    const until = placed ? new Date(placed.getTime()) : null;
    if (until) until.setUTCFullYear(until.getUTCFullYear() + EU_DOC_RETENTION_YEARS);
    const docs = docIds.length ? await this.documents.find({ where: { id: In(docIds), orgId } }) : [];
    const short = until ? docs.filter((d) => !d.retentionUntil || d.retentionUntil.getTime() < until.getTime()).map((d) => d.title) : [];

    return {
      roles,
      scopeDecided: p.scope?.placedOnEuMarket !== undefined && p.scope?.placedOnEuMarket !== null && !!p.scope?.exclusion,
      inScope: p.scope?.exclusion && p.scope.exclusion !== 'NONE' ? false : p.scope?.placedOnEuMarket || p.scope?.outputUsedInEu ? true : p.scope?.placedOnEuMarket === false && p.scope?.outputUsedInEu === false ? false : null,
      tier: derived.tier,
      hint: model ? (model.functionalArea || '').toLowerCase() : null,
      basis: derived.basis,
      highRisk: derived.highRisk,
      derogation: derived.derogation,
      art5: a5,
      classification: { signed: !!cls?.signedAt, annexIII: cls?.annexIII ?? [], derogation: cls?.derogation ?? null, profiling: cls?.profiling ?? null },
      provider: { missing: providerMissing },
      annexIV: { score: provider && high ? ax.score : 100, missing: provider && high ? ax.missing : [] },
      instructions: { missing: ifu },
      conformity: provider && high ? conf : { status: 'PASSED', route: 'NOT_REQUIRED', at: null, problem: null },
      declaration: provider && high
        ? { issued: !!declaration, stale: !!declaration?.data?.stale, issuedAt: declaration?.signedAt?.toISOString().slice(0, 10) ?? null }
        : { issued: true, stale: false, issuedAt: null },
      ce: provider && high ? { affixed: !!p.ce?.affixedAt, form: p.ce?.form ?? null, at: p.ce?.affixedAt ?? null, problem: ceProblem } : { affixed: true, form: null, at: null, problem: null },
      registration: { required: regRequired, missing: regMissing },
      art50: { missing: a50 },
      data: { missing: dataMissing },
      deployer: { missing: depMissing },
      fria: { required: friaRequired, signed: friaSigned, notified: !!p.fria?.authorityNotifiedAt, notifiedAt: p.fria?.authorityNotifiedAt ?? null },
      gpai: { applies: gpaiApplies, missing: gpaiMissing },
      verification: { missing: has('IMPORTER') || has('DISTRIBUTOR') ? verifyMissing : [] },
      valueChain: { open: changes.filter((c) => c.status === 'OPEN').length, assessed: changes.filter((c) => c.status !== 'OPEN').length },
      nonconformity: {
        open: nonconf.filter((n) => n.status === 'OPEN').length,
        informPending: nonconf.filter((n) => n.status !== 'OPEN' && n.data?.presentsRisk && !n.data?.informed?.authority).length,
        closed: nonconf.filter((n) => n.status === 'CLOSED').length,
      },
      rwt: { plans: rwt.length, missing: rwtMissing },
      pmm: { missing: pmmMissing, reviewOverdue: pmmOverdue, lastReviewAt: p.pmm?.lastReviewAt ?? null, frequency: freq ? `${freq} months` : null },
      incidents: {
        serious: incStatus.filter((s) => s.serious).length,
        overdue: incStatus.filter((s) => s.overdue).length,
        problems: [...new Set(incStatus.flatMap((s) => s.problems))],
      },
      explanations: {
        open: expl.filter((e) => e.status === 'RECEIVED').length,
        overdue: expl.filter((e) => e.status === 'RECEIVED' && e.dueAt && e.dueAt.getTime() < now.getTime()).length,
        answered: expl.filter((e) => e.status === 'ANSWERED').length,
      },
      retention: { applies: !!until && docs.length > 0, short, until: until?.toISOString().slice(0, 10) ?? null },
      legacy: !!p.market?.legacyBeforeAug2026,
    };
  }

  private async annexIVInput(model: AIModelEntity, profile: Profile, declaration: EuActRecordEntity | null) {
    const links = await this.modelDatasets.find({ where: { modelId: model.id } });
    const sets = links.length ? await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } }) : [];
    const ts = await this.testSets.find({ where: { modelId: model.id, active: true } });
    const runs = ts.length ? await this.tevvRuns.find({ where: { modelId: model.id }, order: { runAt: 'DESC' } }) : [];
    const latest = (id: string) => runs.find((r) => r.testSetId === id);
    const segments = [...new Set(ts.flatMap((t) => Object.keys((latest(t.id)?.results as any)?.segments ?? {})))];
    const assessed = await this.risks.count({ where: { scopeType: 'MODEL', scopeId: model.id, status: In(['ASSESSED', 'ACCEPTED', 'REVIEW_DUE']) } });
    return {
      model: {
        name: model.name, modelType: model.modelType, functionalArea: model.functionalArea, useCaseDescription: model.useCaseDescription, developedBy: model.developedBy,
        ownerTeam: model.ownerTeam, humanOversightRequired: model.humanOversightRequired, sourceRefs: model.sourceRefs ?? (model.sourceRef ? [model.sourceRef] : []),
        dependencies: model.dependencies ?? [], performanceBenchmarks: model.performanceBenchmarks ?? [],
      },
      profile,
      contextProfile: model.contextProfile,
      datasets: sets.map((d) => ({ name: d.name, provenance: d.provenance, lawfulBasis: d.lawfulBasis })),
      tevv: { testSets: ts.length, withCriteria: ts.filter((t) => t.criteria && Object.keys(t.criteria).length).length, latestPassing: ts.filter((t) => latest(t.id)?.passed).length, segments },
      validations: await this.validations.count({ where: { modelId: model.id } }),
      risks: { assessed },
      cardVersions: await this.cards.count({ where: { modelId: model.id } }),
      ledgerEvents: await this.ledger.count({ where: { modelId: model.id } }),
      declaration: declaration ? { issuedAt: (declaration.signedAt ?? declaration.createdAt).toISOString(), hash: declaration.contentHash ?? '' } : null,
    };
  }

  private async instructionsInput(model: AIModelEntity, profile: Profile) {
    const ts = await this.testSets.find({ where: { modelId: model.id, active: true } });
    const runs = ts.length ? await this.tevvRuns.find({ where: { modelId: model.id }, order: { runAt: 'DESC' } }) : [];
    const riskRows = await this.risks.find({ where: { scopeType: 'MODEL', scopeId: model.id, status: In(['ASSESSED', 'ACCEPTED', 'REVIEW_DUE']) } });
    return {
      model: { id: model.id, name: model.name, useCaseDescription: model.useCaseDescription, humanOversightRequired: model.humanOversightRequired, modelType: model.modelType },
      profile,
      contextProfile: model.contextProfile,
      tevv: ts.map((t) => {
        const r = runs.find((x) => x.testSetId === t.id);
        return { name: t.name, criteria: t.criteria, latest: r ? { passed: r.passed, results: r.results, runAt: r.runAt.toISOString() } : null };
      }),
      risks: riskRows.map((r) => r.category),
    };
  }

  /* ---------------------------------------------------------------- views */

  async overview(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const active = await this.active(orgId);
    const org = await this.orgRecord(orgId);
    const models = active ? await scopedOrgModels(this.models, this.projects, orgId) : [];
    const rows: Array<Record<string, any>> = [];
    for (const m of models) {
      const f = await this.modelFacts(m.id, orgId);
      const open = [f.art5.signed ? null : 'Art. 5', f.classification.signed ? null : 'Art. 6', f.conformity.status === 'PASSED' ? null : 'Art. 43', f.registration.missing.length ? 'Art. 49' : null, f.incidents.overdue ? 'Art. 73' : null].filter(Boolean);
      rows.push({ model_id: m.id, name: m.name, roles: f.roles, tier: f.tier, hint: m.functionalArea, prohibited: f.art5.prohibited.length > 0, open_items: open });
    }
    return {
      org_id: orgId, active, pack_id: EU_PACK_ID,
      org: { authorised_rep: org?.data?.authorisedRep ?? null, log_retention: org?.data?.logRetention ?? {}, facts: active ? await this.orgFacts(orgId) : null },
      log_retention_minimum_months: Number((await this.params(orgId)).logRetentionMonths ?? EU_LOG_RETENTION_MONTHS),
      models: rows,
      reference: { roles: ['PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REP'], log_stores: EU_LOG_STORES },
    };
  }

  async putOrg(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'change the EU AI Act organisation record');
    const orgId = orgFor(user, body.org_id);
    await this.requireActive(orgId);
    const minMonths = Number((await this.params(orgId)).logRetentionMonths ?? EU_LOG_RETENTION_MONTHS);
    const current = (await this.orgRecord(orgId)) ?? null;
    const data = { ...(current?.data ?? {}) };
    if (body.authorised_rep !== undefined) {
      const a = body.authorised_rep;
      data.authorisedRep = a === null ? null : {
        name: reqText(a?.name, 'authorised_rep.name', 2, 300), contact: reqText(a?.contact, 'authorised_rep.contact', 3, 500),
        mandateRef: reqText(a?.mandate_ref, 'authorised_rep.mandate_ref (the written mandate document)', 3, 500), mandateDate: optDate(a?.mandate_date, 'authorised_rep.mandate_date')?.toISOString().slice(0, 10) ?? null,
      };
    }
    if (body.log_retention !== undefined) {
      const out: Record<string, number> = {};
      for (const s of EU_LOG_STORES) {
        const v = body.log_retention?.[s];
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 1200) throw new BadRequestException(`log_retention.${s} must be whole months`);
        if (n < minMonths) throw new BadRequestException(`log_retention.${s}: the EU AI Act needs logs kept at least ${minMonths} months (Art. 19, 26(6))`);
        out[s] = n;
      }
      data.logRetention = out;
    }
    const now = new Date();
    const row = current ?? this.rows.create({ id: uuidv4(), orgId, modelId: null, kind: 'ORG', status: 'ACTIVE', contentHash: null, signedBy: null, signedAt: null, dueAt: null, createdBy: user.email, createdAt: now });
    row.data = data;
    row.updatedAt = now;
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_org_record: { org_id: orgId } };
    return this.overview(user, { org_id: orgId });
  }

  async get(user: CurrentUser, modelId: string) {
    const { model, orgId } = await this.loadModel(user, modelId);
    const ws = await this.workspace(modelId);
    const facts = await this.modelFacts(modelId, orgId);
    const p = this.profileOf(ws);
    const decl = ws.records.find((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED') ?? null;
    const ax = annexIV(await this.annexIVInput(model, p, decl));
    const incs = await this.incidents.find({ where: { modelId }, order: { detectedAt: 'DESC' }, take: 50 });
    return {
      model_id: modelId, model_name: model.name, functional_area: model.functionalArea,
      profile: p,
      art5: { ...(this.art5Of(ws) ?? { answers: {} }), result: art5Result(this.art5Of(ws)) },
      classification: this.classOf(ws),
      tier: facts.tier, tier_basis: facts.basis,
      facts,
      annex_iv: ax,
      records: ws.records.map((r) => this.recordView(r)),
      incidents: incs.map((i) => ({ incident_id: i.id, severity: i.severity, status: i.status, detected_at: i.detectedAt, description: i.description.slice(0, 200), eu: i.governanceExt?.euAct ?? null, eu_status: euIncidentStatus(i.governanceExt?.euAct, i, new Date(), facts.roles) })),
      reference: { serious_classes: SERIOUS_INCIDENT_CLASSES, annex_vi: ANNEX_VI_ITEMS, nonconformity_actions: NONCONFORMITY_ACTIONS, importer_checks: IMPORTER_CHECKS },
    };
  }

  private recordView(r: EuActRecordEntity) {
    return { record_id: r.id, kind: r.kind, status: r.status, data: r.data, content_hash: r.contentHash, signed_by: r.signedBy, signed_at: r.signedAt, due_at: r.dueAt, created_by: r.createdBy, created_at: r.createdAt, updated_at: r.updatedAt };
  }

  /* --------------------------------------------------- profile, Art. 5, Art. 6 */

  async putProfile(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'edit the EU AI Act record');
    const row = await this.ensureProfile(orgId, modelId, user);
    const { profile, errors, changed } = mergeProfile(row.data?.profile ?? {}, body.profile ?? body);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    if (profile.deployer?.inputDatasetId) {
      const ds = await this.datasets.findOne({ where: { id: profile.deployer.inputDatasetId } });
      if (!ds || ds.orgId !== orgId) throw new BadRequestException('deployer.inputDatasetId must be a dataset of this organization');
    }
    for (const k of ['annexIV.technicalDocumentationDocId', 'annexIV.qmsDocId']) {
      const id = get(profile, k);
      if (id) {
        const d = await this.documents.findOne({ where: { id } });
        if (!d || d.orgId !== orgId) throw new BadRequestException(`${k} must be a controlled document of this organization`);
      }
    }
    row.data = { ...row.data, profile };
    row.updatedAt = new Date();
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_profile_updated: { model_id: modelId, fields: changed } };
    return this.get(user, modelId);
  }

  async putArt5(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'answer the Art. 5 screening');
    const { answers, errors } = parseArt5(body.answers ?? body);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    const row = await this.ensureProfile(orgId, modelId, user);
    // A changed answer clears the signature.
    row.data = { ...row.data, art5: { answers: { ...(row.data?.art5?.answers ?? {}), ...answers }, note: optText(body.note, 'note', 4000) ?? row.data?.art5?.note ?? null, signedBy: null, signedAt: null } };
    row.updatedAt = new Date();
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_art5_answered: { model_id: modelId } };
    return this.get(user, modelId);
  }

  async signArt5(user: CurrentUser, modelId: string, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, SIGNERS, 'sign the Art. 5 screening');
    const row = await this.ensureProfile(orgId, modelId, user);
    const r = art5Result(row.data?.art5);
    if (!r.complete) throw new BadRequestException(`Answer every Art. 5 question first (${r.unanswered.join(', ')})`);
    row.data = { ...row.data, art5: { ...row.data.art5, signedBy: user.email, signedAt: new Date().toISOString() } };
    row.updatedAt = new Date();
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_art5_signed: { model_id: modelId, prohibited: r.prohibited } };
    return this.get(user, modelId);
  }

  async putClassification(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'classify the system');
    const { value, errors } = parseClassification(body);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    const row = await this.ensureProfile(orgId, modelId, user);
    row.data = { ...row.data, classification: { ...value, signedBy: null, signedAt: null } };
    row.updatedAt = new Date();
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_classification_answered: { model_id: modelId, annex_iii: value.annexIII } };
    return this.get(user, modelId);
  }

  async signClassification(user: CurrentUser, modelId: string, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, SIGNERS, 'sign the classification');
    const row = await this.ensureProfile(orgId, modelId, user);
    const c = row.data?.classification as Classification | null;
    if (!c) throw new BadRequestException('Answer the classification first');
    if (c.annexIProduct === null || c.annexIProduct === undefined) throw new BadRequestException('Answer the Annex I product question first');
    if (c.annexIII.length && (c.profiling === null || c.profiling === undefined)) throw new BadRequestException('Answer whether the system profiles natural persons (Art. 6(3))');
    row.data = { ...row.data, classification: { ...c, signedBy: user.email, signedAt: new Date().toISOString() } };
    row.updatedAt = new Date();
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_classification_signed: { model_id: modelId } };
    return this.get(user, modelId);
  }

  /* --------------------------------------------- Art. 43, 47, 49 market entry */

  async saveConformity(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'record a conformity assessment');
    const route = oneOf(body.route, ['INTERNAL_CONTROL', 'NOTIFIED_BODY'] as const, 'route', 'INTERNAL_CONTROL');
    const items: Record<string, { ok: boolean; note: string | null }> = {};
    for (const it of ANNEX_VI_ITEMS) {
      const v = body.items?.[it.key];
      items[it.key] = { ok: v?.ok === true, note: optText(v?.note, `items.${it.key}.note`, 4000) };
    }
    let notifiedBody: Record<string, any> | null = null;
    if (route === 'NOTIFIED_BODY') {
      const nb = body.notified_body ?? {};
      notifiedBody = {
        name: reqText(nb.name, 'notified_body.name', 2, 300), number: reqText(nb.number, 'notified_body.number', 2, 20),
        certificateRef: reqText(nb.certificate_ref, 'notified_body.certificate_ref', 2, 300),
        certificateDocId: optText(nb.certificate_doc_id, 'notified_body.certificate_doc_id', 36),
        validUntil: optDate(nb.valid_until, 'notified_body.valid_until')?.toISOString().slice(0, 10) ?? null,
      };
      if (notifiedBody.certificateDocId) {
        const d = await this.documents.findOne({ where: { id: notifiedBody.certificateDocId } });
        if (!d || d.orgId !== orgId) throw new BadRequestException('notified_body.certificate_doc_id must be a controlled document of this organization');
      }
    }
    const open = await this.rows.findOne({ where: { modelId, kind: 'CONFORMITY', status: 'DRAFT' } });
    const now = new Date();
    const row = open ?? this.rows.create({ id: uuidv4(), orgId, modelId, kind: 'CONFORMITY', status: 'DRAFT', contentHash: null, signedBy: null, signedAt: null, dueAt: null, createdBy: user.email, createdAt: now });
    row.data = { route, items, notifiedBody, note: optText(body.note, 'note', 4000) };
    row.updatedAt = now;
    await this.rows.save(row);
    if (req) req.auditSummary = { eu_conformity_saved: { model_id: modelId, record_id: row.id } };
    return this.recordView(row);
  }

  async signConformity(user: CurrentUser, recordId: string, body: Record<string, any>, req?: any) {
    const r = await this.loadRecord(user, recordId, 'CONFORMITY');
    requireRole(user, OFFICERS, 'sign a conformity assessment');
    if (r.status !== 'DRAFT') throw new ConflictException('Only a draft assessment can be signed');
    const outcome = oneOf(body.outcome, ['PASSED', 'FAILED'] as const, 'outcome');
    const facts = await this.modelFacts(r.modelId!, r.orgId);
    if (outcome === 'PASSED') {
      const notOk = ANNEX_VI_ITEMS.filter((i) => !r.data?.items?.[i.key]?.ok).map((i) => i.key);
      if (notOk.length) throw new BadRequestException(`Every Annex VI item must be confirmed before a pass (${notOk.join(', ')})`);
      if (!facts.classification.signed) throw new BadRequestException('Sign the Annex III classification first');
      if (facts.annexIV.score < 100) throw new BadRequestException(`The Annex IV technical documentation is incomplete (${facts.annexIV.missing.join(', ')})`);
      if (facts.pmm.missing.length) throw new BadRequestException('The post-market monitoring plan is part of the technical documentation (Art. 72(3)); record it first');
      const nbNeeded = facts.highRisk && facts.classification.annexIII.some((c: string) => c.startsWith('1')) && (await this.workspace(r.modelId!)).profile?.data?.profile?.annexIV?.harmonisedFullyApplied !== true;
      if (nbNeeded && r.data?.route !== 'NOTIFIED_BODY') throw new BadRequestException('Annex III point 1 systems without fully applied harmonised standards need a notified body (Art. 43(1))');
    }
    // An earlier passed assessment is superseded.
    for (const prev of await this.rows.find({ where: { modelId: r.modelId!, kind: 'CONFORMITY', status: In(['PASSED', 'REASSESSMENT_DUE']) } })) {
      prev.status = 'SUPERSEDED';
      prev.updatedAt = new Date();
      await this.rows.save(prev);
    }
    r.status = outcome;
    r.signedBy = user.email;
    r.signedAt = new Date();
    r.contentHash = sha256(r.data);
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { eu_conformity_signed: { model_id: r.modelId, outcome } };
    return this.recordView(r);
  }

  async issueDeclaration(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { model, orgId } = await this.loadModel(user, modelId);
    requireRole(user, OFFICERS, 'issue an EU declaration of conformity');
    const ws = await this.workspace(modelId);
    const conf = ws.records.find((r) => r.kind === 'CONFORMITY' && r.status === 'PASSED');
    if (!conf) throw new BadRequestException('A passed conformity assessment comes first (Art. 47(1))');
    const p = this.profileOf(ws);
    if (!p.provider?.name || !p.provider?.address) throw new BadRequestException('Record the provider name and address first (Annex V point 2)');
    const links = await this.modelDatasets.find({ where: { modelId } });
    const personal = links.length ? (await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } })).some((d) => d.personalData) : false;
    const issuedAt = new Date();
    const content = declarationContent({
      model: { id: model.id, name: model.name, modelType: model.modelType }, profile: p,
      conformity: { route: conf.data.route, notifiedBody: conf.data.notifiedBody }, personalData: personal,
      signer: { name: reqText(body.signer_name, 'signer_name', 2, 200), function: reqText(body.signer_function, 'signer_function', 2, 200) },
      place: reqText(body.place, 'place', 2, 200), issuedAt,
    });
    const org = await this.orgRecord(orgId);
    content.provider.authorised_representative = org?.data?.authorisedRep ? { name: org.data.authorisedRep.name, contact: org.data.authorisedRep.contact } : null;
    const documentId = optText(body.document_id, 'document_id', 36);
    if (documentId) {
      const d = await this.documents.findOne({ where: { id: documentId } });
      if (!d || d.orgId !== orgId) throw new BadRequestException('document_id must be a controlled document of this organization');
    }
    for (const prev of ws.records.filter((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED')) {
      prev.status = 'SUPERSEDED';
      prev.updatedAt = issuedAt;
      await this.rows.save(prev);
    }
    const placed = p.market?.placedOnMarketAt ? new Date(p.market.placedOnMarketAt) : issuedAt;
    const keepUntil = new Date(placed.getTime());
    keepUntil.setUTCFullYear(keepUntil.getUTCFullYear() + EU_DOC_RETENTION_YEARS);
    const row = await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'DECLARATION', status: 'ISSUED', data: { content, conformityId: conf.id, documentId, keepUntil: keepUntil.toISOString().slice(0, 10) },
      contentHash: sha256(content), signedBy: user.email, signedAt: issuedAt, dueAt: keepUntil, createdBy: user.email, createdAt: issuedAt, updatedAt: issuedAt,
    }));
    if (req) req.auditSummary = { eu_declaration_issued: { model_id: modelId, record_id: row.id, hash: row.contentHash } };
    return this.recordView(row);
  }

  async register(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'record an EU database registration');
    const section = oneOf(body.section, ['A', 'B', 'C'] as const, 'section');
    const facts = await this.modelFacts(modelId, orgId);
    if (!facts.registration.required.includes(section)) {
      throw new BadRequestException(`Annex VIII section ${section} does not apply to this system (needed: ${facts.registration.required.join(', ') || 'none'})`);
    }
    const registeredAt = optDate(body.registered_at, 'registered_at') ?? new Date();
    if (isFuture(registeredAt, body.registered_at)) throw new BadRequestException('registered_at cannot be in the future');
    const euDatabaseId = reqText(body.eu_database_id, 'eu_database_id', 2, 100);
    for (const prev of await this.rows.find({ where: { modelId, kind: 'REGISTRATION', status: 'REGISTERED' } })) {
      if (prev.data?.section !== section) continue;
      prev.status = 'SUPERSEDED';
      prev.updatedAt = new Date();
      await this.rows.save(prev);
    }
    const snapshot = await this.annexVIIIFor(modelId, orgId, section);
    const now = new Date();
    const row = await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'REGISTRATION', status: 'REGISTERED', data: { section, euDatabaseId, registeredAt: registeredAt.toISOString().slice(0, 10), snapshot, entryUrl: optText(body.entry_url, 'entry_url', 500) },
      contentHash: sha256(snapshot), signedBy: user.email, signedAt: now, dueAt: null, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { eu_registered: { model_id: modelId, section, eu_database_id: euDatabaseId } };
    return this.recordView(row);
  }

  private async annexVIIIFor(modelId: string, orgId: string, section: 'A' | 'B' | 'C') {
    const model = (await this.models.findOne({ where: { id: modelId } }))!;
    const ws = await this.workspace(modelId);
    const org = await this.orgRecord(orgId);
    const orgRow = await this.orgs.findOne({ where: { id: orgId } });
    const conf = ws.records.find((r) => r.kind === 'CONFORMITY' && r.status === 'PASSED');
    const decl = ws.records.find((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED');
    const ia = await this.impacts.findOne({ where: { modelId }, order: { version: 'DESC' } });
    const providerReg = ws.records.find((r) => r.kind === 'REGISTRATION' && r.status === 'REGISTERED' && r.data?.section === 'A');
    return annexVIII(section, {
      model: { id: model.id, name: model.name, useCaseDescription: model.useCaseDescription, modelType: model.modelType, functionalArea: model.functionalArea },
      profile: this.profileOf(ws),
      authorisedRep: org?.data?.authorisedRep ?? null,
      classification: this.classOf(ws),
      conformity: conf ? { notifiedBody: conf.data?.notifiedBody ?? null } : null,
      declaration: decl ? { id: decl.id, issuedAt: (decl.signedAt ?? decl.createdAt).toISOString(), hash: decl.contentHash ?? '' } : null,
      fria: ia && (ia.packIds ?? []).includes('eu-fria') ? { status: ia.status, version: ia.version, signedAt: ia.signedAt?.toISOString().slice(0, 10) ?? null } : null,
      deployerName: orgRow?.name ?? null,
      providerEntryUrl: providerReg?.data?.entryUrl ?? null,
    });
  }

  /* ------------------------------------------------------------- exports */

  async exportDoc(user: CurrentUser, modelId: string, kind: string, q: Record<string, string>): Promise<{ body: string; type: string; filename: string }> {
    const { model, orgId } = await this.loadModel(user, modelId);
    const ws = await this.workspace(modelId);
    const p = this.profileOf(ws);
    const slug = model.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const json = (o: any, name: string) => ({ body: JSON.stringify(o, null, 2), type: 'application/json', filename: `${slug}-${name}.json` });
    if (kind === 'annex-iv') {
      const decl = ws.records.find((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED') ?? null;
      const a = annexIV(await this.annexIVInput(model, p, decl));
      if ((q.format ?? 'json') === 'md') return { body: annexIVMarkdown(model.name, a, new Date()), type: 'text/markdown; charset=utf-8', filename: `${slug}-annex-iv.md` };
      return json({ model_id: modelId, generated_at: new Date(), ...a }, 'annex-iv');
    }
    if (kind === 'instructions') return json(instructionsForUse(await this.instructionsInput(model, p)), 'instructions-for-use');
    if (kind === 'annex-viii') {
      const section = oneOf(q.section, ['A', 'B', 'C'] as const, 'section', 'A');
      return json(await this.annexVIIIFor(modelId, orgId, section), `annex-viii-${section}`);
    }
    if (kind === 'declaration') {
      const decl = ws.records.find((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED');
      if (!decl) throw new NotFoundException('No EU declaration of conformity issued');
      return json({ ...decl.data.content, content_hash: decl.contentHash, keep_until: decl.data.keepUntil }, 'eu-declaration-of-conformity');
    }
    if (kind === 'authority') {
      // Art. 21: documentation and logs for one system on a reasoned request.
      const from = optDate(q.from, 'from') ?? new Date(Date.now() - 180 * DAY_MS);
      const to = optDate(q.to, 'to') ?? new Date();
      if (from.getTime() > to.getTime()) throw new BadRequestException('from must be before to');
      const decl = ws.records.find((r) => r.kind === 'DECLARATION' && r.status === 'ISSUED') ?? null;
      const events = await this.ledger.find({ where: { modelId, occurredAt: Between(from, to) }, order: { occurredAt: 'ASC' }, take: 10_000 });
      const incs = await this.incidents.find({ where: { modelId } });
      return json({
        title: 'EU AI Act Art. 21 authority request bundle', model_id: modelId, period: { from, to }, generated_at: new Date(), generated_by: user.email,
        technical_documentation: annexIV(await this.annexIVInput(model, p, decl)),
        declaration: decl?.data?.content ?? null,
        registrations: ws.records.filter((r) => r.kind === 'REGISTRATION').map((r) => this.recordView(r)),
        conformity: ws.records.filter((r) => r.kind === 'CONFORMITY').map((r) => this.recordView(r)),
        logs: events.map((e) => ({ at: e.occurredAt, type: e.eventType, actor: e.actor, data: e.eventData })),
        incidents: incs.map((i) => ({ id: i.id, severity: i.severity, status: i.status, detected_at: i.detectedAt, eu: i.governanceExt?.euAct ?? null })),
      }, 'authority-bundle');
    }
    throw new NotFoundException('Unknown export');
  }

  /* --------------------------------------- Art. 20, 25, 60 and 18 records */

  async addNonconformity(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'record a non-conformity');
    const action = oneOf(body.action, NONCONFORMITY_ACTIONS, 'action');
    const deps = await this.deployers.find({ where: { modelId, active: true } });
    const now = new Date();
    const row = await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'NONCONFORMITY', status: 'OPEN',
      data: {
        action, description: reqText(body.description, 'description', 10, 4000), presentsRisk: body.presents_risk === true,
        toInform: { deployers: deps.map((d) => d.name), distributors: [], importers: [] }, informed: {},
      },
      contentHash: null, signedBy: null, signedAt: null, dueAt: null, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { eu_nonconformity: { model_id: modelId, action } };
    return this.recordView(row);
  }

  async updateNonconformity(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    const r = await this.loadRecord(user, id, 'NONCONFORMITY');
    requireRole(user, MAINTAINERS, 'update a non-conformity');
    const informed = { ...(r.data.informed ?? {}) };
    for (const k of ['deployers', 'distributors', 'importers', 'authorisedRep', 'authority']) {
      if (body.informed?.[k] === undefined) continue;
      const d = optDate(body.informed[k], `informed.${k}`);
      informed[k] = d ? d.toISOString().slice(0, 10) : null;
    }
    r.data = { ...r.data, informed, authorityRef: optText(body.authority_ref, 'authority_ref', 300) ?? r.data.authorityRef ?? null, outcome: optText(body.outcome, 'outcome', 4000) ?? r.data.outcome ?? null };
    if (body.status) {
      const status = oneOf(body.status, ['OPEN', 'ACTIONED', 'CLOSED'] as const, 'status');
      if (status === 'CLOSED') {
        if (!r.data.outcome) throw new BadRequestException('Record the outcome before closing');
        if ((r.data.toInform?.deployers ?? []).length && !informed.deployers) throw new BadRequestException('Deployers must be informed (Art. 20(1))');
        if (r.data.presentsRisk && !informed.authority) throw new BadRequestException('The system presents a risk: inform the market surveillance authority first (Art. 20(2))');
      }
      r.status = status;
    }
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { eu_nonconformity_updated: { record_id: id, status: r.status } };
    return this.recordView(r);
  }

  async assessChange(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    const r = await this.loadRecord(user, id, 'CHANGE');
    requireRole(user, SIGNERS, 'assess a change under Art. 25');
    if (r.status !== 'OPEN') throw new ConflictException('This change has already been assessed');
    const b = (k: string) => { if (typeof body[k] !== 'boolean') throw new BadRequestException(`${k} must be true or false`); return body[k] as boolean; };
    const substantial = b('substantial_modification');
    const purpose = b('purpose_changed_to_high_risk');
    const ownName = b('own_name_or_trademark');
    const reasoning = reqText(body.reasoning, 'reasoning', 20, 4000);
    const becomesProvider = substantial || purpose || ownName;
    r.data = { ...r.data, substantial, purpose, ownName, reasoning, becomesProvider };
    r.status = becomesProvider ? 'PROVIDER_DUTIES' : 'NOT_SUBSTANTIAL';
    r.signedBy = user.email;
    r.signedAt = new Date();
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (becomesProvider) {
      const prof = await this.ensureProfile(r.orgId, r.modelId!, user);
      const roles = new Set<string>(prof.data?.profile?.roles ?? []);
      roles.add('PROVIDER');
      prof.data = { ...prof.data, profile: { ...(prof.data?.profile ?? {}), roles: [...roles] } };
      prof.updatedAt = new Date();
      await this.rows.save(prof);
      // Art. 43(4): a new conformity assessment, and the declaration needs re-issuing.
      for (const c of await this.rows.find({ where: { modelId: r.modelId!, kind: 'CONFORMITY', status: 'PASSED' } })) {
        c.status = 'REASSESSMENT_DUE';
        c.updatedAt = new Date();
        await this.rows.save(c);
      }
      for (const d of await this.rows.find({ where: { modelId: r.modelId!, kind: 'DECLARATION', status: 'ISSUED' } })) {
        d.data = { ...d.data, stale: true };
        d.updatedAt = new Date();
        await this.rows.save(d);
      }
    }
    if (req) req.auditSummary = { eu_change_assessed: { record_id: id, becomes_provider: becomesProvider } };
    return this.recordView(r);
  }

  async addRealWorldTest(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'record a real-world testing plan');
    const start = optDate(body.start_at, 'start_at');
    const end = optDate(body.end_at, 'end_at');
    if (start && end && end.getTime() < start.getTime()) throw new BadRequestException('end_at must be after start_at');
    if (start && end && end.getTime() - start.getTime() > 365 * DAY_MS) throw new BadRequestException('Testing in real-world conditions lasts at most six months, extendable once by six months (Art. 60(4)(f))');
    const consent = Array.isArray(body.consent_refs) ? body.consent_refs.map(String).filter(Boolean).slice(0, 100) : [];
    const now = new Date();
    const row = await this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'RWT_PLAN', status: 'PLANNED',
      data: {
        title: reqText(body.title, 'title', 3, 200), plan: reqText(body.plan, 'plan', 20, 8000),
        registrationRef: optText(body.registration_ref, 'registration_ref', 300), authorityApprovalRef: optText(body.authority_approval_ref, 'authority_approval_ref', 300),
        approvedAt: optDate(body.approved_at, 'approved_at')?.toISOString().slice(0, 10) ?? null,
        startAt: start?.toISOString().slice(0, 10) ?? null, endAt: end?.toISOString().slice(0, 10) ?? null, consentRefs: consent,
        withdrawal: optText(body.withdrawal_procedure, 'withdrawal_procedure', 4000), dataDeletionBy: optDate(body.data_deletion_by, 'data_deletion_by')?.toISOString().slice(0, 10) ?? null,
        oversight: optText(body.oversight, 'oversight', 4000),
      },
      contentHash: null, signedBy: null, signedAt: null, dueAt: end, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { eu_rwt_plan: { model_id: modelId, record_id: row.id } };
    return this.recordView(row);
  }

  /** Art. 18: extend the retention of the system's controlled documents to ten years from the market date. */
  async applyRetention(user: CurrentUser, modelId: string, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, OFFICERS, 'change document retention');
    const f = await this.modelFacts(modelId, orgId);
    if (!f.retention.until) throw new BadRequestException('Record the date the system was placed on the market first');
    const ws = await this.workspace(modelId);
    const p = this.profileOf(ws);
    const conf = ws.records.find((r) => r.kind === 'CONFORMITY' && ['PASSED', 'REASSESSMENT_DUE'].includes(r.status));
    const ids = [p.annexIV?.technicalDocumentationDocId, p.annexIV?.qmsDocId, ...ws.records.filter((r) => r.kind === 'DECLARATION').map((d) => d.data?.documentId), conf?.data?.notifiedBody?.certificateDocId].filter(Boolean) as string[];
    const until = new Date(f.retention.until);
    const changed: string[] = [];
    for (const d of ids.length ? await this.documents.find({ where: { id: In(ids), orgId } }) : []) {
      if (d.retentionUntil && d.retentionUntil.getTime() >= until.getTime()) continue;
      d.retentionUntil = until;
      d.updatedAt = new Date();
      await this.documents.save(d);
      changed.push(d.title);
    }
    if (req) req.auditSummary = { eu_retention_applied: { model_id: modelId, documents: changed.length } };
    return { model_id: modelId, retention_until: f.retention.until, extended: changed };
  }

  /* --------------------------------------------------------- Art. 73 */

  private async loadIncident(user: CurrentUser, id: string) {
    this.assert();
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw new NotFoundException('Incident not found');
    const orgId = inc.projectId ? (await this.projects.findOne({ where: { id: inc.projectId } }))?.tenantId ?? null : await orgOfModel(this.models, this.projects, inc.modelId);
    if (user.role !== Role.ADMIN && (orgId ?? null) !== (user.tenantId ?? null)) throw new NotFoundException('Incident not found');
    await this.requireActive(orgId);
    return { inc, orgId: orgId! };
  }

  async putIncident(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    const { inc, orgId } = await this.loadIncident(user, id);
    requireRole(user, MAINTAINERS, 'record EU incident reporting');
    const cur: EuIncidentExt = { ...(inc.governanceExt?.euAct ?? {}) };
    if (body.classification !== undefined) {
      cur.classification = oneOf(body.classification, SERIOUS_INCIDENT_CLASSES.map((c) => c.key), 'classification') as any;
      cur.classifiedBy = user.email;
    }
    const dateField = (k: string, field: keyof EuIncidentExt) => {
      if (body[k] === undefined) return;
      const d = optDate(body[k], k);
      if (d && isFuture(d, body[k])) throw new BadRequestException(`${k} cannot be in the future`);
      (cur as any)[field] = d ? d.toISOString() : null;
    };
    dateField('aware_at', 'awareAt');
    dateField('reported_at', 'reportedAt');
    dateField('provider_informed_at', 'providerInformedAt');
    dateField('authority_informed_at', 'authorityInformedAt');
    dateField('suspended_at', 'suspendedAt');
    dateField('state_recorded_at', 'stateRecordedAt');
    for (const [k, f, max] of [['authority', 'authority', 300], ['reference', 'reference', 300], ['suspension_reason', 'suspensionReason', 2000], ['state_description', 'stateDescription', 8000], ['alteration_reason', 'alterationReason', 4000]] as const) {
      if (body[k] !== undefined) (cur as any)[f] = optText(body[k], k, max);
    }
    if (body.not_altered !== undefined) {
      if (typeof body.not_altered !== 'boolean') throw new BadRequestException('not_altered must be true or false');
      cur.notAltered = body.not_altered;
    }
    if (body.initial_report_only !== undefined) cur.initialReportOnly = body.initial_report_only === true;
    if (cur.stateRecordedAt && !cur.stateDescription) throw new BadRequestException('state_description is needed with state_recorded_at (Art. 73(6))');
    if (cur.reportedAt && !cur.authority) throw new BadRequestException('Name the authority the report went to');
    // The Art. 73 clock runs from awareness; the incident's own deadline takes the earlier of the two.
    const aware = cur.awareAt ? new Date(cur.awareAt) : inc.detectedAt;
    const deadline = cur.classification ? euDeadline(cur.classification, aware) : null;
    cur.deadlineAt = deadline?.toISOString() ?? null;
    if (deadline && (!inc.reportingDeadline || deadline.getTime() < inc.reportingDeadline.getTime())) inc.reportingDeadline = deadline;
    if (cur.reportedAt) inc.regulatorNotified = true;
    if (cur.suspendedAt) inc.systemSuspended = true;
    inc.governanceExt = { ...(inc.governanceExt ?? {}), euAct: cur };
    inc.updatedAt = new Date();
    await this.incidents.save(inc);
    const roles = (await this.workspace(inc.modelId)).profile?.data?.profile?.roles ?? [];
    if (req) req.auditSummary = { eu_incident_updated: { incident_id: id, classification: cur.classification ?? null } };
    return { incident_id: id, org_id: orgId, eu: cur, eu_status: euIncidentStatus(cur, inc, new Date(), roles) };
  }

  async incidentReport(user: CurrentUser, id: string) {
    const { inc } = await this.loadIncident(user, id);
    const ws = await this.workspace(inc.modelId);
    const model = await this.models.findOne({ where: { id: inc.modelId } });
    const reg = ws.records.find((r) => r.kind === 'REGISTRATION' && r.status === 'REGISTERED');
    return seriousIncidentReport({
      incident: inc, model: { id: inc.modelId, name: model?.name ?? inc.modelName }, profile: this.profileOf(ws),
      ext: inc.governanceExt?.euAct ?? {}, registration: reg ? { euDatabaseId: reg.data?.euDatabaseId ?? null } : null,
    });
  }

  /* --------------------------------------------------------- Art. 86 */

  private async openExplanation(orgId: string, modelId: string, decisionRef: string, requester: string | null, source: string) {
    const existing = await this.rows.find({ where: { modelId, kind: 'EXPLANATION', status: 'RECEIVED' } });
    const dup = existing.find((e) => e.data?.decisionRef === decisionRef);
    if (dup) return dup;
    const now = new Date();
    return this.rows.save(this.rows.create({
      id: uuidv4(), orgId, modelId, kind: 'EXPLANATION', status: 'RECEIVED', data: { decisionRef, requester, source },
      contentHash: null, signedBy: null, signedAt: null, dueAt: new Date(now.getTime() + EU_EXPLANATION_DAYS * DAY_MS), createdBy: source === 'public' ? 'public' : requester ?? 'staff', createdAt: now, updatedAt: now,
    }));
  }

  async requestExplanation(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    const { orgId } = await this.loadModel(user, modelId);
    requireRole(user, MAINTAINERS, 'record an explanation request');
    const ref = reqText(body.decision_ref, 'decision_ref', 1, 255);
    if (!(await this.explanations.findOne({ where: { decisionRef: ref, modelId } }))) throw new NotFoundException('No explainability record for this decision');
    const row = await this.openExplanation(orgId, modelId, ref, optText(body.requester, 'requester', 255), 'staff');
    if (req) req.auditSummary = { eu_explanation_requested: { model_id: modelId, decision_ref: ref } };
    return this.recordView(row);
  }

  /** Public path for an affected person (Art. 86): the request is recorded; the answer goes out through staff. */
  async publicExplanation(modelId: string, body: Record<string, any>) {
    this.assert();
    const orgId = await orgOfModel(this.models, this.projects, modelId);
    if (!orgId || !(await this.active(orgId))) throw new NotFoundException('Not found');
    const f = await this.modelFacts(modelId, orgId);
    if (f.tier !== 'High Risk' || !f.classification.annexIII.length) throw new NotFoundException('Not found');
    const ref = reqText(body.decision_ref, 'decision_ref', 1, 255);
    if (!(await this.explanations.findOne({ where: { decisionRef: ref, modelId } }))) throw new NotFoundException('Decision not found for this system; use the reference on your notice');
    const requester = optText(body.requester, 'requester', 255);
    const masked = requester ? (requester.includes('@') ? `${requester.slice(0, 2)}***@${requester.split('@')[1] ?? ''}` : `${requester.slice(0, 2)}***`) : null;
    const row = await this.openExplanation(orgId, modelId, ref, masked, 'public');
    return { status: 'RECEIVED', respond_by: row.dueAt };
  }

  async answerExplanation(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    const r = await this.loadRecord(user, id, 'EXPLANATION');
    requireRole(user, MAINTAINERS, 'answer an explanation request');
    if (r.status !== 'RECEIVED') throw new ConflictException('Already answered');
    const exp = await this.explanations.findOne({ where: { decisionRef: r.data.decisionRef, modelId: r.modelId! } });
    if (!exp) throw new NotFoundException('No explainability record for this decision');
    const model = await this.models.findOne({ where: { id: r.modelId! } });
    const generated = explanationText({
      modelName: model?.name ?? 'The AI system', decisionRef: exp.decisionRef, outcome: exp.decisionOutcome, method: exp.explanationMethod,
      topFeatures: exp.topFeatures ?? {}, summary: exp.humanReadableSummary, humanOversight: !!model?.humanOversightRequired,
    });
    const text = optText(body.text, 'text', 8000) ?? generated;
    r.data = { ...r.data, explanation: text, generated, channel: optText(body.channel, 'channel', 50) ?? 'EMAIL' };
    r.status = 'ANSWERED';
    r.signedBy = user.email;
    r.signedAt = new Date();
    r.updatedAt = new Date();
    await this.rows.save(r);
    if (req) req.auditSummary = { eu_explanation_answered: { record_id: id } };
    return this.recordView(r);
  }

  /** Open change assessments and explanation requests across the organisation (for the inbox and the tab). */
  async queue(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    await this.requireActive(orgId);
    const rows = await this.rows.find({ where: { orgId, kind: In(['CHANGE', 'EXPLANATION', 'NONCONFORMITY']), status: In(['OPEN', 'RECEIVED', 'ACTIONED']) }, order: { createdAt: 'DESC' }, take: 500 });
    return { org_id: orgId, items: rows.map((r) => this.recordView(r)) };
  }
}
