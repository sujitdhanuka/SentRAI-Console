import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';

/** Model card v2 (E4.2): dark behind GOV_E4_2_MODEL_CARD_V2; the v1 migration is a dry run unless told otherwise. */
describe('Model card v2 (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = app.getHttpServer();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (username: string, password: string): Promise<string> => {
    const res = await request(http).post('/api/v1/auth/token').type('form').send({ username, password });
    expect(res.status).toBe(200);
    return res.body.access_token;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  const setupOrg = async (name: string) => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
    const user = async (role: string) => {
      const email = `${role.toLowerCase()}@${name.toLowerCase()}.test`;
      await request(http).post('/api/v1/users').set(auth(admin))
        .send({ email, full_name: `${name} ${role}`, password: 'pw123456', role, organization_id: org.body.organization_id }).expect(201);
      return login(email, 'pw123456');
    };
    const owner = await user('OWNER');
    const reviewer = await user('REVIEWER');
    const project = await request(http).post('/api/v1/projects').set(auth(owner)).send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
    const modelId = (await request(http).post('/api/v1/inventory/models').set(auth(owner)).send({
      name: 'Global Ai Model Settings', model_type: 'GENERATIVE_AI', functional_area: 'unclassified', risk_level: 'LOW',
      use_case_description: 'Here is a concise summary of the component:\n\nIt sets the default AI model for every organisation. It likely handles sensitive information.\n\nNote: This summary is based on the provided code excerpt.',
      human_oversight_required: true, board_policy_ref: '', project_id: project.body.project_id, target_customer_segments: [],
      source_ref: 'acme/src/app/components/GlobalAiModelSettings.tsx',
    }).expect(201)).body.model_id as string;
    return { admin, owner, reviewer, orgId: org.body.organization_id as string, modelId };
  };
  const M = '/api/v1/governance/model-cards/v2/migrate-v1';

  it('is dark while the flags are off', async () => {
    const o = await setupOrg('McV2Off');
    await request(http).post(M).set(auth(o.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E4_2_MODEL_CARD_V2: 'false' }, async () => {
      await request(http).post(M).set(auth(o.owner)).expect(404);
    });
  });

  it('previews the v1 migration without writing, then migrates once, additively, inside the organisation', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('McV2A');
      const other = await setupOrg('McV2B');
      expect((await request(http).get('/api/v1/governance/features').set(auth(o.owner)).expect(200)).body.modelCardV2).toBe(true);
      const before = await db.query('SELECT * FROM ai_models WHERE id = ?', [o.modelId]);

      // Officers only.
      await request(http).post(M).set(auth(o.reviewer)).expect(403);

      // Dry run is the default and writes nothing.
      const dry = (await request(http).post(M).set(auth(o.owner)).expect(201)).body;
      expect(dry.dry_run).toBe(true);
      expect(dry.org_id).toBe(o.orgId);
      expect(dry.records.map((r: any) => r.model_id)).toEqual([o.modelId]);
      const r = dry.records[0];
      expect(r.record_type_proposed.value).toBe('MODEL_CONFIGURATION');
      expect(r.fields_scanned).toEqual(expect.arrayContaining(['record_type', 'model_category']));
      expect(r.fields_imported).toEqual(expect.arrayContaining(['purpose', 'inherent_risk_tier']));
      expect(r.consistency.map((c: any) => c.code)).toEqual(expect.arrayContaining(['STATE_NOT_DEPLOYED_ACTIVE']));
      expect(r.risk.status).toBe('REQUIRES_REASSESSMENT');
      expect(r.verdicts_reset.every((v: any) => v.v2_status === 'NOT_ASSESSED')).toBe(true);
      // The description was typed by a person, so it is imported as is, with no AI suggestion.
      expect(r.suggestions).toEqual([]);
      expect(r).toMatchObject({ already_migrated: false, written: false });
      expect(await db.query('SELECT * FROM card_records WHERE modelId = ?', [o.modelId])).toEqual([]);
      expect(await db.query('SELECT * FROM card_field_values WHERE modelId = ?', [o.modelId])).toEqual([]);

      // Real run.
      const run = (await request(http).post(`${M}?dry_run=false`).set(auth(o.owner)).expect(201)).body;
      expect(run.records[0]).toMatchObject({ written: true, already_migrated: false });
      const [rec] = await db.query('SELECT * FROM card_records WHERE modelId = ?', [o.modelId]);
      expect(rec).toMatchObject({ orgId: o.orgId, workflowState: 'DRAFT', catalogueVersion: '2.0.0' });
      expect(rec.migrationNote).toMatch(/NOT_ASSESSED/);
      const vals = await db.query('SELECT fieldId, status, provenance, acceptedBy FROM card_field_values WHERE modelId = ?', [o.modelId]);
      expect(vals.find((v: any) => v.fieldId === 'personal_data')).toMatchObject({ status: 'UNKNOWN' });
      expect(vals.find((v: any) => v.fieldId === 'record_type')).toMatchObject({ provenance: 'CODE_SCAN', acceptedBy: null });
      expect(vals.filter((v: any) => v.provenance === 'IMPORTED_V1').every((v: any) => v.acceptedBy === null)).toBe(true);
      const ledger = await db.query("SELECT * FROM model_ledger_events WHERE modelId = ? AND eventType = 'CARD_MIGRATED_FROM_V1'", [o.modelId]);
      expect(ledger).toHaveLength(1);
      // v1 framework verdicts are now NOT_ASSESSED control assessments that keep the old verdict.
      const ctl = await db.query('SELECT frameworkId, status, migratedFromV1Verdict FROM card_control_assessments WHERE modelId = ?', [o.modelId]);
      expect(ctl.filter((c: any) => c.frameworkId === 'iso-42001-2023')).toHaveLength(9);
      expect(ctl.every((c: any) => c.status === 'NOT_ASSESSED' && c.migratedFromV1Verdict)).toBe(true);

      // The migrated card is blocked from FINAL and shows ISO/IEC 42001 controls as NOT_ASSESSED.
      const card = (await request(http).get(`/api/v1/governance/models/${o.modelId}/card-v2`).set(auth(o.owner)).expect(200)).body;
      expect(card.gate.can_finalise).toBe(false);
      expect(card.gate.blockers.map((b: any) => b.code)).toEqual(expect.arrayContaining(['UNACCEPTED_SUGGESTION', 'STATE_NOT_DEPLOYED_ACTIVE']));
      const isoFw = card.frameworks.find((f: any) => f.framework_id === 'iso-42001-2023');
      expect(isoFw.heading).toMatch(/cannot show conformity/);
      expect(isoFw.controls.every((c: any) => c.status === 'NOT_ASSESSED')).toBe(true);

      // The v1 record is untouched; the v1 card still reads.
      expect(await db.query('SELECT * FROM ai_models WHERE id = ?', [o.modelId])).toEqual(before);
      await request(http).get(`/api/v1/governance/models/${o.modelId}/model-card`).set(auth(o.owner)).expect(200);

      // Running again changes nothing.
      const again = (await request(http).post(`${M}?dry_run=false`).set(auth(o.owner)).expect(201)).body;
      expect(again.records[0]).toMatchObject({ already_migrated: true, written: false });
      expect(await db.query('SELECT * FROM card_records WHERE modelId = ?', [o.modelId])).toHaveLength(1);

      // The other organisation sees only its own records, and an org owner cannot name another org.
      const theirs = (await request(http).post(M).set(auth(other.owner)).expect(201)).body;
      expect(theirs.records.map((x: any) => x.model_id)).toEqual([other.modelId]);
      const named = (await request(http).post(`${M}?org_id=${o.orgId}`).set(auth(other.owner)).expect(201)).body;
      expect(named.org_id).toBe(other.orgId);
    });
  });

  it('serves the framework registry, seeded unverified, and revises it only through new revisions by an administrator', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('McV2Reg');
      const R = '/api/v1/governance/framework-registry';
      const list = (await request(http).get(R).set(auth(o.reviewer)).expect(200)).body;
      expect(list.frameworks.length).toBeGreaterThanOrEqual(20);
      expect(list.frameworks.every((f: any) => f.verification_status === 'UNVERIFIED_REQUIRES_LEGAL_REVIEW')).toBe(true);
      const eu = list.frameworks.find((f: any) => f.framework_id === 'eu-ai-act-2024');
      expect(eu).toMatchObject({ type: 'REGULATION', revision: 1 });
      await request(http).get(`${R}/no-such-framework`).set(auth(o.owner)).expect(404);

      // Shared by every organisation: an org owner cannot change it; an administrator must give a reason.
      const body = { changes: { effective_note: 'Confirmed by test.' }, reason: 'Test revision of the registry entry' };
      await request(http).post(`${R}/kr-ai-basic-act/revisions`).set(auth(o.owner)).send(body).expect(403);
      await request(http).post(`${R}/kr-ai-basic-act/revisions`).set(auth(o.admin)).send({ changes: body.changes, reason: 'short' }).expect(400);
      await request(http).post(`${R}/kr-ai-basic-act/revisions`).set(auth(o.admin)).send({ changes: { framework_id: 'x' }, reason: body.reason }).expect(400);
      await request(http).post(`${R}/kr-ai-basic-act/revisions`).set(auth(o.admin)).send({ changes: { applicability_rule_id: 'R_NOPE' }, reason: body.reason }).expect(400);
      const rev = (await request(http).post(`${R}/kr-ai-basic-act/revisions`).set(auth(o.admin)).send(body).expect(201)).body;
      expect(rev.framework).toMatchObject({ revision: 2, effective_note: 'Confirmed by test.', verification_status: 'UNVERIFIED_REQUIRES_LEGAL_REVIEW' });
      expect(rev.history.map((h: any) => h.revision)).toEqual([1, 2]);

      // Revision 1 stays readable for assessments pinned to it.
      const pinned = (await request(http).get(`${R}/kr-ai-basic-act?revision=1`).set(auth(o.owner)).expect(200)).body;
      expect(pinned.framework).toMatchObject({ revision: 1, effective_note: null });
      expect((await request(http).get(R).set(auth(o.owner)).expect(200)).body.frameworks.find((f: any) => f.framework_id === 'kr-ai-basic-act').revision).toBe(2);
    });
  });

  it('edits a card, walks it through separated approvals to an approved version, and reopens it on a triggering change', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('McV2Flow');
      const other = await setupOrg('McV2FlowB');
      const mk = async (role: string) => {
        const email = `${role.toLowerCase()}2@mcv2flow.test`;
        const res = await request(http).post('/api/v1/users').set(auth(o.admin))
          .send({ email, full_name: `Flow ${role}`, password: 'pw123456', role, organization_id: o.orgId }).expect(201);
        return { token: await login(email, 'pw123456'), id: res.body.user_id as string, email };
      };
      const ciso = await mk('CISO');
      const approver = await mk('APPROVER');
      const viewer = await mk('VIEWER');
      const ownerUser = await mk('OWNER');
      const C = `/api/v1/governance/models/${o.modelId}/card-v2`;
      const set = (t: string, field: string, body: Record<string, any>, status = 200) => request(http).patch(`${C}/fields/${field}`).set(auth(t)).send(body).expect(status);

      // A fresh card: nothing stored, blocked from FINAL, four scores with denominators.
      const fresh = (await request(http).get(C).set(auth(viewer.token)).expect(200)).body;
      expect(fresh.record.exists).toBe(false);
      expect(fresh.gate.can_finalise).toBe(false);
      expect(fresh.scores.map((x: any) => x.id)).toEqual(['documentation', 'evidence', 'control_effectiveness', 'regulatory']);
      expect(fresh.scores.every((x: any) => typeof x.denominator === 'number' && x.how)).toBe(true);
      expect(fresh.disclaimer).toMatch(/not evidence of compliance or certification/);
      expect(JSON.stringify(fresh)).not.toMatch(/"compliant"|certified/i);

      // Viewers read; they cannot edit. Another organisation cannot see the card.
      await set(viewer.token, 'purpose', { value: 'x' }, 403);
      await request(http).get(C).set(auth(other.owner)).expect(404);

      // The owner writes first, so the owner is the author.
      const key: Record<string, any> = {
        record_type: 'AI_SYSTEM', model_category: 'TRADITIONAL_ML', purpose: 'Ranks support tickets for one internal team.',
        model_lifecycle: 'DESIGN', deployment_status: 'NOT_DEPLOYED', operational_status: 'INACTIVE', accountable_owner: ownerUser.id,
        impact_severity: 'MINOR', likelihood: 'UNLIKELY', tenant_reach: 'ONE_TENANT', users_reached: 20, autonomy_level: 'SUGGESTS',
        data_sensitivity: 'LOW', decision_impact: 'INFORMATIONAL', reversibility: 'EASILY_REVERSED', personal_data: 'NO',
        third_party_provider_used: 'NO', jurisdictions: ['IN'], inherent_risk_tier: 'LOW', residual_risk_tier: 'LOW',
        risk_rationale: 'Internal ranking aid for one team; suggestions only, easily ignored, no personal data.',
      };
      for (const [f, v] of Object.entries(key)) await set(o.owner, f, { value: v });
      // A service account cannot own the record.
      await db.query("UPDATE users SET accountType = 'SERVICE' WHERE id = ?", [ciso.id]);
      expect((await set(o.owner, 'accountable_owner', { value: ciso.id }, 400)).body.code).toBe('OWNER_SERVICE_ACCOUNT');
      await db.query("UPDATE users SET accountType = 'HUMAN' WHERE id = ?", [ciso.id]);
      // N/A needs a justification.
      await set(o.owner, 'intended_use', { action: 'NOT_APPLICABLE', justification: 'no' }, 400);

      // Fill every remaining required field, recording a justified N/A for the ones this test does not exercise.
      for (let i = 0; i < 6; i++) {
        const card = (await request(http).get(C).set(auth(o.owner)).expect(200)).body;
        const missing = card.gate.blockers.filter((b: any) => b.field_id && !(b.field_id in key)).map((b: any) => b.field_id);
        if (!missing.length) break;
        for (const f of missing) await set(o.owner, f, { action: 'NOT_APPLICABLE', justification: 'Not exercised by this end-to-end test.' });
      }
      const ready = (await request(http).get(C).set(auth(o.owner)).expect(200)).body;
      expect(ready.risk.status).toBe('ASSESSED');
      expect(ready.gate.blockers).toEqual([]);
      expect(ready.record.author).toBe('owner@mcv2flow.test');

      // Control status moves only with evidence, and the implementer cannot verify.
      const P = `${C}/controls/nist-ai-rmf-1.0/MAP-1`;
      await request(http).put(P).set(auth(o.owner)).send({ status: 'IMPLEMENTED' }).expect(400);
      await request(http).put(P).set(auth(o.owner)).send({ status: 'IMPLEMENTED', evidence_refs: [{ ref: 'doc://context', type: 'DOCUMENT' }] }).expect(200);
      expect((await request(http).put(P).set(auth(o.owner)).send({ status: 'EVIDENCE_VERIFIED' }).expect(400)).body.code).toBe('SAME_PERSON');
      await request(http).put(P).set(auth(ciso.token)).send({ status: 'EVIDENCE_VERIFIED' }).expect(200);

      // Workflow with separation of duties.
      const W = `${C}/workflow`;
      const act = (t: string, action: string, extra: Record<string, any> = {}, status = 201) => request(http).post(W).set(auth(t)).send({ action, ...extra }).expect(status);
      await act(o.owner, 'START_ASSESSMENT');
      await act(o.owner, 'COLLECT_EVIDENCE');
      await act(o.owner, 'SUBMIT_FOR_REVIEW');
      expect((await act(o.owner, 'APPROVE', {}, 400)).body.message).toMatch(/author/);
      await act(approver.token, 'APPROVE_WITH_CONDITIONS', { conditions: [{ text: 'Add monitoring before deployment', owner: ownerUser.email, due: '2027-01-31' }] });
      expect((await act(approver.token, 'APPROVE', {}, 400)).body.message).toMatch(/Risk approval needs one of these roles/);
      await act(ciso.token, 'APPROVE');
      const approved = (await act(ciso.token, 'APPROVE')).body;
      expect(approved.record).toMatchObject({ workflow_state: 'ACTIVE_MONITORING', last_approved_version: 1, review_status: 'SCHEDULED' });
      expect(approved.approvals.map((a: any) => [a.step, a.decision])).toEqual([['GOVERNANCE', 'APPROVED_WITH_CONDITIONS'], ['RISK', 'APPROVED'], ['FINAL', 'APPROVED']]);

      // A triggering change reopens it; the approved version stays readable.
      const changed = (await set(o.owner, 'intended_use', { value: 'Ranks tickets and now drafts replies.' })).body;
      expect(changed.reassessment).toMatchObject({ from: 'ACTIVE_MONITORING', to: 'REASSESSMENT' });
      expect(changed.card.approvals.every((a: any) => a.superseded)).toBe(true);
      const versions = (await request(http).get(`${C}/versions`).set(auth(viewer.token)).expect(200)).body;
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, kind: 'APPROVED', workflow_state: 'ACTIVE_MONITORING' });
      const v1 = (await request(http).get(`${C}/versions/1`).set(auth(viewer.token)).expect(200)).body;
      expect(v1.content.record.workflow_state).toBe('ACTIVE_MONITORING');
      const history = (await request(http).get(`${C}/history`).set(auth(o.owner)).expect(200)).body.map((h: any) => h.event);
      expect(history).toEqual(expect.arrayContaining(['CARD_FIELD_CHANGED', 'CARD_CONTROL_CHANGED', 'CARD_WORKFLOW', 'CARD_VERSION_FROZEN', 'CARD_REASSESSMENT_TRIGGERED']));
      const changeEvent = (await request(http).get(`${C}/history`).set(auth(o.owner)).expect(200)).body.find((h: any) => h.event === 'CARD_FIELD_CHANGED' && h.data.field_id === 'intended_use' && h.data.action === 'SET');
      expect(changeEvent.data.before).toBeDefined();
      expect(changeEvent.data.after.value).toBe('Ranks tickets and now drafts replies.');
    });
  });
});

