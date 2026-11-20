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
});

