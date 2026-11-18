import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { Role } from '../src/common/enums';
import { ComplianceService } from '../src/compliance/compliance.service';
import { NotifierService } from '../src/common/notifier.service';
import { ScheduledTasksService } from '../src/tasks/scheduled-tasks.service';
import { RisksService } from '../src/governance/risks/risks.service';

describe('SentrAI Console (e2e)', () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (username: string, password: string): Promise<string> => {
    const res = await request(http).post('/api/v1/auth/token').type('form').send({ username, password });
    expect(res.status).toBe(200);
    return res.body.access_token;
  };

  it('health is public', async () => {
    const res = await request(http).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects protected routes without a token', async () => {
    await request(http).get('/api/v1/projects').expect(401);
  });

  it('exposes the 7 sutras publicly', async () => {
    const res = await request(http).get('/api/v1/sutras');
    expect(res.status).toBe(200);
    expect(res.body.sutras).toHaveLength(7);
  });

  it('runs the full governance happy path', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Org + tenant user
    const org = await request(http)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Acme Bank', description: 'test' });
    expect(org.status).toBe(201);
    const orgId = org.body.organization_id;

    const addUser = await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'ops@acme.test', full_name: 'Ops', password: 'pw123456', role: 'ADMIN', organization_id: orgId });
    expect(addUser.status).toBe(201);

    const token = await login('ops@acme.test', 'pw123456');

    // Project (root_directory must exist on the server)
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Trading App', root_directory: process.cwd() });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project_id;

    // Register a model — GenAI + credit + no oversight → triaged HIGH
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Credit Scorer',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM scores SME credit applications end to end',
        human_oversight_required: false,
        board_policy_ref: '',
        project_id: projectId,
      });
    expect(model.status).toBe(201);
    expect(model.body.triaged_risk_level).toBe('HIGH');
    expect(model.body.compliance_pass).toBe(false);
    const modelId = model.body.model_id;

    // Compliance check
    const cc = await request(http).get(`/api/v1/inventory/models/${modelId}/compliance-check`).set('Authorization', `Bearer ${token}`);
    expect(cc.status).toBe(200);
    expect(cc.body.eu_ai_act.risk_tier).toBe('High Risk');
    expect(cc.body.nist_rmf.framework_name).toBe('NIST AI RMF');

    // Incident (P1 → 6h deadline)
    const inc = await request(http)
      .post('/api/v1/compliance/incident/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model_id: modelId,
        model_name: 'Credit Scorer',
        re_name: 'Acme Bank',
        functional_area: 'credit_underwriting',
        incident_category: 'BIAS_DISCRIMINATION',
        severity: 'P1_CRITICAL',
        description: 'Model produced biased credit denials for a protected demographic segment repeatedly',
        observed_at: '2026-07-11T06:00:00Z',
        detected_at: '2026-07-11T06:30:00Z',
        model_risk_level: 'HIGH',
        immediate_action_taken: 'Suspended model and engaged rules fallback',
      });
    expect(inc.status).toBe(201);
    expect(inc.body.severity).toBe('P1_CRITICAL');

    // Drift → circuit breaker
    const drift = await request(http)
      .post('/api/v1/monitoring/drift/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model_id: modelId,
        training_scores: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        live_scores: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4],
        baseline_accuracy: 0.9,
        current_accuracy: 0.7,
      });
    expect(drift.status).toBe(201);
    expect(drift.body.circuit_breaker_active).toBe(true);
    expect(drift.body.status).toBe('CIRCUIT_BREAKER_TRIPPED');

    // Audit initiate
    const audit = await request(http)
      .post(`/api/v1/audit/models/${modelId}/initiate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ auditor_ref: 'Internal', audit_type: 'INTERNAL', training_data_bias_checked: true, trust_verified: true, human_oversight_verified: true, fairness_metrics_passed: true, accountability_chain_documented: true, explainability_verified: true, bcp_verified: true });
    expect(audit.status).toBe(201);
    expect(audit.body.overall_verdict).toBe('COMPLIANT');

    // Metrics
    const metrics = await request(http).get('/metrics').set('Authorization', `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('sentrai_models_total 1');
    expect(metrics.text).toContain('sentrai_drift_alerts_total 1');

    // PDF export is public and returns a PDF
    const pdf = await request(http).get(`/api/v1/inventory/models/${modelId}/export-pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('enforces RBAC — non-admin cannot list users', async () => {
    // Register a plain VIEWER via the public register endpoint
    await request(http).post('/api/v1/auth/register').send({ email: 'viewer@x.test', full_name: 'V', password: 'pw123456', role: 'VIEWER' });
    const token = await login('viewer@x.test', 'pw123456');
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('SECURITY: the VIEWER tier is read-only across the API', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // A plain viewer — the role every public self-registration collapses to.
    await request(http).post('/api/v1/auth/register')
      .send({ email: 'readonly@x.test', full_name: 'RO', password: 'pw12345678', role: 'VIEWER' })
      .expect(201);
    const viewer = await login('readonly@x.test', 'pw12345678');

    // Admin seeds a project for the viewer to look at.
    const project = await request(http).post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'RO Demo', description: 'read-only target' })
      .expect(201);
    const projectId = project.body.project_id;

    // Reads succeed …
    await request(http).get('/api/v1/projects').set('Authorization', `Bearer ${viewer}`).expect(200);
    await request(http).get(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${viewer}`).expect(200);

    // … but every mutation is refused, even on controllers that carry no @Roles
    // guard (projects/inventory/compliance only require authentication).
    await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${viewer}`)
      .send({ name: 'nope', description: 'x' }).expect(403);
    await request(http).patch(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${viewer}`)
      .send({ description: 'edited by viewer' }).expect(403);
    await request(http).delete(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${viewer}`).expect(403);

    // The seeded project is untouched.
    const after = await request(http).get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(after.body.description).toBe('read-only target');

    // The demo-provisioning endpoint is ADMIN-only (guard rejects before it runs).
    await request(http).post('/api/v1/admin/seed-demo').expect(401);
    await request(http).post('/api/v1/admin/seed-demo').set('Authorization', `Bearer ${viewer}`).expect(403);
  });

  it('SECURITY: public registration cannot self-assign a privileged role', async () => {
    // Attacker attempts to register directly as ADMIN.
    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'attacker@x.test', full_name: 'Mallory', password: 'pw12345678', role: 'ADMIN' });
    expect(reg.status).toBe(201);
    expect(reg.body.role).toBe('VIEWER'); // role coerced, never ADMIN

    // And the resulting account has no admin powers.
    const token = await login('attacker@x.test', 'pw12345678');
    const me = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.role).toBe('VIEWER');
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('USERS: admin can change role, deactivate, and delete — with lockout guards', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Create a user.
    const created = await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'crud@x.test', full_name: 'Crud User', password: 'pw12345678', role: 'VIEWER' });
    expect(created.status).toBe(201);
    const uid = created.body.user_id;
    expect(created.body.role).toBe('VIEWER');

    // Change role.
    const promoted = await request(http)
      .patch(`/api/v1/users/${uid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'APPROVER' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('APPROVER');

    // Deactivate.
    const deactivated = await request(http)
      .patch(`/api/v1/users/${uid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ is_active: false });
    expect(deactivated.body.is_active).toBe(false);

    // A deactivated user cannot log in.
    const blocked = await request(http).post('/api/v1/auth/token').type('form').send({ username: 'crud@x.test', password: 'pw12345678' });
    expect(blocked.status).toBe(403);

    // Guard: admin cannot demote or delete the last active admin (self).
    const meList = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    const adminRow = meList.body.find((u: any) => u.email === 'admin@sentrai.local');
    await request(http).patch(`/api/v1/users/${adminRow.user_id}`).set('Authorization', `Bearer ${admin}`).send({ role: 'VIEWER' }).expect(403);
    await request(http).delete(`/api/v1/users/${adminRow.user_id}`).set('Authorization', `Bearer ${admin}`).expect(403);

    // Delete the created user.
    await request(http).delete(`/api/v1/users/${uid}`).set('Authorization', `Bearer ${admin}`).expect(204);
    const after = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    expect(after.body.find((u: any) => u.email === 'crud@x.test')).toBeUndefined();
  });

  it('USERS: global admin assigns and moves users between organizations; org owners cannot', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const mkOrg = async (name: string) =>
      (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
    const orgA = await mkOrg('Move Org A');
    const orgB = await mkOrg('Move Org B');

    // The org picker lists every organization for a global admin.
    const assignable = await request(http).get('/api/v1/users/organizations').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(assignable.body.map((o: any) => o.organization_id)).toEqual(expect.arrayContaining([orgA, orgB]));

    // Unknown organization is rejected on create.
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'ghost@move.test', full_name: 'G', password: 'pw12345678', role: 'VIEWER', organization_id: 'nope' }).expect(400);

    const created = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'mover@move.test', full_name: 'Mover', password: 'pw12345678', role: 'VIEWER', organization_id: orgA }).expect(201);
    expect(created.body.organization_id).toBe(orgA);
    expect(created.body.organization_name).toBe('Move Org A');
    const uid = created.body.user_id;

    // Edit name, role and organization in one call.
    const moved = await request(http).patch(`/api/v1/users/${uid}`).set('Authorization', `Bearer ${admin}`)
      .send({ full_name: 'Mover Renamed', role: 'CISO', organization_id: orgB }).expect(200);
    expect(moved.body).toMatchObject({ full_name: 'Mover Renamed', role: 'CISO', organization_id: orgB, organization_name: 'Move Org B' });

    // null makes the user global again.
    const cleared = await request(http).patch(`/api/v1/users/${uid}`).set('Authorization', `Bearer ${admin}`)
      .send({ organization_id: null }).expect(200);
    expect(cleared.body.organization_id).toBeNull();

    // An org-scoped OWNER sees only their own org and cannot move users out of it.
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@move.test', full_name: 'Owner', password: 'pw12345678', role: 'OWNER', organization_id: orgA }).expect(201);
    const owner = await login('owner@move.test', 'pw12345678');
    const ownOrgs = await request(http).get('/api/v1/users/organizations').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(ownOrgs.body.map((o: any) => o.organization_id)).toEqual([orgA]);
    // Naming another org on create is ignored: the user lands in the owner's org.
    const okMember = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${owner}`)
      .send({ email: 'member@move.test', full_name: 'Member', password: 'pw12345678', role: 'VIEWER', organization_id: orgB }).expect(201);
    expect(okMember.body.organization_id).toBe(orgA);
    await request(http).patch(`/api/v1/users/${okMember.body.user_id}`).set('Authorization', `Bearer ${owner}`)
      .send({ organization_id: orgB }).expect(403);
    await request(http).patch(`/api/v1/users/${okMember.body.user_id}`).set('Authorization', `Bearer ${owner}`)
      .send({ full_name: 'Member Renamed' }).expect(200);

    // The last active OWNER cannot be moved out of their organization.
    const ownerRow = (await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`)).body
      .find((u: any) => u.email === 'owner@move.test');
    await request(http).patch(`/api/v1/users/${ownerRow.user_id}`).set('Authorization', `Bearer ${admin}`)
      .send({ organization_id: orgB }).expect(403);
  });

  it('SECURITY: rejects weak registration passwords', async () => {
    await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@x.test', full_name: 'W', password: 'short' })
      .expect(400);
  });

  it('gates lifecycle promotion on governance completeness AND board approval', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Ungoverned Draft',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'fraud_detection', // triages MEDIUM → needs board sign-off
        use_case_description: 'Detects anomalous transactions in the payments stream',
        human_oversight_required: false,
      });
    expect(model.status).toBe(201);
    const modelId = model.body.model_id;

    // No owner / policy — promotion to DEPLOYED must 422 with the missing fields.
    const blocked = await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.missing_fields.join(' ')).toContain('owner_team');

    // Complete governance — but a MEDIUM model still cannot go live without an
    // approved review-board sign-off (Pillar 1 — Alignment).
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ owner_team: 'Fraud Ops', board_policy_ref: 'POLICY-9', human_oversight_required: true, actor: 'e2e' })
      .expect(200);
    const noApproval = await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' });
    expect(noApproval.status).toBe(422);
    expect(noApproval.body.missing_fields.join(' ')).toContain('board_approval');

    // An independent approver is needed. Create a CISO in a fresh org.
    const gateOrg = await request(http)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Gate Org', description: 'approver org' });
    expect(gateOrg.status).toBe(201);
    await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'gate-ciso@x.test', full_name: 'Gate CISO', password: 'pw123456', role: 'CISO', organization_id: gateOrg.body.organization_id })
      .expect(201);
    const ciso = await login('gate-ciso@x.test', 'pw123456');

    // Request sign-off (as admin), then admin cannot approve their own request.
    const req = await request(http)
      .post('/api/v1/alignment/approvals')
      .set('Authorization', `Bearer ${admin}`)
      .send({ model_id: modelId, target_stage: 'DEPLOYED', note: 'validated, ready for prod' });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('PENDING');
    const approvalId = req.body.approval_id;

    await request(http)
      .post(`/api/v1/alignment/approvals/${approvalId}/decide`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'APPROVE' })
      .expect(403); // separation of duties: requester ≠ approver

    const decided = await request(http)
      .post(`/api/v1/alignment/approvals/${approvalId}/decide`)
      .set('Authorization', `Bearer ${ciso}`)
      .send({ decision: 'APPROVE', note: 'board approved' });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('APPROVED');

    // With governance complete AND an approved sign-off, promotion succeeds.
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' })
      .expect(200);

    // The approval and its decision are on the model ledger (append-only).
    const ledger = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/ledger`)
      .set('Authorization', `Bearer ${admin}`);
    const types = ledger.body.map((e: any) => e.event_type);
    expect(types).toContain('APPROVAL_REQUESTED');
    expect(types).toContain('APPROVAL_GRANTED');
  });

  it('runs an attestation campaign and ingests behavioral-eval evidence', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Attestation Target',
        model_type: 'NLP',
        functional_area: 'internal_tooling',
        use_case_description: 'Summarizes internal ops documents for the platform team',
      });
    expect(model.status).toBe(201);
    const modelId = model.body.model_id;

    // Open a campaign — it snapshots the active inventory into per-model items.
    const camp = await request(http)
      .post('/api/v1/alignment/attestations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ title: 'e2e re-certification', cadence_days: 30 });
    expect(camp.status).toBe(201);
    expect(camp.body.total_items).toBeGreaterThanOrEqual(1);
    const campaignId = camp.body.campaign_id;

    const detail = await request(http)
      .get(`/api/v1/alignment/attestations/${campaignId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(detail.status).toBe(200);
    const item = detail.body.items.find((i: any) => i.model_id === modelId) ?? detail.body.items[0];
    const attested = await request(http)
      .post(`/api/v1/alignment/attestations/items/${item.item_id}/attest`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'ATTEST', note: 'still within scope' });
    expect(attested.status).toBe(200);
    expect(attested.body.status).toBe('ATTESTED');

    // Ingest behavioral-eval-harness output as typed evidence with a pass-rate.
    const evd = await request(http)
      .post(`/api/v1/inventory/models/${modelId}/eval-evidence`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ suite: 'promptfoo', passed: 47, total: 50 });
    expect(evd.status).toBe(201);
    expect(evd.body.pass_rate).toBe(94);
    expect(evd.body.passed_all).toBe(false);

    const evidence = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evidence.body.evidence.some((a: any) => a.type === 'behavioral_eval')).toBe(true);
  });

  it('keeps the full ledger after a permanent purge, and restricts purging to admins', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Purge Candidate',
        model_type: 'NLP',
        functional_area: 'internal_tooling',
        use_case_description: 'Internal document summarizer for the ops team',
      });
    const modelId = model.body.model_id;

    // A non-admin cannot purge.
    const viewer = await login('viewer@x.test', 'pw123456');
    await request(http)
      .delete(`/api/v1/inventory/models/${modelId}?permanent=true`)
      .set('Authorization', `Bearer ${viewer}`)
      .expect(403);

    // Admin purge removes the model row but the ledger survives with a tombstone.
    await request(http)
      .delete(`/api/v1/inventory/models/${modelId}?permanent=true&actor=e2e-admin`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(204);

    const ledger = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/ledger`)
      .set('Authorization', `Bearer ${admin}`);
    expect(ledger.status).toBe(200);
    const types = ledger.body.map((e: any) => e.event_type);
    expect(types).toContain('MODEL_REGISTERED');
    expect(types).toContain('MODEL_PURGED');
  });

  it('evaluates ingested score windows via the monitoring loop', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Windowed Model',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'fraud_detection',
        use_case_description: 'Scores transactions for fraud with streaming inference',
      });
    const modelId = model.body.model_id;

    await request(http)
      .post(`/api/v1/monitoring/scores/${modelId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'reference', scores: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], accuracy: 0.9 })
      .expect(201);
    await request(http)
      .post(`/api/v1/monitoring/scores/${modelId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'live', scores: [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5], accuracy: 0.7 })
      .expect(201);

    // Run the same evaluation the hourly cron performs.
    const { MonitoringService } = await import('../src/monitoring/monitoring.service');
    const monitoring = app.get(MonitoringService);
    const result = await monitoring.evaluatePendingWindows();
    expect(result.evaluated).toBe(1);
    expect(result.tripped).toBe(1);

    const history = await request(http)
      .get(`/api/v1/monitoring/drift/${modelId}/history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThan(0);
    expect(history.body[0].circuit_breaker_active).toBe(true);

    // Windows are marked evaluated — a second pass is a no-op.
    const again = await monitoring.evaluatePendingWindows();
    expect(again.evaluated).toBe(0);
  });

  it('records masked audit events for every mutating action, including logins', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const events = await request(http)
      .get('/api/v1/audit/events?limit=200')
      .set('Authorization', `Bearer ${admin}`);
    expect(events.status).toBe(200);
    expect(events.body.length).toBeGreaterThan(0);

    const loginEvent = events.body.find((e: any) => e.path.includes('/auth/token'));
    expect(loginEvent).toBeDefined();
    // Credentials never appear in the audit sink un-masked.
    const raw = JSON.stringify(loginEvent.payload_summary ?? {});
    expect(raw).not.toContain('admin123');

    const registerEvent = events.body.find((e: any) => e.path.includes('/inventory/models') && e.method === 'POST');
    expect(registerEvent).toBeDefined();
  });

  it('attaches evidence artifacts and reflects them in compliance checks', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Evidence Model',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'credit_underwriting',
        use_case_description: 'Credit scoring model with documented bias testing evidence',
        owner_team: 'Risk',
        board_policy_ref: 'POLICY-2',
        human_oversight_required: true,
      });
    const modelId = model.body.model_id;

    await request(http)
      .post(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'bias_test', ref: 'https://reports.example/bias-2026-q2.pdf', description: 'Quarterly bias audit' })
      .expect(201);

    const cc = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/compliance-check`)
      .set('Authorization', `Bearer ${admin}`);
    expect(cc.status).toBe(200);
    const art10 = cc.body.eu_ai_act.checks.find((c: any) => c.control_code === 'Art-10');
    expect(art10.passed).toBe(true);

    const evidence = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evidence.body.evidence).toHaveLength(1);
  });

  it('accepts a codebase ZIP upload and scans it from the project workspace', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Project with no server path — it will scan its upload workspace.
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Uploaded App', description: 'zip onboarding' });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project_id;
    expect(proj.body.root_directory).toContain(projectId);

    // Build a small in-memory zip containing an AI-looking source file plus
    // junk (node_modules) that the extractor must skip.
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('app/model.py', Buffer.from(
      'import openai\n\ndef score(candidate):\n    """LLM credit scoring."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
    ));
    zip.addFile('app/README.md', Buffer.from('docs'));
    zip.addFile('node_modules/junk/index.js', Buffer.from('ignored'));

    const upload = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'codebase.zip');
    expect(upload.status).toBe(201);
    expect(upload.body.files_extracted).toBe(2);
    expect(upload.body.entries_skipped).toBe(1);
    // Scan-on-upload ran and persisted a result to the project.
    expect(upload.body.models_discovered).toBeGreaterThanOrEqual(1);
    const listed = await request(http).get('/api/v1/projects').set('Authorization', `Bearer ${admin}`);
    const projRow = listed.body.find((p: any) => p.project_id === projectId);
    expect(projRow.has_scan_result).toBe(true);
    expect(projRow.models_discovered).toBeGreaterThanOrEqual(1);

    // The workspace is now scannable: rescan finds the project directory valid.
    const rescan = await request(http)
      .post('/api/v1/inventory/models/rescan')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId });
    expect(rescan.status).toBe(200);

    // Rejects non-zip payloads.
    const bad = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', Buffer.from('not a zip'), 'notes.txt');
    expect(bad.status).toBe(400);
  });

  it('accepts a folder upload (multiple files with relative paths)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Folder App', description: 'folder onboarding' });
    const projectId = proj.body.project_id;

    // Files carry only basenames over multipart; the true relative paths ride
    // in a parallel `paths` field, matched by index (as the browser sends them).
    const upload = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase/folder`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('files', Buffer.from('import openai\n'), 'model.py')
      .attach('files', Buffer.from('# docs\n'), 'README.md')
      .attach('files', Buffer.from('junk'), 'index.js')
      .field('paths', 'myapp/model.py')
      .field('paths', 'myapp/README.md')
      .field('paths', 'myapp/node_modules/dep/index.js');
    expect(upload.status).toBe(201);
    expect(upload.body.source).toBe('folder');
    expect(upload.body.files_extracted).toBe(2); // node_modules skipped
    expect(upload.body.entries_skipped).toBe(1);
  });

  it('reports a clear error when a GitHub repo cannot be fetched', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'GitHub App', description: 'gh onboarding' });
    const projectId = proj.body.project_id;

    // A repo that does not exist should surface a 400, not crash.
    const res = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase/github`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ owner: 'sentrai-nonexistent-org', repo: 'does-not-exist-xyz', branch: 'main' });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('GitHub');
  });

  it('COMPLIANCE: portfolio rollup aggregates frameworks + plain-language gaps', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Rollup Credit Model',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM credit underwriting assistant for retail lending decisions.',
      })
      .expect(201);

    const res = await request(http)
      .get('/api/v1/compliance/portfolio')
      .set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.total_models).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.summary.headline).toBe('string');
    // All four frameworks are present with readiness sentences.
    const ids = res.body.frameworks.map((f: any) => f.id).sort();
    expect(ids).toEqual(['eu_ai_act', 'iso_42001', 'nist_ai_rmf', 'rbi_free_ai']);
    for (const f of res.body.frameworks) expect(typeof f.readiness).toBe('string');
    // A HIGH-risk credit model with no governance yields plain-language gaps.
    expect(res.body.top_gaps.length).toBeGreaterThan(0);
    expect(res.body.top_gaps[0].statement).toMatch(/model/i);

    // Readiness PDF renders.
    const pdf = await request(http)
      .get('/api/v1/compliance/portfolio/export-pdf')
      .set('Authorization', `Bearer ${admin}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);
  });

  it('reports plan usage with soft limits', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const org = await request(http)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Plan Test Org', description: 'usage test' });
    const orgId = org.body.organization_id;
    expect(org.body.plan).toBe('COMMUNITY');

    const usage = await request(http)
      .get(`/api/v1/inventory/organizations/${orgId}/usage`)
      .set('Authorization', `Bearer ${admin}`);
    expect(usage.status).toBe(200);
    expect(usage.body.plan).toBe('COMMUNITY');
    expect(usage.body.model_limit).toBe(10);
    expect(usage.body.over_limit).toBe(false);

    // Upgrade the plan; the limit expands.
    await request(http)
      .patch(`/api/v1/organizations/${orgId}/plan`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ plan: 'GROWTH' })
      .expect(200);
    const upgraded = await request(http)
      .get(`/api/v1/inventory/organizations/${orgId}/usage`)
      .set('Authorization', `Bearer ${admin}`);
    expect(upgraded.body.model_limit).toBe(100);
  });

  it('TENANT ISOLATION: a user cannot scan or see another organization\'s project', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    // Two orgs, one OWNER each.
    const mkOrg = async (name: string) => (await request(http)
      .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
      .send({ name })).body.organization_id;
    const orgA = await mkOrg('Org Alpha');
    const orgB = await mkOrg('Org Beta');
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@alpha.test', full_name: 'A', password: 'pw123456', role: 'OWNER', organization_id: orgA }).expect(201);
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@beta.test', full_name: 'B', password: 'pw123456', role: 'OWNER', organization_id: orgB }).expect(201);
    const tokenA = await login('owner@alpha.test', 'pw123456');
    const tokenB = await login('owner@beta.test', 'pw123456');

    const uploadProject = async (token: string, name: string, file: string) => {
      const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ name });
      const zip = new AdmZip();
      zip.addFile(file, Buffer.from('import openai\n\ndef run(x):\n    """LLM scoring."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n'));
      await request(http).post(`/api/v1/projects/${p.body.project_id}/codebase`).set('Authorization', `Bearer ${token}`)
        .attach('file', zip.toBuffer(), 'c.zip').expect(201);
      return p.body; // { project_id, root_directory, ... }
    };
    const projA = await uploadProject(tokenA, 'Alpha App', 'alpha_svc/model.py');
    const projB = await uploadProject(tokenB, 'Beta App', 'beta_svc/model.py');

    // 1) B's project list shows only B's project.
    const bProjects = await request(http).get('/api/v1/projects').set('Authorization', `Bearer ${tokenB}`);
    expect(bProjects.body.map((p: any) => p.project_id)).toEqual([projB.project_id]);

    // 2) B scanning B's own project reads B's workspace.
    const bScan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projB.project_id });
    expect(bScan.status).toBe(201);
    expect(bScan.body.directory).toBe(projB.root_directory);

    // 3) THE LEAK, fixed: B spoofs A's workspace path — it is IGNORED; the scan
    //    still resolves to B's own project workspace, never A's.
    const spoof = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projB.project_id, directory: projA.root_directory });
    expect(spoof.status).toBe(201);
    expect(spoof.body.directory).toBe(projB.root_directory);
    expect(spoof.body.directory).not.toBe(projA.root_directory);

    // 4) B cannot scan A's project by id (cross-org → 403).
    await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projA.project_id }).expect(403);

    // 5) B cannot point a raw directory scan at A's workspace (needs a project).
    await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ directory: projA.root_directory }).expect(403);

    // 6) B cannot import candidates into A's project.
    await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projA.project_id, file_paths: ['alpha_svc/model.py'] }).expect(403);
  });

  it('SECURITY: a scanned hardcoded secret survives import — model is HIGH risk and keeps the finding', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Secret Repo' });
    const projectId = p.body.project_id;
    // Rules-based file (no ML/LLM signals) → the scanner's risk hint is LOW …
    // … but it carries a hardcoded credential that must elevate the saved model.
    const zip = new AdmZip();
    zip.addFile('fin/portfolio_checkpoint.py', Buffer.from(
      '"""Core FinQuant portfolio checkpoint."""\n' +
      'api_key = "q7HgSuperSecret9t66"\n\n' +
      'def portfolio_decision_score(w, r):\n    return sum(a * b for a, b in zip(w, r))\n',
    ));
    await request(http).post(`/api/v1/projects/${projectId}/codebase`).set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'c.zip').expect(201);

    // Scan detects the secret; the static risk hint alone is only LOW.
    const scan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId }).expect(201);
    const cand = scan.body.candidates.find((c: any) => c.file_path === 'fin/portfolio_checkpoint.py');
    expect(cand).toBeDefined();
    expect(cand.risk_hint).toBe('LOW');
    expect(cand.secrets).toHaveLength(1);

    // Import: the finding is carried over AND the model is floored at HIGH.
    const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, file_paths: ['fin/portfolio_checkpoint.py'], overwrite: true }).expect(201);
    const modelId = imported.body[0].model_id;
    expect(imported.body[0].risk_level).toBe('HIGH');

    const list = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    const saved = list.body.find((m: any) => m.model_id === modelId);
    expect(saved.risk_level).toBe('HIGH');
    expect(saved.security_findings).toHaveLength(1);
    expect(saved.security_findings[0].type).toBe('Generic Secret Key');
    expect(saved.security_findings[0].masked_value).not.toContain('SuperSecret'); // value is masked

    // An unrelated governance edit re-triages the model, but the unremediated
    // secret keeps it floored at HIGH — it must not silently drop to LOW.
    await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${admin}`)
      .send({ owner_team: 'Risk', actor: 'test' }).expect(200);
    const after = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(after.body.find((m: any) => m.model_id === modelId).risk_level).toBe('HIGH');
  });

  it('AI SUMMARY: heuristic summariser rewrites the description with reviewable provenance', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Zoo Signal Engine',
        model_type: 'RULES_BASED',
        functional_area: 'trading_signal_generation',
        use_case_description: 'Composite signal engine over ``Alpha Zoo`` factors. Unlike ``example_signal_engine`` (per-symbol API that takes ``dict[code, OHLCV]``), this consumes a registry.',
      }).expect(201);
    const modelId = reg.body.model_id;
    // A freshly registered model's description is human-entered, not AI/auto.
    expect(reg.body.description_source).toBe('static');

    const sum = await request(http).post(`/api/v1/inventory/models/${modelId}/summarize`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(sum.body.ai_enabled).toBe(false); // no key configured in tests → local heuristic
    expect(sum.body.description_source).toBe('heuristic');
    expect(sum.body.description_model).toBeNull();
    // Reframed, not a verbatim copy: code jargon is stripped, governance framing added.
    expect(sum.body.summary).toContain('Zoo Signal Engine');
    expect(sum.body.summary).not.toContain('dict[code');
    expect(sum.body.summary).toMatch(/review and confirm/i);

    // Provenance is persisted and surfaced on the model.
    const list = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`).expect(200);
    const saved = list.body.find((m: any) => m.model_id === modelId);
    expect(saved.description_source).toBe('heuristic');

    // A human edit flips provenance to 'human'.
    await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${admin}`)
      .send({ use_case_description: 'Combines quant signals into one trade-ranking score.', actor: 'test' }).expect(200);
    const after = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(after.body.find((m: any) => m.model_id === modelId).description_source).toBe('human');
  });

  it('AI PROVIDERS: org registry — CRUD with masked keys, tenant isolation, per-org precedence', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const SECRET_KEY = 'sk-secret-test-12345-do-not-leak';

    // A local mock OpenAI-compatible server — no real API is ever called.
    const httpMod = await import('http');
    let lastAuthHeader = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        lastAuthHeader = String(req.headers['authorization'] ?? '');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'MOCK-LLM: governed summary output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      // Two orgs, one OWNER each.
      const mkOrg = async (name: string) => (await request(http)
        .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
      const orgA = await mkOrg('AI Org Alpha');
      const orgB = await mkOrg('AI Org Beta');
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-owner@alpha.test', full_name: 'A', password: 'pw123456', role: 'OWNER', organization_id: orgA }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-owner@beta.test', full_name: 'B', password: 'pw123456', role: 'OWNER', organization_id: orgB }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-viewer@alpha.test', full_name: 'V', password: 'pw123456', role: 'VIEWER', organization_id: orgA }).expect(201);
      const ownerA = await login('ai-owner@alpha.test', 'pw123456');
      const ownerB = await login('ai-owner@beta.test', 'pw123456');
      const viewerA = await login('ai-viewer@alpha.test', 'pw123456');

      // VIEWER cannot touch the registry — data egress is a governance decision.
      await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${viewerA}`).expect(403);

      // OWNER A registers a provider pointing at the mock.
      const created = await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ownerA}`)
        .send({
          label: 'Mock LLM', adapter: 'openai-compat',
          base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'mock-1', api_key: SECRET_KEY,
        }).expect(201);
      const providerId = created.body.provider_id;
      // The key NEVER comes back — only a mask.
      expect(JSON.stringify(created.body)).not.toContain(SECRET_KEY);
      expect(created.body.has_api_key).toBe(true);
      expect(created.body.api_key_masked).toContain('…');
      expect(created.body.local_endpoint).toBe(true); // 127.0.0.1 = on-box

      // Tenant isolation: B sees nothing and cannot reach A's config by id.
      const bList = await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${ownerB}`).expect(200);
      expect(bList.body).toHaveLength(0);
      await request(http).patch(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerB}`)
        .send({ label: 'hijack' }).expect(404);
      await request(http).delete(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerB}`).expect(404);

      // Connection test round-trips the DECRYPTED key to the provider.
      const test = await request(http).post(`/api/v1/ai/providers/${providerId}/test`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(test.body.status).toBe('ok');
      expect(typeof test.body.latency_ms).toBe('number');
      expect(lastAuthHeader).toBe(`Bearer ${SECRET_KEY}`);

      // Precedence: org A's summarize goes through its registered provider…
      const regA = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Alpha Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores things' }).expect(201);
      const sumA = await request(http).post(`/api/v1/inventory/models/${regA.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(sumA.body.ai_enabled).toBe(true);
      expect(sumA.body.summary).toBe('MOCK-LLM: governed summary output.');
      expect(sumA.body.description_source).toBe('ai');
      expect(sumA.body.description_model).toBe('mock-1');
      expect(sumA.body.provider).toContain('Mock LLM');

      // …while org B (no provider) falls back to the local heuristic.
      const regB = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Beta Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores things too' }).expect(201);
      const sumB = await request(http).post(`/api/v1/inventory/models/${regB.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerB}`).expect(200);
      expect(sumB.body.ai_enabled).toBe(false);
      expect(sumB.body.description_source).toBe('heuristic');

      // Disabled providers are never selected — A drops back to the heuristic.
      await request(http).patch(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerA}`)
        .send({ enabled: false }).expect(200);
      const sumA2 = await request(http).post(`/api/v1/inventory/models/${regA.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(sumA2.body.ai_enabled).toBe(false);
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('PROMPT VAULT: versioned org templates — validation, history, restore, reset, and reaching the LLM', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Mock LLM that records the prompt it was sent.
    const httpMod = await import('http');
    let lastPrompt = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        try { lastPrompt = JSON.parse(body)?.messages?.[0]?.content ?? ''; } catch { lastPrompt = ''; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'VAULT-MOCK output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const mkOrg = async (name: string) => (await request(http)
        .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
      const orgA = await mkOrg('Vault Org A');
      const orgB = await mkOrg('Vault Org B');
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'vault-a@x.test', full_name: 'VA', password: 'pw123456', role: 'CISO', organization_id: orgA }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'vault-b@x.test', full_name: 'VB', password: 'pw123456', role: 'CISO', organization_id: orgB }).expect(201);
      const cisoA = await login('vault-a@x.test', 'pw123456');
      const cisoB = await login('vault-b@x.test', 'pw123456');

      // Defaults: all use cases listed, none customized.
      const defaults = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(defaults.body.map((p: any) => p.use_case).sort())
        .toEqual(['autonomous_scope', 'exec_narrative', 'gap_remediation', 'model_summary', 'risk_rationale']);
      expect(defaults.body.every((p: any) => p.customized === false)).toBe(true);

      // Validation: dropping a required variable is a hard 400…
      await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'Summarize something without the model name.' }).expect(400);
      // …an unknown variable is a warning, not a block.
      const warned = await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'CUSTOM-VAULT-PROMPT for {{name}} with {{tyop}}.' }).expect(200);
      expect(warned.body.version).toBe(1);
      expect(warned.body.warnings[0]).toContain('{{tyop}}');

      // v2 becomes active; history shows both, newest first.
      const v2 = await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'CUSTOM-VAULT-PROMPT-V2 for {{name}} ({{model_type}}).', change_note: 'tightened' }).expect(200);
      expect(v2.body.version).toBe(2);
      const hist = await request(http).get('/api/v1/ai/prompts/model_summary/history').set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(hist.body.map((h: any) => h.version)).toEqual([2, 1]);
      expect(hist.body[0].active).toBe(true);
      expect(hist.body[0].change_note).toBe('tightened');

      // Tenant isolation: org B still sees the pristine default.
      const bList = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoB}`).expect(200);
      expect(bList.body.find((p: any) => p.use_case === 'model_summary').customized).toBe(false);

      // The custom template actually reaches the provider: register a provider
      // for org A, summarize, and inspect the prompt the mock received.
      await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${cisoA}`)
        .send({ label: 'Vault Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'vm-1' }).expect(201);
      const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${cisoA}`)
        .send({ name: 'Vaulted Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores' }).expect(201);
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(lastPrompt).toContain('CUSTOM-VAULT-PROMPT-V2 for Vaulted Scorer (MACHINE_LEARNING).');

      // Restore v1 → lands as v3 with v1's body; then reset → default applies.
      const restored = await request(http).post('/api/v1/ai/prompts/model_summary/restore/1')
        .set('Authorization', `Bearer ${cisoA}`).send({}).expect(200);
      expect(restored.body.version).toBe(3);
      await request(http).post('/api/v1/ai/prompts/model_summary/reset').set('Authorization', `Bearer ${cisoA}`).send({}).expect(200);
      const after = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoA}`).expect(200);
      const ms = after.body.find((p: any) => p.use_case === 'model_summary');
      expect(ms.customized).toBe(false);
      expect(ms.version_count).toBe(3); // history preserved through reset

      // After reset, the DEFAULT prompt drives the next generation.
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(lastPrompt).toContain('You are an AI-governance analyst.');
      expect(lastPrompt).not.toContain('CUSTOM-VAULT-PROMPT');
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('AI DRAFTS: signals reach the summary prompt; rationale + remediation carry provenance', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const httpMod = await import('http');
    let lastPrompt = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        try { lastPrompt = JSON.parse(body)?.messages?.[0]?.content ?? ''; } catch { lastPrompt = ''; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'DRAFT-MOCK output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Draft Org' })).body.organization_id;
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'draft@x.test', full_name: 'D', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
      const ciso = await login('draft@x.test', 'pw123456');
      await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`)
        .send({ label: 'Draft Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'dm-1' }).expect(201);

      // Import a model whose file produces both an LLM signal and a secret.
      const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${ciso}`).send({ name: 'Draft Repo' });
      const zip = new AdmZip();
      zip.addFile('svc/llm_scorer.py', Buffer.from(
        'import openai\napi_key = "sk-fake-secret-abcdef1234"\n\ndef credit_score(x):\n    """LLM credit scorer."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
      ));
      await request(http).post(`/api/v1/projects/${p.body.project_id}/codebase`).set('Authorization', `Bearer ${ciso}`)
        .attach('file', zip.toBuffer(), 'c.zip').expect(201);
      await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${ciso}`)
        .send({ project_id: p.body.project_id }).expect(201);
      const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${ciso}`)
        .send({ project_id: p.body.project_id, file_paths: ['svc/llm_scorer.py'], overwrite: true }).expect(201);
      const modelId = imported.body[0].model_id;

      // detectionSignals persisted and surfaced.
      const list = await request(http).get(`/api/v1/inventory/models?project_id=${p.body.project_id}`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const saved = list.body.find((m: any) => m.model_id === modelId);
      expect(saved.detection_signals.length).toBeGreaterThan(0);

      // (1) Summary prompt now carries the real signals.
      await request(http).post(`/api/v1/inventory/models/${modelId}/summarize`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(lastPrompt).toContain('Static-analysis signals:');
      for (const sig of saved.detection_signals.slice(0, 2)) expect(lastPrompt).toContain(sig);

      // (2) Risk rationale: persisted with 'ai' provenance; prompt grounded in
      // the engine's factors (risk level + the secret-floor explanation).
      const rat = await request(http).post(`/api/v1/inventory/models/${modelId}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(rat.body.risk_rationale).toBe('DRAFT-MOCK output.');
      expect(rat.body.risk_rationale_source).toBe('ai');
      expect(lastPrompt).toContain('HIGH');
      expect(lastPrompt).toContain('hardcoded secret');
      expect(lastPrompt).not.toContain('sk-fake-secret-abcdef1234'); // secrets never leave

      // Human edit flips rationale provenance to 'human'.
      await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${ciso}`)
        .send({ risk_rationale: 'Confirmed: HIGH due to credit decisioning + secret in source.', actor: 'test' }).expect(200);
      const after = await request(http).get(`/api/v1/inventory/models?project_id=${p.body.project_id}`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(after.body.find((m: any) => m.model_id === modelId).risk_rationale_source).toBe('human');

      // (3) Remediation draft: per-gap lines reach the provider; not persisted.
      const rem = await request(http).post(`/api/v1/inventory/models/${modelId}/draft-remediation`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(rem.body.open_gaps).toBeGreaterThan(0);
      expect(rem.body.draft).toBe('DRAFT-MOCK output.');
      expect(lastPrompt).toContain('[RBI FREE-AI]');
      expect(lastPrompt).toContain('Open gaps:');

      // Heuristic fallback: disable the provider — drafts still work, labeled.
      const provs = await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`).expect(200);
      await request(http).patch(`/api/v1/ai/providers/${provs.body[0].provider_id}`).set('Authorization', `Bearer ${ciso}`)
        .send({ enabled: false }).expect(200);
      const hRat = await request(http).post(`/api/v1/inventory/models/${modelId}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(hRat.body.risk_rationale_source).toBe('heuristic');
      expect(hRat.body.risk_rationale).toContain('classified HIGH risk');
      const hRem = await request(http).post(`/api/v1/inventory/models/${modelId}/draft-remediation`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(hRem.body.draft_source).toBe('heuristic');
      expect(hRem.body.draft).toContain('→ Action:');
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('AI GOVERNANCE: configured LLM self-registers in inventory; usage metered; breaker trips', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const httpMod = await import('http');

    // Mock that reports token usage — and can be switched into failure mode.
    let failMode = false;
    let hits = 0;
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        hits++;
        res.setHeader('content-type', 'application/json');
        if (failMode) { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
        res.end(JSON.stringify({
          choices: [{ message: { content: 'METER-MOCK output.' } }],
          usage: { prompt_tokens: 111, completion_tokens: 22 },
        }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Meter Org' })).body.organization_id;
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'meter@x.test', full_name: 'M', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
      const ciso = await login('meter@x.test', 'pw123456');

      // Creating a provider SELF-REGISTERS the LLM in the org's own inventory.
      const created = await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`)
        .send({ label: 'Meter Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'mm-1' }).expect(201);
      expect(created.body.linked_model_id).toBeTruthy();
      const inv = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`).expect(200);
      const selfModel = inv.body.find((m: any) => m.model_id === created.body.linked_model_id);
      expect(selfModel).toBeDefined(); // visible to the org (lives in its Governance Tooling project)
      expect(selfModel.name).toBe('LLM: Meter Mock');
      expect(selfModel.compliance_pass).toBe(false); // a governance obligation, like any model

      // A summarize call is metered with the provider-reported token counts.
      const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`)
        .send({ name: 'Metered Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores' }).expect(201);
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const usage1 = await request(http).get('/api/v1/ai/usage').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(usage1.body.total_calls).toBe(1);
      expect(usage1.body.tokens_in).toBe(111);
      expect(usage1.body.tokens_out).toBe(22);
      expect(usage1.body.recent[0].use_case).toBe('model_summary');
      expect(usage1.body.recent[0].actor).toBe('meter@x.test');

      // Circuit breaker: 3 consecutive failures open it; the 4th call doesn't
      // even reach the provider and degrades to the labeled heuristic.
      failMode = true;
      for (let i = 0; i < 3; i++) {
        const r = await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/risk-rationale`)
          .set('Authorization', `Bearer ${ciso}`).expect(200);
        expect(r.body.risk_rationale_source).toBe('heuristic'); // failed → fell back
      }
      const hitsAfterFailures = hits;
      const r4 = await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(r4.body.risk_rationale_source).toBe('heuristic');
      expect(hits).toBe(hitsAfterFailures); // breaker open — provider NOT called

      // Failures were metered too — full reliability visibility.
      const usage2 = await request(http).get('/api/v1/ai/usage').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(usage2.body.failed_calls).toBe(3);
      expect(usage2.body.ok_calls).toBe(1);

      // Deleting the provider retires (never deletes) the self-registered model.
      await request(http).delete(`/api/v1/ai/providers/${created.body.provider_id}`).set('Authorization', `Bearer ${ciso}`).expect(204);
      const invAfter = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(invAfter.body.find((m: any) => m.model_id === created.body.linked_model_id)).toBeUndefined(); // inactive
      const ledger = await request(http).get(`/api/v1/inventory/models/${created.body.linked_model_id}/ledger`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const events = (ledger.body.events ?? ledger.body).map((e: any) => e.event_type ?? e.eventType);
      expect(events).toContain('MODEL_DECOMMISSIONED'); // history preserved
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('MATRIX: fleet endpoint returns per-model framework verdicts + gaps, tenant-scoped', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Matrix Org' })).body.organization_id;
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'matrix@x.test', full_name: 'MX', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
    const ciso = await login('matrix@x.test', 'pw123456');

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${ciso}`).send({ name: 'Matrix Proj' });
    const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`)
      .send({ name: 'Matrix Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting', use_case_description: 'scores', project_id: p.body.project_id }).expect(201);

    const mx = await request(http).get('/api/v1/compliance/matrix').set('Authorization', `Bearer ${ciso}`).expect(200);
    // Tenant-scoped: exactly this org's model, with all four framework verdicts.
    expect(mx.body.components).toHaveLength(1);
    const row = mx.body.components[0];
    expect(row.model_id).toBe(reg.body.model_id);
    expect(Object.keys(row.frameworks).sort()).toEqual(['eu', 'iso', 'nist', 'rbi']);
    for (const f of Object.values<any>(row.frameworks)) expect(['ok', 'gap']).toContain(f.status);
    expect(['ok', 'warn', 'alert']).toContain(row.drift);
    // An ungoverned HIGH-risk model must surface HIGH-severity gaps with framework labels.
    const rowGaps = mx.body.gaps.filter((g: any) => g.model_id === row.model_id);
    expect(rowGaps.length).toBeGreaterThan(0);
    expect(rowGaps.every((g: any) => g.severity === 'HIGH')).toBe(true);
    expect(new Set(rowGaps.map((g: any) => g.framework)).size).toBeGreaterThan(1);
  });

  it('RBAC: an OWNER administers only their own org and cannot mint ADMINs', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const mkOrg = async (name: string) => (await request(http)
      .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
    const orgX = await mkOrg('Org X');
    const orgY = await mkOrg('Org Y');

    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@x.test', full_name: 'OX', password: 'pw123456', role: 'OWNER', organization_id: orgX }).expect(201);
    const yUser = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'viewer@y.test', full_name: 'VY', password: 'pw123456', role: 'VIEWER', organization_id: orgY });
    const ownerX = await login('owner@x.test', 'pw123456');

    // OWNER creates a user — org is forced to their own (the passed orgY is ignored),
    // and CISO is within an OWNER's ceiling.
    const created = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${ownerX}`)
      .send({ email: 'ciso@x.test', full_name: 'CX', password: 'pw123456', role: 'CISO', organization_id: orgY });
    expect(created.status).toBe(201);
    expect(created.body.organization_id).toBe(orgX);
    expect(created.body.role).toBe('CISO');

    // OWNER cannot mint an ADMIN (create or promote).
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${ownerX}`)
      .send({ email: 'a2@x.test', full_name: 'A2', password: 'pw123456', role: 'ADMIN' }).expect(403);
    await request(http).patch(`/api/v1/users/${created.body.user_id}`).set('Authorization', `Bearer ${ownerX}`)
      .send({ role: 'ADMIN' }).expect(403);

    // OWNER's user list is org-scoped — no global admin, no other org.
    const list = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${ownerX}`);
    const emails = list.body.map((u: any) => u.email);
    expect(emails).toContain('owner@x.test');
    expect(emails).toContain('ciso@x.test');
    expect(emails).not.toContain('admin@sentrai.local');
    expect(emails).not.toContain('viewer@y.test');

    // OWNER cannot manage another org's user.
    await request(http).patch(`/api/v1/users/${yUser.body.user_id}`).set('Authorization', `Bearer ${ownerX}`)
      .send({ role: 'REVIEWER' }).expect(403);
    await request(http).delete(`/api/v1/users/${yUser.body.user_id}`).set('Authorization', `Bearer ${ownerX}`).expect(403);

    // Last-owner guard: even a global admin cannot demote the only OWNER of org X.
    const allUsers = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    const ownerRow = allUsers.body.find((u: any) => u.email === 'owner@x.test');
    await request(http).patch(`/api/v1/users/${ownerRow.user_id}`).set('Authorization', `Bearer ${admin}`)
      .send({ role: 'VIEWER' }).expect(403);
  });

  it('CI GATE: blocks a shadow-AI model and passes once it is governed', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'CI Gate App', description: 'ci gate test' });
    const projectId = proj.body.project_id;

    // Mint a project-scoped CI service token.
    const tok = await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, label: 'ci-gate-test' });
    expect(tok.status).toBe(201);
    const ciToken = tok.body.token;
    expect(typeof ciToken).toBe('string');

    // Minting for a non-existent project fails clearly here, not later at scan time.
    await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: 'no-such-project', label: 'x' })
      .expect(404);

    // A policy that blocks any detected model of any severity that isn't governed.
    const policy = [
      'gates:',
      '  block_on:',
      '    - severity: LOW',
      '      missing: [registered, owner_team, board_policy_ref]',
      '    - severity: MEDIUM',
      '      missing: [registered, owner_team, board_policy_ref]',
      '    - severity: HIGH',
      '      missing: [registered, owner_team, board_policy_ref]',
      '  frameworks: [eu_ai_act]',
    ].join('\n');

    const modelCode =
      'import openai\n\n' +
      'def score_credit(applicant):\n' +
      '    """Credit underwriting via LLM."""\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n';

    const files = [
      { path: '.sentrai/policy.yaml', content: policy },
      { path: 'app/credit_model.py', content: modelCode },
    ];

    // 1) Shadow AI (no registered model) → FAIL, with SARIF + an audit record.
    const fail = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'abc123', pr_number: '7', files });
    expect(fail.status).toBe(200);
    expect(fail.body.verdict).toBe('fail');
    expect(fail.body.summary.shadow_assets).toBeGreaterThan(0);
    expect(fail.body.sarif.runs[0].results.length).toBeGreaterThan(0);
    expect(fail.body.gate_event_id).toBeTruthy();

    // The interactive JWT must NOT be accepted on the CI endpoint.
    await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${admin}`)
      .send({ commit_sha: 'x', files })
      .expect(401);

    // 2) Govern the model (matching source_ref) with owner + board policy.
    await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Credit Model',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM credit underwriting assistant for retail lending.',
        owner_team: 'Risk Analytics',
        board_policy_ref: 'BOARD-AI-POLICY-2026',
        source_ref: 'app/credit_model.py',
        project_id: projectId,
      })
      .expect(201);

    // 3) Same commit, now governed → PASS, no blocking violations.
    const pass = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'abc123', pr_number: '7', files });
    expect(pass.status).toBe(200);
    expect(pass.body.verdict).toBe('pass');
    expect(pass.body.blocking_violations.length).toBe(0);

    // 4) The immutable gate trail records both decisions, newest first.
    const history = await request(http)
      .get(`/api/v1/ci/projects/${projectId}/gate-history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body.length).toBe(2);
    expect(history.body[0].verdict).toBe('pass');
    expect(history.body[1].verdict).toBe('fail');
  });

  it('RISK ESCALATION: CI gate blocks code scanning above the registered risk tier', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const proj = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Risk Escalation App', description: 'risk escalation test' });
    const tok = await request(http).post('/api/v1/ci/tokens').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: proj.body.project_id, label: 'risk-escalation' });
    const scan = (files: Array<{ path: string; content: string }>) => request(http).post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${tok.body.token}`).send({ commit_sha: 'abc123', files }).expect(200);

    // Registered with an owner and board policy, at a tier below HIGH.
    const model = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`).send({
      name: 'Retail Scorer',
      model_type: 'MACHINE_LEARNING',
      functional_area: 'customer_support',
      use_case_description: 'Ranks support tickets for the service desk.',
      human_oversight_required: true,
      owner_team: 'Risk Analytics',
      board_policy_ref: 'BOARD-AI-POLICY-2026',
      source_ref: 'svc/credit/retail_scorer.py',
      project_id: proj.body.project_id,
    }).expect(201);
    expect(model.body.risk_level).not.toBe('HIGH');

    const files = [{
      path: 'svc/credit/retail_scorer.py',
      content: 'import openai\n\ndef score(applicant):\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
    }];

    const fail = await scan(files);
    expect(fail.body.verdict).toBe('fail');
    const gap = fail.body.blocking_violations.find((g: any) => g.kind === 'risk_escalation');
    expect(gap.model_name).toBe('Retail Scorer');
    expect(gap.severity).toBe('HIGH');
    expect(fail.body.sarif.runs[0].results.map((r: any) => r.ruleId)).toContain('SENTRAI-RISK-ESCALATION');

    // A repository policy can opt out.
    const policy = 'gates:\n  block_on:\n    - severity: HIGH\n      missing: [registered]\n  risk_escalation:\n    enforce: false\n';
    const optedOut = await scan([...files, { path: '.sentrai/policy.yaml', content: policy }]);
    expect(optedOut.body.verdict).toBe('pass');
  });

  it('TOOL AUTHORIZATION: CI gate blocks a tool used outside the permitted set (Pillar 2)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Tool Authz App', description: 'pillar 2 test' });
    const projectId = proj.body.project_id;

    const tok = await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, label: 'tool-authz' });
    const ciToken = tok.body.token;

    // An LLM agent that shells out AND makes a network call — two capabilities.
    const agentCode =
      'import openai\n' +
      'import subprocess, requests\n\n' +
      'def agent(task):\n' +
      '    """LLM planning agent."""\n' +
      '    openai.chat.completions.create(model="gpt-4", messages=[])\n' +
      '    subprocess.run(task, shell=True)\n' +
      '    return requests.get("https://api.example.com/data")\n';
    const files = [{ path: 'app/agent.py', content: agentCode }];

    // Govern the model and declare it may ONLY use the network capability.
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Planning Agent',
        model_type: 'AGENT',
        functional_area: 'internal_tooling',
        use_case_description: 'Internal LLM planning agent that calls tools to complete ops tasks.',
        owner_team: 'Platform Eng',
        board_policy_ref: 'BOARD-AI-POLICY-2026',
        source_ref: 'app/agent.py',
        project_id: projectId,
      });
    expect(model.status).toBe(201);
    const modelId = model.body.model_id;

    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ permitted_tools: ['capability:network'], actor: 'e2e' })
      .expect(200);

    // Scan: shell is used but not permitted → gate FAILS on tool authorization.
    const fail = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'tool1', files });
    expect(fail.status).toBe(200);
    expect(fail.body.verdict).toBe('fail');
    expect(fail.body.summary.tool_authorization_violations).toBeGreaterThan(0);
    const taGap = fail.body.blocking_violations.find((g: any) => g.kind === 'tool_authorization');
    expect(taGap).toBeTruthy();
    expect(taGap.unauthorized_tools).toContain('capability:shell');

    // Authorize the shell capability too → the same commit now PASSES.
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ permitted_tools: ['capability:network', 'capability:shell'], actor: 'e2e' })
      .expect(200);

    const pass = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'tool1', files });
    expect(pass.status).toBe(200);
    expect(pass.body.verdict).toBe('pass');

    // Agent identity propagation (Pillar 3): the scan returns the registry id to
    // stamp into the build as SENTRAI_MODEL_ID.
    expect(pass.body.model_identities).toEqual(
      expect.arrayContaining([expect.objectContaining({ sentrai_model_id: modelId, file: 'app/agent.py' })]),
    );

    // The model response reflects a compliant tool authorization.
    const record = await request(http)
      .get(`/api/v1/inventory/models/${modelId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(record.body.tool_authorization.compliant).toBe(true);
    expect(record.body.tool_authorization.unauthorized).toHaveLength(0);
  });

  it('CONTROL: the kill switch suspends a model and the polled state reflects it (Pillar 2)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Kill Switch Target',
        model_type: 'AGENT',
        functional_area: 'internal_tooling',
        use_case_description: 'An agent used to demonstrate the operational kill switch.',
      });
    const modelId = model.body.model_id;
    expect(model.body.operational_state).toBe('ACTIVE');

    // The public polled contract (no auth) starts ACTIVE.
    const p0 = await request(http).get(`/api/v1/control/models/${modelId}/poll`);
    expect(p0.status).toBe(200);
    expect(p0.body.state).toBe('ACTIVE');
    expect(p0.body.kill_switch).toBe(false);

    // Suspend — the kill switch.
    const susp = await request(http)
      .post(`/api/v1/control/models/${modelId}/suspend`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'anomalous autonomous actions observed in production' });
    expect(susp.status).toBe(200);
    expect(susp.body.state).toBe('SUSPENDED');
    expect(susp.body.kill_switch).toBe(true);

    // The polled contract an integrated agent checks now says: halt.
    const p1 = await request(http).get(`/api/v1/control/models/${modelId}/poll`);
    expect(p1.body.state).toBe('SUSPENDED');
    expect(p1.body.kill_switch).toBe(true);

    // Suspended models are listed org-wide.
    const suspended = await request(http)
      .get('/api/v1/control/suspended')
      .set('Authorization', `Bearer ${admin}`);
    expect(suspended.body.some((m: any) => m.model_id === modelId)).toBe(true);

    // Resume clears the kill switch.
    const res = await request(http)
      .post(`/api/v1/control/models/${modelId}/resume`)
      .set('Authorization', `Bearer ${admin}`);
    expect(res.body.state).toBe('ACTIVE');
    const p2 = await request(http).get(`/api/v1/control/models/${modelId}/poll`);
    expect(p2.body.kill_switch).toBe(false);

    // Both control actions are on the immutable model ledger.
    const ledger = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/ledger`)
      .set('Authorization', `Bearer ${admin}`);
    const types = ledger.body.map((e: any) => e.event_type);
    expect(types).toContain('OPERATIONAL_SUSPENDED');
    expect(types).toContain('OPERATIONAL_RESUMED');
  });

  it('VISIBILITY: ingests runtime telemetry, flags unauthorized tool use, and builds a cross-ledger timeline (Pillar 3)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Telemetry Agent',
        model_type: 'AGENT',
        functional_area: 'internal_tooling',
        use_case_description: 'An agent whose runtime actions are reported to the telemetry endpoint.',
      });
    const modelId = model.body.model_id;

    // Declare the agent may only use the network capability.
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ permitted_tools: ['capability:network'], actor: 'e2e' })
      .expect(200);

    // Ingest three runtime events — the shell tool call is outside the permitted
    // set, so it is flagged on arrival (Pillar 2 authorization, observed at runtime).
    const ingest = await request(http)
      .post('/api/v1/telemetry/events')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        events: [
          { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:network', session_id: 's1', outcome: 'success' },
          { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:shell', session_id: 's1' },
          { sentrai_model_id: modelId, type: 'decision', session_id: 's1', detail: { summary: 'approved within policy' } },
        ],
      });
    expect(ingest.status).toBe(201);
    expect(ingest.body.ingested).toBe(3);
    expect(ingest.body.flagged).toBe(1);

    // An event for an unknown model is not ingested.
    const unknown = await request(http)
      .post('/api/v1/telemetry/events')
      .set('Authorization', `Bearer ${admin}`)
      .send({ events: [{ sentrai_model_id: 'no-such-model', type: 'decision' }] });
    expect(unknown.body.ingested).toBe(0);
    expect(unknown.body.unknown_models).toContain('no-such-model');

    // Org summary reflects the ingested events + the flagged tool call.
    const summary = await request(http).get('/api/v1/telemetry/summary').set('Authorization', `Bearer ${admin}`);
    expect(summary.body.total_events).toBeGreaterThanOrEqual(3);
    expect(summary.body.flagged_tool_calls).toBeGreaterThanOrEqual(1);
    expect(summary.body.by_type.tool_call).toBeGreaterThanOrEqual(2);

    // Per-model events: the shell call is recorded as an authorization breach.
    const events = await request(http).get(`/api/v1/telemetry/models/${modelId}/events`).set('Authorization', `Bearer ${admin}`);
    expect(events.body).toHaveLength(3);
    expect(events.body.some((e: any) => e.flagged && e.outcome === 'unauthorized_tool' && e.tool === 'capability:shell')).toBe(true);

    // Cross-ledger timeline stitches governance-ledger + runtime action records.
    const timeline = await request(http).get(`/api/v1/telemetry/models/${modelId}/timeline`).set('Authorization', `Bearer ${admin}`);
    expect(timeline.body.sentrai_model_id).toBe(modelId);
    const sources = new Set(timeline.body.timeline.map((r: any) => r.source));
    expect(sources.has('action')).toBe(true);
    expect(sources.has('ledger')).toBe(true);
  });

  it('SECURITY: an adversarial report records red-team evidence and satisfies the control (Pillar 4)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Adversarial Target',
        model_type: 'GENERATIVE_AI',
        functional_area: 'customer_chatbot',
        use_case_description: 'A customer-facing chatbot subjected to adversarial red-teaming.',
      });
    const modelId = model.body.model_id;
    // Before: no red-team date on record.
    expect(model.body.last_red_team_date).toBeFalsy();

    const adv = await request(http)
      .post(`/api/v1/inventory/models/${modelId}/adversarial-evidence`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ suite: 'garak', total_probes: 120, failures: 3, categories: ['jailbreak', 'prompt_injection'] });
    expect(adv.status).toBe(201);
    expect(adv.body.resist_rate).toBe(97.5);
    expect(adv.body.breached).toBe(true);
    expect(adv.body.last_red_team_date).toBeTruthy();

    // A typed red_team artifact is on the model, and the red-team control is now satisfied.
    const evidence = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evidence.body.evidence.some((a: any) => a.type === 'red_team')).toBe(true);

    const record = await request(http)
      .get(`/api/v1/inventory/models/${modelId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(record.body.last_red_team_date).toBeTruthy();
  });

  it('SECURITY: runtime unauthorized tool use surfaces as a scope-deviation alert (Pillar 4)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Deviating Agent',
        model_type: 'AGENT',
        functional_area: 'internal_tooling',
        use_case_description: 'An agent that will breach its declared tool scope at runtime.',
      });
    const modelId = model.body.model_id;

    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ permitted_tools: ['capability:network'], actor: 'e2e' })
      .expect(200);

    // Two runtime tool calls outside the permitted set — both flagged.
    const ingest = await request(http)
      .post('/api/v1/telemetry/events')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        events: [
          { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:shell', session_id: 'dev1' },
          { sentrai_model_id: modelId, type: 'tool_call', tool: 'capability:filesystem', session_id: 'dev1' },
        ],
      });
    expect(ingest.body.flagged).toBe(2);

    // The scope-deviation view aggregates them into an alert for this model.
    const dev = await request(http).get('/api/v1/telemetry/scope-deviations').set('Authorization', `Bearer ${admin}`);
    expect(dev.status).toBe(200);
    const mine = dev.body.deviations.find((d: any) => d.model_id === modelId);
    expect(mine).toBeTruthy();
    expect(mine.unauthorized_calls).toBeGreaterThanOrEqual(2);
    expect(['HIGH', 'MEDIUM']).toContain(mine.severity);
    expect(mine.tools).toEqual(expect.arrayContaining(['capability:shell', 'capability:filesystem']));
  });

  it('SOCIETAL: the grievance workflow enforces its state machine and SLA (Pillar 5)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Grievance Target',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'A credit model that a consumer files a grievance against.',
        owner_team: 'Risk Ops',
      });
    const modelId = model.body.model_id;

    const filed = await request(http)
      .post('/api/v1/grievances')
      .set('Authorization', `Bearer ${admin}`)
      .send({ model_id: modelId, subject: 'Loan declined without explanation', description: 'The system rejected my application and gave no reason at all.', category: 'no_explanation', severity: 'HIGH' });
    expect(filed.status).toBe(201);
    expect(filed.body.status).toBe('RECEIVED');
    expect(filed.body.sla_due_at).toBeTruthy();
    expect(filed.body.is_overdue).toBe(false);
    const gid = filed.body.grievance_id;

    // An illegal jump (RECEIVED → CLOSED) is rejected by the state machine.
    await request(http)
      .patch(`/api/v1/grievances/${gid}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'CLOSED' })
      .expect(400);

    // The legal path: acknowledge → investigate → resolve.
    await request(http).patch(`/api/v1/grievances/${gid}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'ACKNOWLEDGED' }).expect(200);
    await request(http).patch(`/api/v1/grievances/${gid}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'INVESTIGATING' }).expect(200);
    const resolved = await request(http)
      .patch(`/api/v1/grievances/${gid}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'RESOLVED', notes: 'Explanation provided; decision re-reviewed by a human.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolved_at).toBeTruthy();

    const summary = await request(http).get('/api/v1/grievances/summary').set('Authorization', `Bearer ${admin}`);
    expect(summary.body.total).toBeGreaterThanOrEqual(1);
    expect(summary.body.resolved).toBeGreaterThanOrEqual(1);

    // The redress trail is on the model ledger.
    const ledger = await request(http).get(`/api/v1/inventory/models/${modelId}/ledger`).set('Authorization', `Bearer ${admin}`);
    const types = ledger.body.map((e: any) => e.event_type);
    expect(types).toContain('GRIEVANCE_FILED');
    expect(types).toContain('GRIEVANCE_RESOLVED');
  });

  it('SOCIETAL: public transparency card, public grievance filing, and framework-as-data (Pillar 5)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Public Card Model',
        model_type: 'GENERATIVE_AI',
        functional_area: 'customer_chatbot',
        use_case_description: 'A customer chatbot with a public transparency card.',
        owner_team: 'Customer Experience',
      });
    const modelId = model.body.model_id;

    // Framework-as-data: the regime registry is public.
    const regimes = await request(http).get('/api/v1/regimes');
    expect(regimes.status).toBe(200);
    expect(regimes.body.regimes.some((r: any) => r.name === 'RBI FREE-AI')).toBe(true);

    // Public transparency card (no auth) — governed regimes + a redress channel.
    const card = await request(http).get(`/api/v1/cards/${modelId}`);
    expect(card.status).toBe(200);
    expect(card.body.name).toBe('Public Card Model');
    expect(card.body.governed_under.length).toBeGreaterThanOrEqual(4);
    expect(card.body.redress.available).toBe(true);
    expect(card.body.redress.file_url).toContain(modelId);

    // The human-readable card page renders (no auth).
    const page = await request(http).get(`/card/${modelId}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('AI Transparency Card');
    expect(page.text).toContain('File a grievance');

    // A consumer files a grievance publicly, by model UUID, with no account.
    const pub = await request(http)
      .post(`/api/v1/grievances/public/${modelId}`)
      .send({ subject: 'Chatbot gave wrong account info', description: 'The assistant told me incorrect details about my account balance.' });
    expect(pub.status).toBe(201);
    expect(pub.body.status).toBe('RECEIVED');

    // The card now reflects the received grievance.
    const card2 = await request(http).get(`/api/v1/cards/${modelId}`);
    expect(card2.body.redress.grievances.total).toBeGreaterThanOrEqual(1);
  });

  it('CI LEDGER: org-wide events carry line-level evidence; override is additive (verdict preserved)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Ledger App', description: 'ledger test' });
    const projectId = proj.body.project_id;

    const tok = await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, label: 'ledger-test' });
    const ciToken = tok.body.token;

    const policy = [
      'gates:',
      '  block_on:',
      '    - severity: LOW',
      '      missing: [registered, owner_team]',
      '    - severity: MEDIUM',
      '      missing: [registered, owner_team]',
      '    - severity: HIGH',
      '      missing: [registered, owner_team]',
      '  frameworks: [eu_ai_act]',
    ].join('\n');
    // The rogue aliased import is exactly the kind of AST signal the viewer shows.
    const rogue =
      'from transformers import Pipeline as rogue_ai\n' +
      'import openai\n\n' +
      'def score_credit(applicant):\n' +
      '    """Credit underwriting via LLM."""\n' +
      '    clf = rogue_ai("text-classification")\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n';
    const files = [
      { path: '.sentrai/policy.yaml', content: policy },
      { path: 'svc/rogue.py', content: rogue },
    ];

    const fail = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'deadbeefcafe', pr_number: '42', files });
    expect(fail.status).toBe(200);
    expect(fail.body.verdict).toBe('fail');
    const eventId = fail.body.gate_event_id;

    // Org-wide ledger surfaces the event with line-level evidence for the viewer.
    const ledger = await request(http)
      .get('/api/v1/ci/events?verdict=fail')
      .set('Authorization', `Bearer ${admin}`);
    expect(ledger.status).toBe(200);
    const row = ledger.body.find((e: any) => e.gate_event_id === eventId);
    expect(row).toBeTruthy();
    expect(row.effective_verdict).toBe('fail');
    expect(row.project_name).toBe('Ledger App');
    const gap = row.blocking_violations[0];
    expect(Array.isArray(gap.evidence)).toBe(true);
    expect(gap.evidence.length).toBeGreaterThan(0);
    expect(gap.evidence[0]).toHaveProperty('line');
    expect(gap.evidence[0]).toHaveProperty('snippet');

    // A short justification is rejected.
    await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'ok' })
      .expect(400);

    // Auditor sign-off override.
    const ov = await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'Compensating control approved under ticket GRC-123.' });
    expect(ov.status).toBe(200);
    expect(ov.body.overridden).toBe(true);
    expect(ov.body.overridden_by).toBe('admin@sentrai.local');
    // Immutability: the ORIGINAL verdict is preserved; only effective flips.
    expect(ov.body.verdict).toBe('fail');
    expect(ov.body.effective_verdict).toBe('pass');

    // Double-override is refused.
    await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'Trying to override again, should fail.' })
      .expect(403);

    // The immutable audit_events ledger captured the override action + actor.
    const audit = await request(http)
      .get('/api/v1/audit/events?path=/override')
      .set('Authorization', `Bearer ${admin}`);
    expect(audit.status).toBe(200);
  });

  it('DRIFT: stored score windows evaluate on demand and trip the circuit breaker', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Drift App', description: 'drift test' });
    const projectId = proj.body.project_id;

    const model = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Collections Propensity',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'collections',
        use_case_description: 'Scores repayment propensity for collections routing',
        human_oversight_required: true,
        board_policy_ref: 'BP-11',
        project_id: projectId,
      });
    const modelId = model.body.model_id;

    // With no windows pushed there is nothing to compare — a clear 400, not a crash.
    await request(http).post(`/api/v1/monitoring/drift/${modelId}/evaluate`)
      .set('Authorization', `Bearer ${admin}`).expect(400);

    // Reference clusters low, live clusters high: a large, unambiguous shift.
    const reference = Array.from({ length: 200 }, (_, i) => 0.20 + (i % 20) * 0.005);
    const live = Array.from({ length: 200 }, (_, i) => 0.70 + (i % 20) * 0.005);
    await request(http).post(`/api/v1/monitoring/scores/${modelId}`).set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'reference', scores: reference, accuracy: 0.9 }).expect(201);
    await request(http).post(`/api/v1/monitoring/scores/${modelId}`).set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'live', scores: live, accuracy: 0.78 }).expect(201);

    const evaluated = await request(http).post(`/api/v1/monitoring/drift/${modelId}/evaluate`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.psi_score).toBeGreaterThan(0.2);
    expect(evaluated.body.accuracy_delta).toBeCloseTo(-0.12, 2);
    expect(evaluated.body.circuit_breaker_active).toBe(true);
    expect(evaluated.body.remediation_action).toBeTruthy();

    // The report is persisted and readable from history.
    const history = await request(http).get(`/api/v1/monitoring/drift/${modelId}/history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].status).toBe(evaluated.body.status);
  });

  it('MERGE: a model found in several files becomes one record, not a dropped duplicate', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Merge Repo' });
    const projectId = p.body.project_id;

    // The same scorer appears in two files: the definition and a caller that
    // also leaks a credential. Both must land on ONE governed record.
    const zip = new AdmZip();
    zip.addFile('svc/fraud_scorer.py', Buffer.from(
      'import openai\n\n' +
      'def fraud_scorer(txn):\n    """Scores card transactions for fraud."""\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
    ));
    zip.addFile('jobs/fraud_scorer.py', Buffer.from(
      'import openai\n\n' +
      'api_key = "sk-liveSecretValue9911"\n\n' +
      'def fraud_scorer(batch):\n    """Nightly batch fraud scoring."""\n' +
      '    return [openai.chat.completions.create(model="gpt-4", messages=[]) for _ in batch]\n',
    ));
    await request(http).post(`/api/v1/projects/${projectId}/codebase`).set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'c.zip').expect(201);

    const scan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId }).expect(201);
    const paths = scan.body.candidates.map((c: any) => c.file_path);
    expect(paths).toContain('svc/fraud_scorer.py');
    expect(paths).toContain('jobs/fraud_scorer.py');

    const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, file_paths: paths }).expect(201);

    // Every scanned candidate is accounted for — nothing silently vanishes.
    expect(imported.body).toHaveLength(paths.length);
    const merged = imported.body.filter((m: any) => m.merged);
    expect(merged.length).toBeGreaterThan(0);

    // The two same-named hits collapsed onto a single model id.
    const scorerRows = imported.body.filter((m: any) => /fraud/i.test(m.name));
    const distinctIds = new Set(scorerRows.map((m: any) => m.model_id));
    expect(scorerRows.length).toBe(2);
    expect(distinctIds.size).toBe(1);

    const modelId = [...distinctIds][0] as string;
    const list = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    const model = list.body.find((m: any) => m.model_id === modelId);
    expect(model).toBeDefined();
    // Both files are recorded, and the credential from the SECOND file still
    // floors the merged record at HIGH.
    expect(model.source_refs).toEqual(
      expect.arrayContaining(['svc/fraud_scorer.py', 'jobs/fraud_scorer.py']),
    );
    expect(model.risk_level).toBe('HIGH');
    expect(model.security_findings.length).toBeGreaterThan(0);
    expect(model.merge_history).toHaveLength(1);

    // Source: every file the model appears in, each with the lines where the
    // scanner found it (the openai call; the leaked key at line 3 in jobs/).
    const locs = new Map<string, number[]>(model.source_locations.map((l: any) => [l.file, l.lines]));
    expect([...locs.keys()].sort()).toEqual(['jobs/fraud_scorer.py', 'svc/fraud_scorer.py']);
    for (const lines of locs.values()) expect(lines.length).toBeGreaterThan(0);
    expect(locs.get('jobs/fraud_scorer.py')).toContain(3);

    // The merge is on the immutable ledger, naming the file that was folded in.
    const audit = await request(http).get(`/api/v1/inventory/models/${modelId}/ledger`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    const mergeEvent = audit.body.find((e: any) => e.event_type === 'MODEL_SOURCES_MERGED');
    expect(mergeEvent).toBeDefined();
    // Whichever file the scanner reached first became the record; the other
    // was folded in and named on the ledger.
    const both = ['svc/fraud_scorer.py', 'jobs/fraud_scorer.py'];
    expect(both).toContain(mergeEvent.event_data.merged_source_ref);
    expect(mergeEvent.event_data.merged_source_ref).not.toBe(model.source_ref);
    expect(mergeEvent.event_data.all_source_refs).toEqual(expect.arrayContaining(both));
  });

  it('AUTO-GEN: import populates all three generations; re-scan backfills only what is missing', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Autogen Repo' });
    const projectId = p.body.project_id;

    const zip = new AdmZip();
    zip.addFile('svc/loan_ranker.py', Buffer.from(
      'import openai\n\n' +
      'def loan_ranker(app):\n    """Ranks loan applications by approval likelihood."""\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
    ));
    await request(http).post(`/api/v1/projects/${projectId}/codebase`).set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'c.zip').expect(201);

    const scan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId }).expect(201);
    const paths = scan.body.candidates.map((c: any) => c.file_path);
    const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, file_paths: paths }).expect(201);
    const modelId = imported.body[0].model_id;

    // Generation is queued, not inline — wait for the queue to drain.
    const drained = async () => {
      for (let i = 0; i < 60; i++) {
        const st = await request(http).get('/api/v1/inventory/generation-status')
          .set('Authorization', `Bearer ${admin}`);
        if (!st.body.running && st.body.queued === 0) return st.body;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('generation queue did not drain');
    };
    await drained();

    const read = async () => {
      const list = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
        .set('Authorization', `Bearer ${admin}`).expect(200);
      return list.body.find((m: any) => m.model_id === modelId);
    };

    const after = await read();
    // All three are populated with reviewable provenance (heuristic here — no
    // provider is configured in the test env — but the same path AI takes).
    expect(after.description_source).toBe('heuristic');
    expect(after.risk_rationale).toBeTruthy();
    expect(after.risk_rationale_source).toBe('heuristic');
    expect(after.gap_remediation).toBeTruthy();
    expect(after.gap_remediation_source).toBe('heuristic');

    // A re-scan must not redo finished work: nothing is queued the second time.
    const rescan = await request(http).post('/api/v1/inventory/models/rescan')
      .set('Authorization', `Bearer ${admin}`).send({ project_id: projectId }).expect(200);
    expect(rescan.body.generations_queued).toBe(0);

    // But a model missing a generation IS backfilled by the re-scan.
    const manual = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Hand Registered Scorer',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'credit_underwriting',
        use_case_description: 'Registered by hand, never summarised',
        human_oversight_required: true,
        board_policy_ref: 'BP-2',
        project_id: projectId,
      }).expect(201);

    const rescan2 = await request(http).post('/api/v1/inventory/models/rescan')
      .set('Authorization', `Bearer ${admin}`).send({ project_id: projectId }).expect(200);
    expect(rescan2.body.generations_queued).toBeGreaterThan(0);
    await drained();

    const list2 = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    const backfilled = list2.body.find((m: any) => m.model_id === manual.body.model_id);
    expect(backfilled.risk_rationale).toBeTruthy();
    expect(backfilled.gap_remediation).toBeTruthy();
  });

  it('EXEC NARRATIVE: board paragraph is grounded in the rollup numbers and persisted', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Narrative Co' });
    const projectId = p.body.project_id;

    await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Board Reported Scorer',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM scores credit applications',
        human_oversight_required: false,
        board_policy_ref: '',
        project_id: projectId,
      }).expect(201);

    const res = await request(http).post(`/api/v1/compliance/exec-narrative?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);

    expect(res.body.narrative).toBeTruthy();
    expect(res.body.narrative_source).toBe('heuristic');
    // Grounded, not invented: the statistics handed to the model are returned
    // alongside so a reviewer can check the paragraph against them.
    expect(res.body.grounded_in.portfolio_stats).toContain('1 models registered');
    expect(res.body.grounded_in.ci_metrics).toBeTruthy();

    // Persisted on the project so the readiness report and console agree.
    const rollup = await request(http).get(`/api/v1/compliance/portfolio?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(rollup.body.summary.total_models).toBe(1);
  });

  it('USAGE: the LLM usage dashboard aggregates metered calls by day, model and actor', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const org = await request(http).post('/api/v1/organizations/').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Usage Corp' }).expect(201);
    const orgId = org.body.organization_id ?? org.body.id;

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Usage Proj' });
    const model = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Usage Scorer',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'credit_underwriting',
        use_case_description: 'Scores things',
        human_oversight_required: true,
        board_policy_ref: 'BP-9',
        project_id: p.body.project_id,
      }).expect(201);

    // Drive real metered calls through the heuristic path.
    await request(http).post(`/api/v1/inventory/models/${model.body.model_id}/summarize`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    await request(http).post(`/api/v1/inventory/models/${model.body.model_id}/risk-rationale`)
      .set('Authorization', `Bearer ${admin}`).expect(200);

    const usage = await request(http).get(`/api/v1/ai/usage?organization_id=${orgId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);

    // The dashboard shape the console renders.
    expect(usage.body.window_days).toBe(30);
    expect(usage.body.daily).toHaveLength(30);
    expect(Array.isArray(usage.body.use_cases)).toBe(true);
    expect(Array.isArray(usage.body.models)).toBe(true);
    expect(Array.isArray(usage.body.actors)).toBe(true);
    expect(usage.body).toHaveProperty('success_rate');
    expect(usage.body).toHaveProperty('p95_latency_ms');
    expect(usage.body).toHaveProperty('total_tokens');
    // The window is honoured.
    const short = await request(http).get(`/api/v1/ai/usage?organization_id=${orgId}&days=7`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(short.body.window_days).toBe(7);
    expect(short.body.daily).toHaveLength(7);
  });

  it('keeps incidents inside the organization that owns the model', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    // Two organizations, each with a CISO, a project, a model and an incident.
    const setup = async (name: string) => {
      const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
      const email = `ciso@${name.toLowerCase()}.test`;
      await request(http).post('/api/v1/users').set(auth(admin))
        .send({ email, full_name: name, password: 'pw123456', role: 'CISO', organization_id: org.body.organization_id }).expect(201);
      const token = await login(email, 'pw123456');
      const project = await request(http).post('/api/v1/projects').set(auth(token))
        .send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
      const model = await request(http).post('/api/v1/inventory/models').set(auth(token)).send({
        name: `${name} Scorer`, model_type: 'MACHINE_LEARNING', functional_area: 'collections', use_case_description: 'Scores collections accounts for prioritisation',
        human_oversight_required: true, board_policy_ref: 'BP-1', project_id: project.body.project_id,
      }).expect(201);
      return { token, orgId: org.body.organization_id, projectId: project.body.project_id, modelId: model.body.model_id };
    };
    const report = (token: string, modelId: string) => request(http).post('/api/v1/compliance/incident/report').set(auth(token)).send({
      model_id: modelId, model_name: 'Scorer', re_name: 'RE', functional_area: 'collections', incident_category: 'MODEL_DRIFT',
      severity: 'P4_LOW', description: 'Mild population-stability shift flagged in the routine drift review',
      observed_at: '2026-07-11T06:00:00Z', detected_at: '2026-07-11T06:30:00Z', model_risk_level: 'LOW', immediate_action_taken: 'Retrained on the extended window and revalidated',
    });

    const a = await setup('IncidentOrgA');
    const b = await setup('IncidentOrgB');
    const incA = (await report(a.token, a.modelId).expect(201)).body.incident_id;
    const incB = (await report(b.token, b.modelId).expect(201)).body.incident_id;

    // Lists and aggregates only cover the caller's organization, even when
    // asking for the other organization's project.
    const ids = (r: any) => r.body.map((i: any) => i.incident_id);
    const listA = await request(http).get('/api/v1/compliance/incident').set(auth(a.token)).expect(200);
    expect(ids(listA)).toEqual([incA]);
    const peek = await request(http).get(`/api/v1/compliance/incident?project_id=${b.projectId}`).set(auth(a.token)).expect(200);
    expect(ids(peek)).toEqual([]);
    const risk = await request(http).get('/api/v1/compliance/incident/sectoral-risk').set(auth(a.token)).expect(200);
    expect(risk.body.total_incidents).toBe(1);

    // Another organization's incident or model looks like it doesn't exist.
    await request(http).get(`/api/v1/compliance/incident/${incA}`).set(auth(a.token)).expect(200);
    await request(http).get(`/api/v1/compliance/incident/${incB}`).set(auth(a.token)).expect(404);
    await request(http).patch(`/api/v1/compliance/incident/${incB}/status`).set(auth(a.token)).send({ status: 'RESOLVED' }).expect(404);
    await report(a.token, b.modelId).expect(404);

    // A global ADMIN sees both, and the project filter narrows to one.
    const all = await request(http).get('/api/v1/compliance/incident').set(auth(admin)).expect(200);
    expect(ids(all)).toEqual(expect.arrayContaining([incA, incB]));
    const scoped = await request(http).get(`/api/v1/compliance/incident?project_id=${a.projectId}`).set(auth(admin)).expect(200);
    expect(ids(scoped)).toEqual([incA]);

    // The board pack can't be pointed at another organization's project either.
    const board = await app.get(ComplianceService).boardReport(
      { userId: 'u', email: 'ciso@a.test', fullName: 'A', role: Role.CISO, tenantId: a.orgId },
      b.projectId,
    );
    expect(board.incidents.total).toBe(0);
  });

  it('raises one incident per model when new gate findings land on the default branch', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = { Authorization: `Bearer ${admin}` };
    const proj = await request(http).post('/api/v1/projects').set(auth).send({ name: 'Landed Findings App', description: 'gate incidents' });
    const projectId = proj.body.project_id;
    const tok = await request(http).post('/api/v1/ci/tokens').set(auth).send({ project_id: projectId, label: 'landed' });

    const llm = 'import openai\n\ndef run(x):\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n';
    const oldFile = { path: 'svc/credit/old_helper.py', content: llm };
    const newFile = { path: 'svc/fraud/new_helper.py', content: llm };
    const scan = (body: Record<string, unknown>) => request(http).post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${tok.body.token}`).send({ commit_sha: 'abc123', ...body }).expect(200);
    const incidents = async () => (await request(http).get(`/api/v1/compliance/incident?project_id=${projectId}`).set(auth).expect(200)).body;

    // The first default-branch run only sets the baseline, and repeating it adds nothing.
    await scan({ default_branch_push: true, files: [oldFile] });
    await scan({ default_branch_push: true, files: [oldFile] });
    expect(await incidents()).toEqual([]);

    // A blocked PR is the control working, so a new finding there raises nothing.
    const pr = await scan({ pr_number: '9', files: [oldFile, newFile] });
    expect(pr.body.verdict).toBe('fail');
    expect(await incidents()).toEqual([]);

    // Landing it raises one P3 incident, for the new finding only.
    const landed = await scan({ default_branch_push: true, files: [oldFile, newFile] });
    expect(landed.body.project_name).toBe('Landed Findings App');
    expect(landed.body.incidents_raised.map((i: any) => i.model_name)).toEqual(['New Helper']);
    expect(landed.body.incident_error).toBeNull();
    const raised = await incidents();
    expect(raised).toHaveLength(1);
    expect(raised[0].model_name).toBe('New Helper');
    expect(raised[0].severity).toBe('P3_MEDIUM');
    expect(raised[0].description).toContain('svc/fraud/new_helper.py');

    // The ledger's project filter only returns this project's events.
    const ledger = await request(http).get(`/api/v1/ci/events?project_id=${projectId}`).set(auth).expect(200);
    expect(ledger.body.length).toBeGreaterThan(0);
    expect(ledger.body.every((e: any) => e.project_id === projectId)).toBe(true);

    // Later pushes with the same finding don't add a duplicate.
    await scan({ default_branch_push: true, files: [oldFile, newFile] });
    expect(await incidents()).toHaveLength(1);

    // The same model name landing in a new file is a new finding.
    await scan({ default_branch_push: true, files: [oldFile, newFile, { path: 'svc/fraud/old_helper.py', content: llm }] });
    const afterNewFile = await incidents();
    expect(afterNewFile.map((i: any) => i.model_name).sort()).toEqual(['New Helper', 'Old Helper']);

    // It belongs to the project's organization: visible to ADMIN, hidden from others.
    const org = await request(http).post('/api/v1/organizations').set(auth).send({ name: 'Landed Other Org', description: 'test' }).expect(201);
    await request(http).post('/api/v1/users').set(auth)
      .send({ email: 'ciso@landed-other.test', full_name: 'Other', password: 'pw123456', role: 'CISO', organization_id: org.body.organization_id }).expect(201);
    const other = await login('ciso@landed-other.test', 'pw123456');
    await request(http).get(`/api/v1/compliance/incident/${raised[0].incident_id}`).set('Authorization', `Bearer ${other}`).expect(404);
    await request(http).get(`/api/v1/compliance/incident/${raised[0].incident_id}`).set(auth).expect(200);
  });
  it('PHASE 0: corrected compliance codes are printed and flagged checks stay off by default', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const project = await request(http).post('/api/v1/projects').set(auth(admin)).send({ name: 'Labels App', root_directory: process.cwd() }).expect(201);
    const model = await request(http).post('/api/v1/inventory/models').set(auth(admin)).send({
      name: 'Labels Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting',
      use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
      board_policy_ref: 'BP-1', project_id: project.body.project_id,
    }).expect(201);
    const cc = await request(http).get(`/api/v1/inventory/models/${model.body.model_id}/compliance-check`).set(auth(admin)).expect(200);
    const nist = cc.body.nist_rmf.checks.map((c: any) => c.control_code);
    expect(nist).toEqual(expect.arrayContaining(['GOVERN-2.1', 'GOVERN-1.5', 'GOVERN-3.2', 'MAP-4.1', 'MEASURE-2.4', 'MEASURE-2.7', 'MANAGE-2.4', 'MANAGE-4.3']));
    for (const legacy of ['GOVERN-1.1', 'GOVERN-1.3', 'MAP-1.2', 'MAP-1.3', 'MEASURE-2.1', 'MEASURE-2.2', 'MANAGE-1.1', 'MANAGE-1.2', 'MANAGE-1.3', 'MEASURE-2.10']) {
      expect(nist).not.toContain(legacy);
    }
    const impact = cc.body.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-8.4');
    expect(impact).toMatchObject({ passed: false, mandatory: false, not_assessed: true });
    expect(cc.body.iso_42001.checks.map((c: any) => c.control_code)).not.toContain('AIMS-8.2');

    const cov = await request(http).get('/api/v1/compliance/coverage').set(auth(admin)).expect(200);
    const codes = cov.body.frameworks.flatMap((f: any) => f.evaluated.map((c: any) => c.code));
    expect(codes).not.toEqual(expect.arrayContaining(['REC-16']));
    expect(codes).not.toContain('REC-24');
    expect(codes).not.toContain('MEASURE-2.10');
    expect(codes).not.toContain('REC-21');
    const page = await request(http).get('/coverage').expect(200);
    expect(page.text).toContain('GOVERN-3.2');
    expect(page.text).not.toContain('MANAGE-1.1');
  });

  it('BCP DRILLS: hidden unless enabled, then org-scoped with Owner/CISO/Admin writes (E0.4)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const setup = async (name: string) => {
      const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
      const user = async (role: string) => {
        const email = `${role.toLowerCase()}@${name.toLowerCase()}.test`;
        await request(http).post('/api/v1/users').set(auth(admin))
          .send({ email, full_name: `${name} ${role}`, password: 'pw123456', role, organization_id: org.body.organization_id }).expect(201);
        return login(email, 'pw123456');
      };
      const owner = await user('OWNER');
      const viewer = await user('VIEWER');
      const reviewer = await user('REVIEWER');
      const project = await request(http).post('/api/v1/projects').set(auth(owner)).send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
      const model = await request(http).post('/api/v1/inventory/models').set(auth(owner)).send({
        name: `${name} Credit`, model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting',
        use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
        board_policy_ref: 'BP-1', project_id: project.body.project_id,
      }).expect(201);
      return { owner, viewer, reviewer, modelId: model.body.model_id };
    };
    const a = await setup('DrillOrgA');
    const b = await setup('DrillOrgB');
    const drill = { scenario: 'Model endpoint outage; fall back to rules engine', result: 'PASSED_WITH_FINDINGS', findings: 'Failover took 4 minutes' };
    const path = (id: string) => `/api/v1/monitoring/bcp/${id}/drills`;

    // Flag off (default): the routes do not exist.
    await request(http).get(path(a.modelId)).set(auth(a.owner)).expect(404);
    await request(http).post(path(a.modelId)).set(auth(a.owner)).send(drill).expect(404);

    const prev = process.env.GOVERNANCE_V2;
    process.env.GOVERNANCE_V2 = 'true';
    try {
      // RBAC: viewers and reviewers cannot record; another org's model is a 404.
      await request(http).post(path(a.modelId)).set(auth(a.viewer)).send(drill).expect(403);
      await request(http).post(path(a.modelId)).set(auth(a.reviewer)).send(drill).expect(403);
      await request(http).post(path(a.modelId)).set(auth(b.owner)).send(drill).expect(404);
      await request(http).get(path(a.modelId)).set(auth(b.owner)).expect(404);

      // HIGH model with no drill: Sutra 7 fails on the drill.
      const before = await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200);
      const safetyBefore = before.body.checks.find((c: any) => c.sutra === 'SAFETY_RESILIENCE_SUSTAINABILITY');
      expect(safetyBefore.passed).toBe(false);
      expect(safetyBefore.gap).toContain('no passed BCP drill');

      await request(http).post(path(a.modelId)).set(auth(a.owner))
        .send({ ...drill, conducted_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(400);
      await request(http).post(path(a.modelId)).set(auth(a.owner)).send({ ...drill, result: 'MAYBE' }).expect(400);
      const rec = await request(http).post(path(a.modelId)).set(auth(a.owner)).send(drill).expect(201);
      expect(rec.body).toMatchObject({ result: 'PASSED_WITH_FINDINGS', drill_status: 'CURRENT' });
      // A back-dated older drill never moves drillLastConducted backwards.
      await request(http).post(path(a.modelId)).set(auth(a.owner))
        .send({ ...drill, result: 'PASSED', conducted_at: new Date(Date.now() - 400 * 86_400_000).toISOString() }).expect(201);

      const list = await request(http).get(path(a.modelId)).set(auth(a.viewer)).expect(200);
      expect(list.body.drills).toHaveLength(2);
      expect(list.body.drill_status).toBe('CURRENT');
      expect(list.body.drill_last_conducted).toBe(rec.body.conducted_at);

      // The drill clears the drill part of Sutra 7 (no red-team on record, so it still fails on that).
      const after = await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200);
      const safetyAfter = after.body.checks.find((c: any) => c.sutra === 'SAFETY_RESILIENCE_SUSTAINABILITY');
      expect(safetyAfter.gap).not.toContain('BCP drill');

      // The ledger records the drill.
      const ledger = await request(http).get(`/api/v1/inventory/models/${a.modelId}/ledger`).set(auth(a.owner)).expect(200);
      expect(JSON.stringify(ledger.body)).toContain('BCP_DRILL_RECORDED');
    } finally {
      if (prev === undefined) delete process.env.GOVERNANCE_V2;
      else process.env.GOVERNANCE_V2 = prev;
    }
  });
  it('BCP DRILLS: list, project and detail agree; failed drills do not count; reminders split per org (review fixes)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const setup = async (name: string) => {
      const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
      const email = `ciso@${name.toLowerCase()}.test`;
      await request(http).post('/api/v1/users').set(auth(admin))
        .send({ email, full_name: name, password: 'pw123456', role: 'CISO', organization_id: org.body.organization_id }).expect(201);
      const token = await login(email, 'pw123456');
      const project = await request(http).post('/api/v1/projects').set(auth(token)).send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
      const model = await request(http).post('/api/v1/inventory/models').set(auth(token)).send({
        name: `${name} Credit`, model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting',
        use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
        board_policy_ref: 'BP-1', project_id: project.body.project_id, sutras_alignment: ['UNDERSTANDABLE_BY_DESIGN'],
        last_red_team_date: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      }).expect(201);
      return { token, orgId: org.body.organization_id, projectId: project.body.project_id, modelId: model.body.model_id };
    };
    const a = await setup('ReviewDrillA');
    const b = await setup('ReviewDrillB');
    const path = (id: string) => `/api/v1/monitoring/bcp/${id}/drills`;
    const drill = { scenario: 'Scoring endpoint outage; fall back to rules engine', result: 'PASSED' };
    const safetyGap = async (token: string, id: string) =>
      (await request(http).get(`/api/v1/inventory/models/${id}/compliance-check`).set(auth(token)).expect(200))
        .body.checks.find((c: any) => c.sutra === 'SAFETY_RESILIENCE_SUSTAINABILITY');
    // The model list, model detail, project and compliance check must all agree.
    const views = async (t: { token: string; modelId: string; projectId: string }) => {
      const list = (await request(http).get(`/api/v1/inventory/models?project_id=${t.projectId}`).set(auth(t.token)).expect(200)).body;
      const rows = Array.isArray(list) ? list : list.models ?? list.items;
      const row = rows.find((r: any) => r.model_id === t.modelId);
      const detail = (await request(http).get(`/api/v1/inventory/models/${t.modelId}`).set(auth(t.token)).expect(200)).body;
      const project = (await request(http).get(`/api/v1/projects/${t.projectId}`).set(auth(t.token)).expect(200)).body;
      const cc = (await request(http).get(`/api/v1/inventory/models/${t.modelId}/compliance-check`).set(auth(t.token)).expect(200)).body;
      return { list: row.compliance_pass, detail: detail.compliance_pass, project: project.compliant_count === 1, cc: cc.overall_pass, gaps: [row.open_gap_count, detail.open_gap_count, project.open_gap_count, cc.blocking_gaps.length] };
    };

    const prev = process.env.GOVERNANCE_V2;
    process.env.GOVERNANCE_V2 = 'true';
    const notify = jest.spyOn(NotifierService.prototype, 'notify').mockResolvedValue(undefined);
    try {
      const before = await views(a);
      expect(new Set([before.list, before.detail, before.project, before.cc])).toEqual(new Set([false]));
      expect(new Set(before.gaps).size).toBe(1);

      // A FAILED drill does not satisfy Rec 21, and is reported as the latest result.
      const failed = await request(http).post(path(a.modelId)).set(auth(a.token)).send({ ...drill, result: 'FAILED' }).expect(201);
      expect(failed.body).toMatchObject({ drill_status: 'NONE', drill_last_conducted: null, latest_drill_result: 'FAILED' });
      expect((await safetyGap(a.token, a.modelId)).gap).toContain('no passed BCP drill');

      // Recording drills never creates a BCP fallback state (MANAGE-2.4 stays failed).
      const status = await request(http).get(`/api/v1/monitoring/bcp/${a.modelId}/status`).set(auth(a.token)).expect(200);
      expect(status.body.bcp_active).toBe(false);
      expect(status.body.reason).toBeUndefined();
      const cc = await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.token)).expect(200);
      expect(cc.body.nist_rmf.checks.find((c: any) => c.control_code === 'MANAGE-2.4').passed).toBe(false);

      // Admin (global superuser) can record across organizations; a passed drill clears Sutra 7 everywhere.
      const ok = await request(http).post(path(a.modelId)).set(auth(admin)).send(drill).expect(201);
      expect(ok.body).toMatchObject({ drill_status: 'CURRENT', latest_drill_result: 'PASSED' });
      expect((await safetyGap(a.token, a.modelId)).passed).toBe(true);
      const after = await views(a);
      expect(new Set([after.list, after.detail, after.project, after.cc]).size).toBe(1);
      expect(new Set(after.gaps).size).toBe(1);
      expect(after.gaps[0]).toBeLessThan(before.gaps[0]);

      // The reminder job sends one notification per organization; org B (no drill) is in its own payload.
      await app.get(ScheduledTasksService).checkBcpDrills();
      const calls = notify.mock.calls.filter(([event]) => event === 'bcp_drill_due').map(([, data]) => data as any);
      const forB = calls.find((d) => d.tenant_id === b.orgId);
      expect(forB.models.map((m: any) => m.model_id)).toEqual([b.modelId]);
      for (const d of calls) expect(d.models.every((m: any) => m.tenant_id === d.tenant_id)).toBe(true);
      expect(calls.flatMap((d) => d.models.map((m: any) => m.model_id))).not.toContain(a.modelId);

      // Portfolio top gaps never count a model more than once per control.
      const portfolio = await request(http).get('/api/v1/compliance/portfolio').set(auth(a.token)).expect(200);
      for (const g of portfolio.body.top_gaps) expect(g.count).toBeLessThanOrEqual(portfolio.body.summary.total_models);
    } finally {
      notify.mockRestore();
      if (prev === undefined) delete process.env.GOVERNANCE_V2;
      else process.env.GOVERNANCE_V2 = prev;
    }
  });

  /** Org with an owner, viewer and CISO plus one HIGH credit model (governance Phase 1 e2e helpers). */
  const govOrg = async (name: string) => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
    const user = async (role: string) => {
      const email = `${role.toLowerCase()}@${name.toLowerCase()}.test`;
      await request(http).post('/api/v1/users').set(auth(admin))
        .send({ email, full_name: `${name} ${role}`, password: 'pw123456', role, organization_id: org.body.organization_id }).expect(201);
      return login(email, 'pw123456');
    };
    const owner = await user('OWNER');
    const ciso = await user('CISO');
    const viewer = await user('VIEWER');
    const orgAdmin = await user('ADMIN');
    const project = await request(http).post('/api/v1/projects').set(auth(owner)).send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
    const model = await request(http).post('/api/v1/inventory/models').set(auth(owner)).send({
      name: `${name} Credit`, model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting',
      use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
      board_policy_ref: 'BP-1', project_id: project.body.project_id, target_customer_segments: ['sme'],
    }).expect(201);
    return { admin, owner, ciso, viewer, orgAdmin, orgId: org.body.organization_id, projectId: project.body.project_id, modelId: model.body.model_id, auth };
  };

  /** Phase 2 epics pinned off, for Phase 1 tests that compare against exact Phase 1 output. */
  const PHASE2_OFF = {
    GOV_E2_1_AU_PACK: 'false', GOV_E2_2_US_KIT: 'false', GOV_E2_3_VALIDATION: 'false', GOV_E2_4_FAIR_LENDING: 'false',
    GOV_E2_5_VENDORS: 'false', GOV_E2_6_TRAINING: 'false', GOV_E2_7_DATASETS: 'false', GOV_E2_8_REDTEAM_AUDIT: 'false',
  };

  /** Run `fn` with the given governance env vars, restoring them afterwards. */
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  it('PACKS (E1.1): hidden while off; with the engine on, compliance output is unchanged and packs, versions, controls and results are served', async () => {
    const a = await govOrg('PackOrgA');
    const b = await govOrg('PackOrgB');
    const { auth } = a;
    await request(http).get('/api/v1/governance/packs').set(auth(a.owner)).expect(404);
    await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(a.owner)).expect(404);
    const flagOffPortfolio = (await request(http).get('/api/v1/compliance/portfolio').set(auth(a.owner)).expect(200)).body;
    expect(flagOffPortfolio.packs).toBeUndefined();

    const cc = async () => (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
    let legacy: any;
    const later = { GOV_E1_2_SETTINGS: 'false', GOV_E1_3_RISKS: 'false', GOV_E1_4_IMPACT: 'false', GOV_E1_5_CONTEXT: 'false' };
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E1_1_PACKS: 'false', ...later }, async () => { legacy = await cc(); });
    // E1.1 on its own: without settings (E1.2) every pack in force applies, as today.
    await withEnv({ GOVERNANCE_V2: 'true', ...later, ...PHASE2_OFF }, async () => {
      // Golden compatibility through the API: the engine reproduces the validators exactly.
      expect(await cc()).toEqual(legacy);

      const packs = (await request(http).get('/api/v1/governance/packs').set(auth(a.viewer)).expect(200)).body;
      expect(packs.baseline).toEqual(['nist-ai-rmf', 'iso-42001']);
      expect(packs.packs.map((p: any) => p.pack_id)).toEqual(['nist-ai-rmf', 'iso-42001', 'rbi-free-ai', 'eu-ai-act']);
      for (const p of packs.packs) {
        expect(p.status).toBe('ACTIVE');
        expect(p.content_hash).toMatch(/^[0-9a-f]{64}$/);
      }
      const versions = (await request(http).get('/api/v1/governance/packs/rbi-free-ai/versions').set(auth(a.owner)).expect(200)).body;
      expect(versions.versions[0]).toMatchObject({ version: '2025.1.0', status: 'ACTIVE' });
      expect(versions.versions[0].first_loaded_at).toBeTruthy();
      await request(http).get('/api/v1/governance/packs/nope/versions').set(auth(a.owner)).expect(404);
      const diff = (await request(http).get('/api/v1/governance/packs/nist-ai-rmf/diff').set(auth(a.owner)).expect(200)).body;
      expect(diff.clauses).toEqual({ added: [], removed: [], changed: [] });

      const lib = (await request(http).get('/api/v1/governance/controls').set(auth(a.owner)).expect(200)).body;
      const fair = lib.controls.find((c: any) => c.control_id === 'CTL-FAIR-01');
      expect(fair.mapped_by).toEqual([{ pack_id: 'rbi-free-ai', code: 'FAIRNESS_AND_EQUITY', clause: 'Sutra 4' }]);

      const params = (await request(http).get('/api/v1/governance/parameters').set(auth(a.owner)).expect(200)).body;
      const hours = params.parameters.find((p: any) => p.name === 'incidentReportHours');
      expect(hours).toMatchObject({ value: 24, set_by: ['rbi-free-ai'], rule: 'min', enforced: false, enforced_by: [] });
      expect(hours.candidates.find((c: any) => c.source === 'eu-ai-act').value).toBe(360);
      expect(params.parameters.find((p: any) => p.name === 'driftRecencyDays')).toMatchObject({ enforced: true });
      await request(http).get('/api/v1/governance/parameters?as_of=not-a-date').set(auth(a.owner)).expect(400);

      // Live evaluation: one result per control, reported under every pack clause; tenant isolation.
      const ev = (await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(a.viewer)).expect(200)).body;
      expect(Object.keys(ev.pack_versions)).toEqual(['nist-ai-rmf', 'iso-42001', 'rbi-free-ai', 'eu-ai-act']);
      const owner = ev.controls.find((c: any) => c.control_id === 'CTL-ACC-01');
      expect(owner.clauses).toEqual(expect.arrayContaining(['nist-ai-rmf:GOVERN-2.1', 'iso-42001:AIMS-5.3', 'rbi-free-ai:ACCOUNTABILITY']));
      expect(ev.controls.find((c: any) => c.control_id === 'CTL-IMPACT-01').status).toBe('NOT_ASSESSED');
      await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(b.owner)).expect(404);
      const past = (await request(http).get(`/api/v1/governance/models/${a.modelId}/controls?as_of=2024-01-01`).set(auth(a.owner)).expect(200)).body;
      expect(Object.keys(past.pack_versions)).toEqual(['nist-ai-rmf', 'iso-42001']); // RBI and EU packs not yet in force
      expect(past.basis).toBe('CURRENT_MODEL_STATE_UNDER_RULES_AS_OF');
      expect(past.recorded_as_of).toBeNull(); // nothing was recorded by 2024

      await request(http).post(`/api/v1/governance/models/${a.modelId}/evaluate`).set(auth(a.viewer)).expect(403);
      await request(http).post(`/api/v1/governance/models/${a.modelId}/evaluate`).set(auth(b.owner)).expect(404);
      const rec = (await request(http).post(`/api/v1/governance/models/${a.modelId}/evaluate`).set(auth(a.owner)).expect(200)).body;
      expect(rec.recorded).toBe(ev.controls.length);
      const latest = (await request(http).get(`/api/v1/governance/models/${a.modelId}/control-results`).set(auth(a.viewer)).expect(200)).body;
      expect(latest.results).toHaveLength(ev.controls.length);
      expect(latest.results[0].pack_versions).toEqual(ev.pack_versions);
      // as_of after a recorded evaluation returns that record as it stood.
      await new Promise((r) => setTimeout(r, 1100));
      const asRecorded = (await request(http).get(`/api/v1/governance/models/${a.modelId}/controls?as_of=${new Date().toISOString()}`).set(auth(a.owner)).expect(200)).body;
      expect(asRecorded.recorded_as_of.results).toHaveLength(ev.controls.length);

      // Pack selector on the rollup.
      const all = (await request(http).get('/api/v1/compliance/portfolio').set(auth(a.owner)).expect(200)).body;
      expect(all.frameworks).toHaveLength(4);
      expect(all.packs.every((p: any) => p.selected)).toBe(true);
      const base = (await request(http).get('/api/v1/compliance/portfolio?packs=nist-ai-rmf,iso-42001').set(auth(a.owner)).expect(200)).body;
      expect(base.frameworks.map((f: any) => f.id)).toEqual(['nist_ai_rmf', 'iso_42001']);
      expect(base.packs.filter((p: any) => p.selected).map((p: any) => p.pack_id)).toEqual(['nist-ai-rmf', 'iso-42001']);
      expect(base.summary.headline).toContain('2 selected frameworks');
      // An unknown pack id is refused rather than reported as 100% compliant.
      await request(http).get('/api/v1/compliance/portfolio?packs=nist-ai-rmf,not-a-pack').set(auth(a.owner)).expect(400);
    });
  });

  it('PROJECTS: a global owner picks and changes a project organization; org members cannot move projects', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const mkOrg = async (name: string) =>
      (await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name }).expect(201)).body.organization_id;
    const orgA = await mkOrg('ProjOrg A');
    const orgB = await mkOrg('ProjOrg B');
    await request(http).post('/api/v1/users').set(auth(admin))
      .send({ email: 'g-owner@proj.test', full_name: 'G', password: 'pw12345678', role: 'OWNER' }).expect(201);
    await request(http).post('/api/v1/users').set(auth(admin))
      .send({ email: 'a-owner@proj.test', full_name: 'A', password: 'pw12345678', role: 'OWNER', organization_id: orgA }).expect(201);
    const g = await login('g-owner@proj.test', 'pw12345678');
    const aOwner = await login('a-owner@proj.test', 'pw12345678');

    await request(http).post('/api/v1/projects').set(auth(g)).send({ name: 'Proj Ghost', organization_id: 'nope' }).expect(400);
    const p = (await request(http).post('/api/v1/projects').set(auth(g)).send({ name: 'Proj Global', organization_id: orgA }).expect(201)).body;
    expect(p).toMatchObject({ tenant_id: orgA, tenant_name: 'ProjOrg A' });

    const moved = (await request(http).patch(`/api/v1/projects/${p.project_id}`).set(auth(g)).send({ organization_id: orgB }).expect(200)).body;
    expect(moved).toMatchObject({ tenant_id: orgB, tenant_name: 'ProjOrg B' });
    expect((await request(http).patch(`/api/v1/projects/${p.project_id}`).set(auth(g)).send({ organization_id: null }).expect(200)).body.tenant_id).toBeNull();

    // An org member always creates in their own org and cannot move projects out of it.
    const own = (await request(http).post('/api/v1/projects').set(auth(aOwner)).send({ name: 'Proj A Own', organization_id: orgB }).expect(201)).body;
    expect(own.tenant_id).toBe(orgA);
    await request(http).patch(`/api/v1/projects/${own.project_id}`).set(auth(aOwner)).send({ organization_id: orgB }).expect(403);
    await request(http).patch(`/api/v1/projects/${own.project_id}`).set(auth(aOwner)).send({ name: 'Proj A Renamed' }).expect(200);
  });

  it('ACTING ORG: a global OWNER works in the scoped organization via X-SentrAI-Org; org members cannot use it', async () => {
    const a = await govOrg('ActOrgA');
    const b = await govOrg('ActOrgB');
    const { auth } = a;
    await request(http).post('/api/v1/users').set(auth(a.admin))
      .send({ email: 'global-owner@act.test', full_name: 'Global Owner', password: 'pw12345678', role: 'OWNER' }).expect(201);
    const gOwner = await login('global-owner@act.test', 'pw12345678');
    const as = (t: string, org?: string) => ({ ...auth(t), ...(org ? { 'X-SentrAI-Org': org } : {}) });

    // The project response names its organization, so the console can resolve the scope.
    const proj = (await request(http).get(`/api/v1/projects/${a.projectId}`).set(auth(a.owner)).expect(200)).body;
    expect(proj.tenant_id).toBe(a.orgId);

    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      // Without a scope a global owner has no organization.
      await request(http).get('/api/v1/governance/settings').set(as(gOwner)).expect(404);
      // With the scope header they read and edit that org's settings.
      const view = (await request(http).get('/api/v1/governance/settings').set(as(gOwner, a.orgId)).expect(200)).body;
      expect(view.can_edit).toBe(true);
      await request(http).put('/api/v1/governance/settings').set(as(gOwner, a.orgId))
        .send({ settings: { gateMode: { HIGH: 'BLOCK' } }, reason: 'Global owner tightening the HIGH gate' }).expect(200);
      expect((await request(http).get('/api/v1/governance/settings').set(auth(a.owner)).expect(200)).body.settings.gateMode.HIGH).toBe('BLOCK');
      expect((await request(http).get('/api/v1/governance/settings').set(auth(b.owner)).expect(200)).body.settings.gateMode.HIGH).not.toBe('BLOCK');
      // Accountability for the scoped org opens too.
      await request(http).get(`/api/v1/organizations/${a.orgId}/accountability`).set(as(gOwner, a.orgId)).expect(200);
      // Unknown organization is a 404.
      await request(http).get('/api/v1/governance/settings').set(as(gOwner, 'no-such-org')).expect(404);
      // An org member's header is ignored: B's owner still acts in B.
      await request(http).put('/api/v1/governance/settings').set(as(b.owner, a.orgId))
        .send({ settings: { gateMode: { MEDIUM: 'BLOCK' } }, reason: 'Trying to reach another org' }).expect(200);
      expect((await request(http).get('/api/v1/governance/settings').set(auth(a.owner)).expect(200)).body.settings.gateMode.MEDIUM).not.toBe('BLOCK');
      // A global admin can read but still cannot edit settings (not an editor role).
      await request(http).put('/api/v1/governance/settings').set(as(a.admin, a.orgId))
        .send({ settings: { gateMode: { HIGH: 'WARN' } }, reason: 'Admin should not edit settings' }).expect(403);
    });
  });

  it('SETTINGS (E1.2): Owner/CISO only, reason required, effective-dated, pack floors enforced, ledger entry written, parameters applied', async () => {
    const a = await govOrg('SetOrgA');
    const b = await govOrg('SetOrgB');
    const { auth } = a;
    const put = (t: string, body: any, qs = '') => request(http).put(`/api/v1/governance/settings${qs}`).set(auth(t)).send(body);
    await request(http).get('/api/v1/governance/settings').set(auth(a.owner)).expect(404);
    await put(a.owner, { settings: { gateMode: { HIGH: 'BLOCK' } }, reason: 'Board asked for stricter gate' }).expect(404);
    const features = (await request(http).get('/api/v1/governance/features').set(auth(a.viewer)).expect(200)).body;
    expect(features.governanceSettings).toBe(false);
    const ccBody = async () => (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
    let legacy: any;
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E1_1_PACKS: 'false', GOV_E1_2_SETTINGS: 'false' }, async () => { legacy = await ccBody(); });

    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      // Default settings (baseline packs, no appetite parameters) leave every existing verdict unchanged;
      // later epics only add advisory (non-mandatory) checks.
      const cur = await ccBody();
      expect(cur.overall_pass).toBe(legacy.overall_pass);
      // Phase 2 epics add flagged advisory clauses only: every existing check is unchanged and every new one is non-mandatory.
      const known = new Set(legacy.checks.map((c: any) => c.sutra));
      expect(cur.checks.filter((c: any) => known.has(c.sutra))).toEqual(legacy.checks);
      for (const c of cur.checks.filter((x: any) => !known.has(x.sutra))) expect(c.mandatory).toBe(false);
      for (const fw of ['nist_rmf', 'eu_ai_act', 'iso_42001']) {
        expect(cur[fw].overall_pass).toBe(legacy[fw].overall_pass);
        for (const c of legacy[fw].checks) {
          const same = cur[fw].checks.find((x: any) => x.control_code === c.control_code && x.name === c.name);
          if (c.control_code === 'AIMS-8.4') continue; // register-backed once impact assessments are on
          expect(same).toEqual(c);
        }
        for (const extra of cur[fw].checks.filter((x: any) => !legacy[fw].checks.some((c: any) => c.control_code === x.control_code && c.name === x.name))) {
          expect(extra.mandatory).toBe(false);
        }
      }
      const def = (await request(http).get('/api/v1/governance/settings').set(auth(a.viewer)).expect(200)).body;
      expect(def).toMatchObject({ version: 0, is_default: true, can_edit: false });
      expect(def.settings.gateMode).toEqual({ LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'WARN', CRITICAL: 'BLOCK' });
      expect(def.settings.scoringMatrix).toBe('5x5');

      // RBAC: viewer, platform admin and the org's own ADMIN get 403; another org's owner cannot target this org.
      const change = { settings: { gateMode: { HIGH: 'BLOCK' } }, reason: 'Board asked for a stricter HIGH gate' };
      await put(a.viewer, change).expect(403);
      await put(a.admin, change).expect(403);
      await put(a.orgAdmin, change).expect(403);
      await put(b.owner, change, `?org_id=${a.orgId}`).expect(403);
      await put(a.owner, { ...change, reason: '' }).expect(400);
      await put(a.owner, { ...change, effective_from: '2020-01-01T00:00:00Z' }).expect(400);

      const v1 = (await put(a.owner, change).expect(200)).body;
      expect(v1).toMatchObject({ saved_version: 1, version: 1, is_default: false });
      expect(v1.changes).toEqual([{ field: 'gateMode.HIGH', from: 'WARN', to: 'BLOCK' }]);
      // Org B is untouched.
      expect((await request(http).get('/api/v1/governance/settings').set(auth(b.owner)).expect(200)).body.version).toBe(0);

      // Pack floors: enabling RBI forces third-party audits for HIGH/CRITICAL; a looser deadline is refused, naming the pack.
      const rbi = (await put(a.ciso, { settings: { enabledPacks: ['rbi-free-ai'] }, reason: 'Indian lending book in scope' }).expect(200)).body;
      expect(rbi.settings.appetite.requiredAuditType.HIGH).toBe('THIRD_PARTY');
      expect(rbi.floors).toEqual(expect.arrayContaining([{ name: 'incidentReportHours', value: 24, packs: ['rbi-free-ai'] }]));
      const floor = await put(a.ciso, { settings: { appetite: { parameters: { incidentReportHours: 48 } } }, reason: 'Try a looser deadline' }).expect(422);
      expect(JSON.stringify(floor.body)).toContain('rbi-free-ai');
      await put(a.ciso, { settings: { appetite: { requiredAuditType: { HIGH: 'INTERNAL' } } }, reason: 'Try internal audit only' }).expect(422);

      // Appetite parameters reach the checks: a 5-day red-team interval fails a model red teamed 10 days ago.
      await request(http).patch(`/api/v1/inventory/models/${a.modelId}/governance`).set(auth(a.owner))
        .send({ last_red_team_date: new Date(Date.now() - 10 * 86_400_000).toISOString() });
      const rt = async () => (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200))
        .body.nist_rmf.checks.find((c: any) => c.control_code === 'MEASURE-2.7');
      const before = await rt();
      await put(a.ciso, { settings: { appetite: { parameters: { 'redTeamIntervalDays.HIGH': 5 } } }, reason: 'Quarterly is too slow for credit models' }).expect(200);
      const after = await rt();
      expect(after.gap).toContain('within 5 days');
      if (before.passed) expect(after.passed).toBe(false);
      const params = (await request(http).get('/api/v1/governance/parameters').set(auth(a.owner)).expect(200)).body;
      expect(params.packs.map((p: any) => p.pack_id)).toEqual(['nist-ai-rmf', 'iso-42001', 'rbi-free-ai']);
      expect(params.parameters.find((p: any) => p.name === 'redTeamIntervalDays.HIGH')).toMatchObject({ value: 5, set_by: ['settings'] });

      // Effective dating: a future change is listed as upcoming and not yet in force.
      const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await put(a.owner, { settings: { scoringMatrix: '3x3' }, reason: 'Move to 3x3 next quarter', effective_from: future }).expect(200);
      const now = (await request(http).get('/api/v1/governance/settings').set(auth(a.owner)).expect(200)).body;
      expect(now.settings.scoringMatrix).toBe('5x5');
      expect(now.upcoming).toHaveLength(1);
      const later = (await request(http).get(`/api/v1/governance/settings?as_of=${future}`).set(auth(a.owner)).expect(200)).body;
      expect(later.settings.scoringMatrix).toBe('3x3');
      expect(later.settings.bands.map((x: any) => x.name)).toEqual(['LOW', 'MEDIUM', 'HIGH']);

      const hist = (await request(http).get('/api/v1/governance/settings/history').set(auth(a.viewer)).expect(200)).body;
      expect(hist.versions.map((v: any) => v.version)).toEqual([4, 3, 2, 1]);
      expect(hist.versions[3]).toMatchObject({ changed_by: 'owner@setorga.test', reason: 'Board asked for a stricter HIGH gate' });

      // Unknown top-level keys are rejected rather than silently dropped.
      await put(a.owner, { settings: { gateModes: { HIGH: 'BLOCK' } }, reason: 'Typo in the field name' }).expect(400);

      // An immediate change made while a version is scheduled applies now and is
      // carried into the scheduled version, which does not come into force early.
      const imm = (await put(a.owner, { settings: { gateMode: { MEDIUM: 'WARN' } }, reason: 'Warn on MEDIUM from today' }).expect(200)).body;
      expect(imm.carried_forward).toHaveLength(1);
      const nowAfter = (await request(http).get('/api/v1/governance/settings').set(auth(a.owner)).expect(200)).body;
      expect(nowAfter.settings.scoringMatrix).toBe('5x5');
      expect(nowAfter.settings.gateMode.MEDIUM).toBe('WARN');
      expect(nowAfter.upcoming).toHaveLength(1);
      expect(nowAfter.upcoming[0].versions).toHaveLength(2);
      expect(nowAfter.upcoming[0].changes.map((c: any) => c.field)).toEqual(expect.arrayContaining(['scoringMatrix', 'gateMode.MEDIUM']));
      const laterAfter = (await request(http).get(`/api/v1/governance/settings?as_of=${future}`).set(auth(a.owner)).expect(200)).body;
      expect(laterAfter.settings.scoringMatrix).toBe('3x3');
      expect(laterAfter.settings.gateMode.MEDIUM).toBe('WARN');
      expect(laterAfter.settings.gateMode.HIGH).toBe('BLOCK');

      // The settings window reports which parameters are actually enforced.
      const cat = nowAfter.catalog.parameters;
      expect(cat.find((c: any) => c.name === 'incidentReportHours').enforced).toBe(false);
      expect(cat.find((c: any) => c.name === 'psiAlertThreshold').enforced).toBe(true);

      // BCP drill status uses the organisation's drill interval, not the deployment default.
      await put(a.owner, { settings: { appetite: { parameters: { bcpDrillIntervalDays: 30, bcpDrillReminderDays: 7 } } }, reason: 'Monthly drills for lending models' }).expect(200);
      const drills = (await request(http).get(`/api/v1/monitoring/bcp/${a.modelId}/drills`).set(auth(a.owner)).expect(200)).body;
      expect(drills).toMatchObject({ drill_interval_days: 30, drill_reminder_days: 7 });
      const drillsB = (await request(http).get(`/api/v1/monitoring/bcp/${b.modelId}/drills`).set(auth(b.owner)).expect(200)).body;
      expect(drillsB.drill_interval_days).not.toBe(30);

      // Ledger: the hash-chained audit event carries the reason and the diff.
      await new Promise((r) => setTimeout(r, 50));
      const events = (await request(http).get('/api/v1/audit/events?limit=200').set(auth(a.admin)).expect(200)).body;
      const rows = Array.isArray(events) ? events : events.events ?? events.items ?? [];
      const ledger = rows.find((e: any) => JSON.stringify(e).includes('Board asked for a stricter HIGH gate'));
      expect(ledger).toBeDefined();
      expect(JSON.stringify(ledger)).toContain('gateMode.HIGH');
      const chain = (await request(http).get('/api/v1/audit/events/verify').set(auth(a.admin)).expect(200)).body;
      expect(chain.intact).toBe(true);
    });
  });

  it('ACCOUNTABILITY (E1.9): accountable official, board and named owners with history; org-scoped', async () => {
    const a = await govOrg('AccOrgA');
    const b = await govOrg('AccOrgB');
    const { auth } = a;
    await request(http).get(`/api/v1/organizations/${a.orgId}/accountability`).set(auth(a.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const users = (await request(http).get('/api/v1/users').set(auth(a.admin)).expect(200)).body;
      const list = Array.isArray(users) ? users : users.users ?? users.items;
      const ciso = list.find((u: any) => u.email === 'ciso@accorga.test');
      const cisoId = ciso.user_id ?? ciso.id;
      const bCiso = list.find((u: any) => u.email === 'ciso@accorgb.test');
      const path = `/api/v1/organizations/${a.orgId}/accountability`;

      await request(http).get(path).set(auth(b.owner)).expect(404);
      await request(http).patch(path).set(auth(a.viewer)).send({ accountable_official_user_id: cisoId, reason: 'Board resolution 12' }).expect(403);
      await request(http).patch(path).set(auth(a.owner)).send({ accountable_official_user_id: bCiso.user_id ?? bCiso.id, reason: 'Board resolution 12' }).expect(400);
      await request(http).patch(path).set(auth(a.owner)).send({ accountable_official_user_id: cisoId }).expect(400);
      const set = (await request(http).patch(path).set(auth(a.owner)).send({
        accountable_official_user_id: cisoId,
        governance_board: [{ name: 'Asha Rao', title: 'Chair, Risk Committee' }, { user_id: cisoId, name: 'CISO' }],
        reason: 'Board resolution 12',
      }).expect(200)).body;
      expect(set.accountable_official.email).toBe('ciso@accorga.test');
      expect(set.governance_board).toHaveLength(2);
      expect(set.history[0]).toMatchObject({ changed_by: 'owner@accorga.test', reason: 'Board resolution 12' });

      const reg = (await request(http).get(`/api/v1/organizations/${a.orgId}/owner-register`).set(auth(a.viewer)).expect(200)).body;
      expect(reg.models.map((m: any) => m.model_id)).toEqual([a.modelId]);
      expect(reg.unowned).toBe(1);
      await request(http).patch(`/api/v1/inventory/models/${a.modelId}/owner`).set(auth(b.owner)).send({ owner_user_id: cisoId }).expect(404);
      await request(http).patch(`/api/v1/inventory/models/${a.modelId}/owner`).set(auth(a.owner)).send({ owner_user_id: bCiso.user_id ?? bCiso.id }).expect(400);
      const owned = (await request(http).patch(`/api/v1/inventory/models/${a.modelId}/owner`).set(auth(a.owner)).send({ owner_user_id: cisoId, reason: 'Named owner' }).expect(200)).body;
      expect(owned.owner.email).toBe('ciso@accorga.test');
      const reg2 = (await request(http).get(`/api/v1/organizations/${a.orgId}/owner-register`).set(auth(a.owner)).expect(200)).body;
      expect(reg2.unowned).toBe(0);
    });
  });

  it('RISK REGISTER (E1.3): catalogue suggestions, scoring, acceptance by the right approver, triggers, gate', async () => {
    const a = await govOrg('RiskOrgA');
    const b = await govOrg('RiskOrgB');
    const { auth } = a;
    await request(http).get('/api/v1/governance/risks').set(auth(a.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      // Suggestions from the starter catalogue, filtered by use (credit model → fairness, model risk; no vendor risk).
      await request(http).post(`/api/v1/governance/models/${a.modelId}/risks/suggest`).set(auth(a.viewer)).expect(403);
      await request(http).post(`/api/v1/governance/models/${a.modelId}/risks/suggest`).set(auth(b.owner)).expect(404);
      const sug = (await request(http).post(`/api/v1/governance/models/${a.modelId}/risks/suggest`).set(auth(a.owner)).expect(201)).body;
      const cats = sug.risks.map((r: any) => r.category);
      expect(cats).toEqual(expect.arrayContaining(['FAIRNESS', 'MODEL_RISK', 'SECURITY', 'RESILIENCE']));
      expect(cats).not.toContain('THIRD_PARTY');
      expect((await request(http).post(`/api/v1/governance/models/${a.modelId}/risks/suggest`).set(auth(a.owner)).expect(201)).body.created).toBe(0);

      // Gate: HIGH model with unassessed risks → WARN by default (HIGH warns, CRITICAL blocks).
      let gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.viewer)).expect(200)).body;
      expect(gate).toMatchObject({ tier: 'HIGH', mode: 'WARN', verdict: 'WARN' });
      expect(gate.warn.map((f: any) => f.code)).toEqual(expect.arrayContaining(['risk_register_empty', 'residual_risk_unaccepted', 'impact_assessment_required']));

      // Dismiss all but fairness with a reason; reasons are required.
      const fair = sug.risks.find((r: any) => r.category === 'FAIRNESS');
      await request(http).post(`/api/v1/governance/risks/${fair.risk_id}/dismiss`).set(auth(a.owner)).send({ reason: '' }).expect(400);
      for (const r of sug.risks.filter((x: any) => x.risk_id !== fair.risk_id)) {
        await request(http).post(`/api/v1/governance/risks/${r.risk_id}/dismiss`).set(auth(a.owner)).send({ reason: 'Covered by the group credit risk register' }).expect(200);
      }

      // Assess: ranges on the 5x5 matrix, residual ≤ inherent, rationale required.
      const assess = (body: any, t = a.owner) => request(http).post(`/api/v1/governance/risks/${fair.risk_id}/assess`).set(auth(t)).send(body);
      await assess({ inherent_likelihood: 6, inherent_impact: 4, residual_likelihood: 2, residual_impact: 4, rationale: 'Bias test shows gap' }).expect(400);
      await assess({ inherent_likelihood: 2, inherent_impact: 2, residual_likelihood: 4, residual_impact: 4, rationale: 'Bias test shows gap' }).expect(400);
      await assess({ inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4, rationale: 'x' }).expect(400);
      await assess({ inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4, rationale: 'Bias test shows gap' }, a.viewer).expect(403);
      await request(http).post(`/api/v1/governance/risks/${fair.risk_id}/assess`).set(auth(b.owner))
        .send({ inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4, rationale: 'Bias test shows gap' }).expect(404);
      const assessed = (await assess({
        inherent_likelihood: 5, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4, rationale: 'Bias test shows an approval-rate gap for women; reweighting applied',
        control_ids: ['CTL-FAIR-01'], treatment: 'MITIGATE', action: 'Quarterly fairness re-test', due_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }).expect(200)).body;
      expect(assessed.status).toBe('ASSESSED');
      expect(assessed.assessment.inherent).toMatchObject({ score: 20, band: 'CRITICAL' });
      expect(assessed.assessment.residual).toMatchObject({ score: 12, band: 'HIGH' });
      expect(assessed.within_appetite).toBe(false); // default ceiling 9
      expect(assessed.required_approvers).toEqual(['CISO', 'ACCOUNTABLE_OFFICIAL']);
      expect(assessed.actions).toHaveLength(1);

      // Acceptance: owner and viewer refused for a HIGH residual; the CISO qualifies.
      const accept = (t: string) => request(http).post(`/api/v1/governance/risks/${fair.risk_id}/accept`).set(auth(t)).send({ note: 'Accepted pending re-test', waiver_ref: 'WVR-7' });
      expect((await accept(a.owner).expect(403)).body.message).toMatch(/CISO or the accountable official/);
      await accept(b.ciso).expect(404);
      const acc = (await accept(a.ciso).expect(200)).body;
      expect(acc).toMatchObject({ status: 'ACCEPTED', acceptance: { role: 'CISO', waiver_ref: 'WVR-7' } });

      // Ledger entry for the acceptance.
      await new Promise((r) => setTimeout(r, 50));
      const events = (await request(http).get('/api/v1/audit/events?limit=200').set(auth(a.admin)).expect(200)).body;
      const rows = Array.isArray(events) ? events : events.events ?? events.items ?? [];
      expect(rows.some((e: any) => JSON.stringify(e).includes('risk_acceptance') && JSON.stringify(e).includes('WVR-7'))).toBe(true);

      // Heatmap places the risk.
      const heat = (await request(http).get(`/api/v1/governance/risks/heatmap?model_id=${a.modelId}`).set(auth(a.viewer)).expect(200)).body;
      expect(heat.residual[2][3]).toBe(1);
      expect(heat.inherent[4][3]).toBe(1);

      // Trigger: an incident moves the accepted risk to REVIEW_DUE.
      await request(http).post('/api/v1/compliance/incident/report').set(auth(a.owner)).send({
        model_id: a.modelId, model_name: 'RiskOrgA Credit', re_name: 'RiskOrgA', functional_area: 'credit_underwriting',
        incident_category: 'BIAS_DISCRIMINATION', severity: 'P3_MEDIUM', description: 'Complaint pattern suggests unequal declines for one segment of applicants',
        observed_at: new Date().toISOString(), detected_at: new Date().toISOString(), model_risk_level: 'HIGH', immediate_action_taken: 'Manual review of declines',
      }).expect(201);
      const after = (await request(http).get(`/api/v1/governance/risks/${fair.risk_id}`).set(auth(a.owner)).expect(200)).body;
      expect(after.status).toBe('REVIEW_DUE');
      expect(after.review_reason).toMatch(/incident/);
      await accept(a.ciso).expect(400);

      // Re-assess within appetite → gate risk findings clear; review date job is idempotent.
      await assess({ inherent_likelihood: 5, inherent_impact: 4, residual_likelihood: 2, residual_impact: 4, rationale: 'Re-test after incident: gap closed below tolerance' }).expect(200);
      gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).toEqual(['impact_assessment_required']);

      // Settings: blocking HIGH turns the warning into a lifecycle block.
      await request(http).put('/api/v1/governance/settings').set(auth(a.ciso)).send({ settings: { gateMode: { HIGH: 'BLOCK' } }, reason: 'Block HIGH models without a signed assessment' }).expect(200);
      const promote = await request(http).patch(`/api/v1/inventory/models/${a.modelId}/lifecycle`).set(auth(a.owner)).send({ stage: 'DEPLOYED', actor: 'owner' }).expect(422);
      expect(JSON.stringify(promote.body)).toContain('impact_assessment_required');

      // Transparency card shows residual risks.
      const card = (await request(http).get(`/api/v1/cards/${a.modelId}`).expect(200)).body;
      expect(card.residual_risks.map((r: any) => r.title)).toEqual([fair.title]);

      // Register-backed advisory checks appear (never mandatory).
      const cc = (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
      expect(cc.nist_rmf.checks.find((c: any) => c.control_code === 'MANAGE-1.3')).toMatchObject({ passed: true, mandatory: false });
      expect(cc.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-6.1.3')).toMatchObject({ passed: true, mandatory: false });
    });
  });

  it('RISK REVIEW FIXES (E1.3): close needs the approver, no self-acceptance, owners in org, public titles, third-party audit, lapsed acceptances', async () => {
    const a = await govOrg('RfxOrgA');
    const b = await govOrg('RfxOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const R = '/api/v1/governance/risks';
      const users = (await request(http).get('/api/v1/users').set(auth(a.admin)).expect(200)).body;
      const list = Array.isArray(users) ? users : users.users ?? users.items;
      const idOf = (email: string) => { const u = list.find((x: any) => x.email === email); return u.user_id ?? u.id; };

      // L1: owners must belong to the org.
      await request(http).post(R).set(auth(a.owner)).send({ scope_type: 'MODEL', scope_id: a.modelId, category: 'PRIVACY', title: 'Foreign owner', owner_user_id: idOf('owner@rfxorgb.test') }).expect(400);
      const manual = (await request(http).post(R).set(auth(a.owner)).send({
        scope_type: 'MODEL', scope_id: a.modelId, category: 'PRIVACY', title: 'Vendor X leaked the Q3 applicant file', owner_user_id: idOf('ciso@rfxorga.test'),
      }).expect(201)).body;
      expect(manual.owner_user_id).toBe(idOf('ciso@rfxorga.test'));

      // M5: the CISO rates a HIGH residual and cannot also accept it.
      const assess = (t: string, l: number) => request(http).post(`${R}/${manual.risk_id}/assess`).set(auth(t))
        .send({ inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: l, residual_impact: 4, rationale: 'Vendor controls only partly remediated' });
      await assess(a.ciso, 3).expect(200);
      expect((await request(http).post(`${R}/${manual.risk_id}/accept`).set(auth(a.ciso)).send({}).expect(403)).body.message).toMatch(/different approver/);

      // H2: the Owner cannot close an above-appetite, unaccepted HIGH risk; the CISO (band approver) can, with a reason.
      await request(http).patch(`${R}/${manual.risk_id}`).set(auth(a.owner)).send({ status: 'CLOSED', reason: 'Vendor offboarded' }).expect(403);
      let gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).toContain('residual_risk_unaccepted');
      await request(http).patch(`${R}/${manual.risk_id}`).set(auth(a.ciso)).send({ status: 'CLOSED' }).expect(400);
      const closed = (await request(http).patch(`${R}/${manual.risk_id}`).set(auth(a.ciso)).send({ status: 'CLOSED', reason: 'Vendor offboarded and data deleted' }).expect(200)).body;
      expect(closed.status).toBe('CLOSED');
      await new Promise((r) => setTimeout(r, 50));
      const events = (await request(http).get('/api/v1/audit/events?limit=200').set(auth(a.admin)).expect(200)).body;
      const rows = Array.isArray(events) ? events : events.events ?? events.items ?? [];
      expect(rows.some((e: any) => JSON.stringify(e).includes('risk_closed') && JSON.stringify(e).includes('Vendor offboarded and data deleted'))).toBe(true);

      // M3: a non-catalogue risk shows on the public card by category only.
      const second = (await request(http).post(R).set(auth(a.owner)).send({ scope_type: 'MODEL', scope_id: a.modelId, category: 'PRIVACY', title: 'Internal: CFO spreadsheet shared with vendor' }).expect(201)).body;
      await request(http).post(`${R}/${second.risk_id}/assess`).set(auth(a.owner))
        .send({ inherent_likelihood: 2, inherent_impact: 2, residual_likelihood: 1, residual_impact: 2, rationale: 'Access revoked, low residual' }).expect(200);
      const card = (await request(http).get(`/api/v1/cards/${a.modelId}`).expect(200)).body;
      expect(card.residual_risks.map((r: any) => r.title)).toEqual(['Privacy risk']);
      expect(JSON.stringify(card)).not.toContain('CFO');

      // L1: action owners and due dates are validated on update too.
      const act = (await request(http).post(`${R}/${second.risk_id}/actions`).set(auth(a.owner)).send({ treatment: 'MITIGATE', action: 'Rotate shared links' }).expect(201)).body;
      await request(http).patch(`${R}/${second.risk_id}/actions/${act.action_id}`).set(auth(a.owner)).send({ due_at: 'not-a-date' }).expect(400);
      await request(http).patch(`${R}/${second.risk_id}/actions/${act.action_id}`).set(auth(a.owner)).send({ owner_user_id: idOf('viewer@rfxorgb.test') }).expect(400);

      // L2: an accepted risk whose acceptance lapses moves to REVIEW_DUE in the daily job.
      const third = (await request(http).post(R).set(auth(a.owner)).send({ scope_type: 'MODEL', scope_id: a.modelId, category: 'SECURITY', title: 'Prompt injection via notes field' }).expect(201)).body;
      await request(http).post(`${R}/${third.risk_id}/assess`).set(auth(a.owner))
        .send({ inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4, rationale: 'Input filter in place, residual above ceiling' }).expect(200);
      await request(http).post(`${R}/${third.risk_id}/accept`).set(auth(a.ciso)).send({ expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(200);
      await app.get(RisksService).reviewDates(new Date(Date.now() + 3 * 86_400_000));
      const lapsed = (await request(http).get(`${R}/${third.risk_id}`).set(auth(a.owner)).expect(200)).body;
      expect(lapsed).toMatchObject({ status: 'REVIEW_DUE', review_reason: 'risk acceptance expired' });

      // M1: with RBI enabled, a HIGH model needs a third-party audit on record.
      gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).not.toContain('third_party_audit_required');
      await request(http).put('/api/v1/governance/settings').set(auth(a.ciso)).send({ settings: { enabledPacks: ['rbi-free-ai'] }, reason: 'Indian lending book in scope' }).expect(200);
      gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).toContain('third_party_audit_required');
      await request(http).post(`/api/v1/audit/models/${a.modelId}/initiate`).set(auth(a.ciso)).send({ auditor_ref: 'Big4 LLP', audit_type: 'THIRD_PARTY' }).expect(201);
      gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).not.toContain('third_party_audit_required');
      expect((await request(http).get(`/api/v1/governance/models/${b.modelId}/gate`).set(auth(b.owner)).expect(200)).body.warn.map((f: any) => f.code)).not.toContain('third_party_audit_required');
    });
  });

  it('IMPACT + CONTEXT (E1.4, E1.5): context profile, draft → final (signed, immutable) → revalidation; reports; gate clears', async () => {
    const a = await govOrg('IaOrgA');
    const b = await govOrg('IaOrgB');
    const { auth } = a;
    await request(http).get('/api/v1/governance/impact-assessments').set(auth(a.owner)).expect(404);
    await request(http).get(`/api/v1/inventory/models/${a.modelId}/context`).set(auth(a.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      // Context profile.
      const ctxPath = `/api/v1/inventory/models/${a.modelId}/context`;
      const before = (await request(http).get(ctxPath).set(auth(a.viewer)).expect(200)).body;
      expect(before.missing).toEqual(expect.arrayContaining(['intendedUsers', 'knownLimitations']));
      expect(before.suggestion.source).toBe('derived');
      await request(http).patch(ctxPath).set(auth(a.viewer)).send({ intended_users: ['Underwriters'] }).expect(403);
      await request(http).patch(ctxPath).set(auth(b.owner)).send({ intended_users: ['Underwriters'] }).expect(404);
      await request(http).patch(ctxPath).set(auth(a.owner)).send({ oversight_pattern: 'SOMETIMES' }).expect(400);
      const ctx = (await request(http).patch(ctxPath).set(auth(a.owner)).send({
        intended_users: ['SME underwriters'], known_limitations: ['Not validated for loans above 5 crore'],
        out_of_scope_uses: ['Retail mortgages'], oversight_pattern: 'HUMAN_IN_THE_LOOP', cost_of_errors: 'Wrongful decline delays SME funding',
        system_requirements: ['Decision within 2 seconds'],
      }).expect(200)).body;
      expect(ctx.missing).toEqual([]);
      const card = (await request(http).get(`/api/v1/cards/${a.modelId}`).expect(200)).body;
      expect(card.known_limitations).toEqual(['Not validated for loans above 5 crore']);
      const cc = (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
      expect(cc.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-A.6.2.2')).toMatchObject({ passed: true, mandatory: false });
      expect(cc.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-8.4')).toMatchObject({ passed: false, mandatory: false });
      expect(cc.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-8.4').not_assessed).toBeUndefined();

      // Draft with partial answers; finalise refuses until complete; viewer cannot create.
      const ia = '/api/v1/governance/impact-assessments';
      await request(http).post(ia).set(auth(a.viewer)).send({ model_id: a.modelId }).expect(403);
      await request(http).post(ia).set(auth(b.owner)).send({ model_id: a.modelId }).expect(404);
      const draft = (await request(http).post(ia).set(auth(a.owner)).send({ model_id: a.modelId, questionnaires: ['us-sr26-2'], answers: { 'iso-42001': { purpose: 'SME credit scoring' } } }).expect(201)).body;
      expect(draft).toMatchObject({ status: 'DRAFT', version: 1, questionnaires: ['iso-42001', 'us-sr26-2'] });
      await request(http).post(ia).set(auth(a.owner)).send({ model_id: a.modelId }).expect(409);
      await request(http).post(`${ia}/${draft.assessment_id}/finalise`).set(auth(a.owner)).expect(400);
      const full = {
        'iso-42001': { purpose: 'SME credit scoring', affected_individuals: 'SME applicants', affected_groups: 'Women-led SMEs may be scored lower',
          societal_impacts: 'Access to credit', severity: 'HIGH', reversibility: 'PARTLY_REVERSIBLE', mitigations: 'Human review of declines', residual_acceptable: true },
        'us-sr26-2': { exposure: 'MEDIUM', purpose_criticality: 'HIGH', tier_justification: 'Drives most SME approvals' },
      };
      await request(http).patch(`${ia}/${draft.assessment_id}`).set(auth(a.owner)).send({ answers: { 'iso-42001': { severity: 'EXTREME' } } }).expect(400);
      await request(http).patch(`${ia}/${draft.assessment_id}`).set(auth(a.owner)).send({ answers: full }).expect(200);
      await request(http).post(`${ia}/${draft.assessment_id}/finalise`).set(auth(a.viewer)).expect(403);
      const fin = (await request(http).post(`${ia}/${draft.assessment_id}/finalise`).set(auth(a.ciso)).expect(200)).body;
      expect(fin).toMatchObject({ status: 'FINAL', signed_by: 'ciso@iaorga.test', materiality: 'HIGH' });
      expect(fin.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect((await request(http).get(`${ia}/${draft.assessment_id}`).set(auth(a.viewer)).expect(200)).body.hash_verified).toBe(true);
      expect(fin.context_snapshot.profile.known_limitations).toEqual(['Not validated for loans above 5 crore']);
      // Immutable once signed.
      await request(http).patch(`${ia}/${draft.assessment_id}`).set(auth(a.owner)).send({ answers: full }).expect(409);

      // Reports in several layouts, Markdown too.
      const iso = (await request(http).get(`${ia}/${draft.assessment_id}/report?layout=iso`).set(auth(a.viewer)).expect(200)).body;
      expect(iso.sections.map((s: any) => s.heading)).toEqual(expect.arrayContaining(['Record', 'Context']));
      const md = (await request(http).get(`${ia}/${draft.assessment_id}/report?layout=m-25-21&format=md`).set(auth(a.viewer)).expect(200)).body;
      expect(md.markdown).toContain('Written justification for the assigned materiality tier');
      await request(http).get(`${ia}/${draft.assessment_id}/report?layout=nope`).set(auth(a.viewer)).expect(400);

      // Gate: the FINAL assessment clears impact_assessment_required; ISO 8.4 passes.
      let gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.map((f: any) => f.code)).not.toContain('impact_assessment_required');
      const cc2 = (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
      expect(cc2.iso_42001.checks.find((c: any) => c.control_code === 'AIMS-8.4').passed).toBe(true);

      // A material change (red-team result) requires revalidation; a new version supersedes.
      await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'red_team', ref: 'doc://rt-2', description: 'Q4 red team' });
      const reval = (await request(http).get(`${ia}/${draft.assessment_id}`).set(auth(a.owner)).expect(200)).body;
      expect(reval.status).toBe('REVALIDATION_REQUIRED');
      expect(reval.revalidation_reason).toMatch(/red team finding/);
      gate = (await request(http).get(`/api/v1/governance/models/${a.modelId}/gate`).set(auth(a.owner)).expect(200)).body;
      expect(gate.warn.find((f: any) => f.code === 'impact_assessment_required').message).toMatch(/needs revalidation/);
      const v2 = (await request(http).post(`${ia}/${draft.assessment_id}/new-version`).set(auth(a.owner)).expect(201)).body;
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
      // Separation of duties: the Owner drafted v2 for a HIGH model, so the CISO signs it.
      expect((await request(http).post(`${ia}/${v2.assessment_id}/finalise`).set(auth(a.owner)).expect(403)).body.message).toMatch(/different/);
      await request(http).post(`${ia}/${v2.assessment_id}/finalise`).set(auth(a.ciso)).expect(200);
      const list = (await request(http).get(`${ia}?model_id=${a.modelId}`).set(auth(a.owner)).expect(200)).body;
      expect(list.assessments.map((x: any) => [x.version, x.status]).sort()).toEqual([[1, 'SUPERSEDED'], [2, 'FINAL']]);
      expect((await request(http).get(ia).set(auth(b.owner)).expect(200)).body.assessments).toEqual([]);
    });
  });

  it('DOCUMENTS (E1.8): versions, approval, hash, supersession, review due; evidence points to a controlled document', async () => {
    const a = await govOrg('DocOrgA');
    const b = await govOrg('DocOrgB');
    const { auth } = a;
    const D = '/api/v1/governance/documents';
    await request(http).get(D).set(auth(a.owner)).expect(404);
    // Flag off: a document_id on evidence is ignored and the response is unchanged.
    const off = (await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'dpia', ref: 'doc://dpia', document_id: 'x' })).body;
    expect(off.artifact.document_id).toBeUndefined();
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      await request(http).post(D).set(auth(a.viewer)).send({ doc_type: 'POLICY', title: 'AI policy', uri: 'sharepoint://ai-policy-v1', content: 'v1' }).expect(403);
      await request(http).post(D).set(auth(a.owner)).send({ doc_type: 'POLICY', title: 'AI policy', uri: 'x', hash: 'abc' }).expect(400);
      await request(http).post(D).set(auth(a.owner)).send({ doc_type: 'POLICY', title: 'AI policy', uri: 'x', content: 'v1', hash: '0'.repeat(64) }).expect(400);
      const v1 = (await request(http).post(D).set(auth(a.owner)).send({ doc_type: 'POLICY', title: 'AI policy', uri: 'sharepoint://ai-policy-v1', content: 'Policy text v1' }).expect(201)).body;
      expect(v1).toMatchObject({ version: 1, status: 'DRAFT' });
      expect(v1.hash).toMatch(/^[0-9a-f]{64}$/);
      await request(http).post(`${D}/${v1.document_id}/approve`).set(auth(a.orgAdmin)).send({}).expect(403);
      await request(http).post(`${D}/${v1.document_id}/approve`).set(auth(b.owner)).send({}).expect(404);
      const ap = (await request(http).post(`${D}/${v1.document_id}/approve`).set(auth(a.ciso)).send({}).expect(200)).body;
      expect(ap).toMatchObject({ status: 'APPROVED', approved_by: 'ciso@docorga.test' });
      expect(ap.review_due_at).toBeTruthy();
      const v2 = (await request(http).post(`${D}/${v1.document_id}/new-version`).set(auth(a.owner)).send({ uri: 'sharepoint://ai-policy-v2', content: 'Policy text v2', review_due_at: '2020-01-01' }).expect(201)).body;
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT', supersedes_id: v1.document_id });
      await request(http).post(`${D}/${v1.document_id}/new-version`).set(auth(a.owner)).send({ content: 'v3' }).expect(409);
      // Separation of duties: the Owner wrote v2 of the policy, so another approver signs it off.
      expect((await request(http).post(`${D}/${v2.document_id}/approve`).set(auth(a.owner)).send({}).expect(403)).body.message).toMatch(/different/);
      await request(http).post(`${D}/${v2.document_id}/approve`).set(auth(a.ciso)).send({}).expect(200);
      const hist = (await request(http).get(`${D}/${v2.document_id}`).set(auth(a.viewer)).expect(200)).body;
      expect(hist.versions.map((x: any) => [x.version, x.status])).toEqual([[2, 'APPROVED'], [1, 'SUPERSEDED']]);
      expect(hist.review_overdue).toBe(true);
      const list = (await request(http).get(D).set(auth(a.owner)).expect(200)).body;
      expect(list.documents).toHaveLength(1);
      expect(list.review_overdue).toBe(1);
      expect((await request(http).get(D).set(auth(b.owner)).expect(200)).body.documents).toEqual([]);

      // Evidence points to a controlled document (version + hash); another org's document is refused.
      const ev = (await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'model_card', ref: 'doc://card', document_id: v2.document_id }).expect(201)).body;
      expect(ev.artifact).toMatchObject({ document_id: v2.document_id, document_version: 2, document_hash: v2.hash });
      const bDoc = (await request(http).post(D).set(auth(b.owner)).send({ doc_type: 'EVIDENCE', title: 'B evidence', uri: 'x://b', content: 'b' }).expect(201)).body;
      await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'model_card', ref: 'doc://card', document_id: bDoc.document_id }).expect(400);
      // Evidence may only point to an approved document, not a draft or a superseded version.
      const draftDoc = (await request(http).post(D).set(auth(a.owner)).send({ doc_type: 'EVIDENCE', title: 'Draft evidence', uri: 'x://d', content: 'd' }).expect(201)).body;
      expect((await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'model_card', ref: 'doc://card', document_id: draftDoc.document_id }).expect(400)).body.message).toMatch(/draft/);
      await request(http).post(`/api/v1/inventory/models/${a.modelId}/evidence`).set(auth(a.owner)).send({ type: 'model_card', ref: 'doc://card', document_id: v1.document_id }).expect(400);

      // Daily reminder: one notification per organisation.
      const notify = jest.spyOn(NotifierService.prototype, 'notify').mockResolvedValue(undefined);
      try {
        const { DocumentsService } = await import('../src/governance/documents/documents.service');
        expect(await app.get(DocumentsService).reviewReminders()).toBeGreaterThanOrEqual(1);
        const calls = notify.mock.calls.filter(([e]) => e === 'document_review_due').map(([, d]) => d as any);
        expect(calls.find((c) => c.tenant_id === a.orgId).documents.map((d: any) => d.document_id)).toEqual([v2.document_id]);
      } finally {
        notify.mockRestore();
      }
    });
  });

  it('CORRECTIVE ACTIONS (E1.7): raised from incidents, grievances, controls; closed only with root cause and effectiveness; overdue listed', async () => {
    const a = await govOrg('CaOrgA');
    const b = await govOrg('CaOrgB');
    const { auth } = a;
    const C = '/api/v1/governance/actions';
    await request(http).get(C).set(auth(a.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const inc = (await request(http).post('/api/v1/compliance/incident/report').set(auth(a.owner)).send({
        model_id: a.modelId, model_name: 'CaOrgA Credit', re_name: 'CaOrgA', functional_area: 'credit_underwriting',
        incident_category: 'MODEL_DRIFT', severity: 'P4_LOW', description: 'Approval rate drifted after the October data refresh',
        observed_at: new Date().toISOString(), detected_at: new Date().toISOString(), model_risk_level: 'HIGH', immediate_action_taken: 'Monitoring increased',
      }).expect(201)).body;
      const incidentId = inc.incident_id ?? inc.id;
      await request(http).post(C).set(auth(a.viewer)).send({ source: 'INCIDENT', source_id: incidentId, nonconformity: 'Drift not caught', action: 'Add weekly PSI job' }).expect(403);
      await request(http).post(C).set(auth(b.owner)).send({ source: 'INCIDENT', source_id: incidentId, nonconformity: 'Drift not caught', action: 'Add weekly PSI job' }).expect(404);
      const fromInc = (await request(http).post(C).set(auth(a.owner)).send({
        source: 'INCIDENT', source_id: incidentId, nonconformity: 'Drift not caught before customers were affected', action: 'Add a weekly PSI job',
        due_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).expect(201)).body;
      expect(fromInc).toMatchObject({ source: 'INCIDENT', model_id: a.modelId, status: 'OPEN', overdue: true });
      await request(http).post(C).set(auth(a.owner)).send({ source: 'CONTROL', nonconformity: 'MEASURE-2.7 failing', action: 'Run red team' }).expect(400);
      const fromCtl = (await request(http).post(C).set(auth(a.owner)).send({ source: 'CONTROL', source_id: 'CTL-SEC-01', model_id: a.modelId, nonconformity: 'Red teaming overdue', action: 'Schedule the Q1 red team' }).expect(201)).body;
      expect(fromCtl.model_id).toBe(a.modelId);

      const list = (await request(http).get(`${C}?overdue=true`).set(auth(a.viewer)).expect(200)).body;
      expect(list.actions.map((x: any) => x.action_id)).toEqual([fromInc.action_id]);
      expect(list.summary).toEqual({ open: 2, overdue: 1 });
      expect((await request(http).get(C).set(auth(b.owner)).expect(200)).body.actions).toEqual([]);

      // Close needs root cause + effectiveness review; an ineffective action stays open.
      await request(http).post(`${C}/${fromInc.action_id}/close`).set(auth(a.owner)).send({ effectiveness_review: 'Checked', effective: true }).expect(400);
      const notYet = (await request(http).post(`${C}/${fromInc.action_id}/close`).set(auth(a.owner)).send({ root_cause: 'No scheduled drift job', effectiveness_review: 'Drift recurred in the next window', effective: false }).expect(200)).body;
      expect(notYet).toMatchObject({ closed: false, status: 'IN_PROGRESS' });
      const closed = (await request(http).post(`${C}/${fromInc.action_id}/close`).set(auth(a.owner)).send({ root_cause: 'No scheduled drift job', effectiveness_review: 'Two clean weekly runs; drift alerts now raised', effective: true }).expect(200)).body;
      expect(closed).toMatchObject({ closed: true, status: 'CLOSED', closed_by: 'owner@caorga.test' });
      await request(http).patch(`${C}/${fromInc.action_id}`).set(auth(a.owner)).send({ action: 'x' }).expect(400);
      // Cancelling needs a substantive reason.
      await request(http).patch(`${C}/${fromInc.action_id}`).set(auth(a.owner)).send({ status: 'CANCELLED', reason: 'dup' }).expect(400);
    });
  });

  it('AIMS (E1.6): records per type, approval, ORG controls for ISO and RBI Rec 14, people-side setting, management review raises actions', async () => {
    const a = await govOrg('AimsOrgA');
    const b = await govOrg('AimsOrgB');
    const { auth } = a;
    const A = '/api/v1/governance/aims';
    await request(http).get(`${A}/summary`).set(auth(a.owner)).expect(404);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      let ctl = (await request(http).get(`${A}/controls`).set(auth(a.viewer)).expect(200)).body;
      const iso = () => ctl.packs.find((p: any) => p.pack_id === 'iso-42001').clauses;
      expect(iso().find((c: any) => c.code === 'AIMS-4.3')).toMatchObject({ passed: false, evidence: 'No approved record' });
      expect(iso().find((c: any) => c.code === 'AIMS-7.2')).toMatchObject({ passed: false, evidence: 'No competence records' });
      expect(iso().find((c: any) => c.code === 'AIMS-7.5')).toMatchObject({ passed: false, evidence: 'No approved controlled documents' });

      // RBAC and validation.
      await request(http).post(`${A}/SCOPE`).set(auth(a.viewer)).send({ content: { boundaries: 'x', ai_systems: 'y' } }).expect(403);
      await request(http).post(`${A}/SCOPE`).set(auth(a.owner)).send({ content: { boundaries: 'Retail lending' } }).expect(400);
      await request(http).post(`${A}/NOPE`).set(auth(a.owner)).send({ content: {} }).expect(404);
      const scope = (await request(http).post(`${A}/SCOPE`).set(auth(a.owner)).send({ title: 'AIMS scope 2027', content: { boundaries: 'Retail and SME lending, India', ai_systems: 'All credit and fraud models' } }).expect(201)).body;
      await request(http).post(`${A}/records/${scope.record_id}/approve`).set(auth(b.owner)).expect(404);
      const ok = (await request(http).post(`${A}/records/${scope.record_id}/approve`).set(auth(a.ciso)).expect(200)).body;
      expect(ok).toMatchObject({ status: 'APPROVED', iso_clauses: ['4.3', '4.4'] });
      expect(ok.review_due_at).toBeTruthy();

      // Audit programme: auditors must be independent (9.2 objectivity).
      await request(http).post(`${A}/AUDIT_PROGRAMME`).set(auth(a.owner)).send({ content: { period: '2027', audits: [{ area: 'Credit models', planned_date: '2027-03-01', auditor: 'Model owner' }] } }).expect(400);
      const ap = (await request(http).post(`${A}/AUDIT_PROGRAMME`).set(auth(a.owner)).send({ content: { period: '2027', audits: [{ area: 'Credit models', planned_date: '2027-03-01', auditor: 'Internal Audit', auditor_independent: true }] } }).expect(201)).body;
      await request(http).post(`${A}/records/${ap.record_id}/approve`).set(auth(a.owner)).expect(200);

      // RBI Rec 14: enable RBI, approve a policy missing Rec 14 sections → Rec 14 fails naming them.
      await request(http).put('/api/v1/governance/settings').set(auth(a.ciso)).send({ settings: { enabledPacks: ['rbi-free-ai'] }, reason: 'Indian lending book in scope' }).expect(200);
      const isoSections = { purpose_alignment: 'Supports lending strategy', objectives_framework: 'See objectives', requirements_commitment: 'Meets RBI and ISO', continual_improvement: 'Annual review' };
      const pol = (await request(http).post(`${A}/POLICY`).set(auth(a.owner)).send({ title: 'AI policy', content: { sections: isoSections } }).expect(201)).body;
      await request(http).post(`${A}/records/${pol.record_id}/approve`).set(auth(a.orgAdmin)).expect(403);
      expect((await request(http).post(`${A}/records/${pol.record_id}/approve`).set(auth(a.owner)).expect(403)).body.message).toMatch(/different/);
      await request(http).post(`${A}/records/${pol.record_id}/approve`).set(auth(a.ciso)).expect(200);
      ctl = (await request(http).get(`${A}/controls`).set(auth(a.owner)).expect(200)).body;
      expect(iso().find((c: any) => c.code === 'AIMS-5.2').passed).toBe(true);
      const rec14 = ctl.packs.find((p: any) => p.pack_id === 'rbi-free-ai').clauses.find((c: any) => c.code === 'REC-14');
      expect(rec14.passed).toBe(false);
      expect(rec14.evidence).toContain('governance_structure');
      expect(iso().find((c: any) => c.code === 'AIMS-4.3').passed).toBe(true);
      expect(iso().find((c: any) => c.code === 'AIMS-9.2').passed).toBe(true);

      // People-side items: competence records allowed by default; switching to customer responsibility blocks them.
      const comp = (await request(http).post(`${A}/COMPETENCE`).set(auth(a.owner)).send({ content: { person_or_role: 'Model validators', evidence: 'FRM certification register' } }).expect(201)).body;
      await request(http).post(`${A}/records/${comp.record_id}/approve`).set(auth(a.owner)).expect(200);
      await request(http).put('/api/v1/governance/settings').set(auth(a.ciso)).send({ settings: { peopleItems: { awareness: { mode: 'CUSTOMER', owner: 'HR Learning', note: 'LMS' } } }, reason: 'Awareness tracked in the HR LMS' }).expect(200);
      await request(http).post(`${A}/AWARENESS`).set(auth(a.owner)).send({ content: { person_or_role: 'All staff', evidence: 'LMS' } }).expect(409);
      ctl = (await request(http).get(`${A}/controls`).set(auth(a.owner)).expect(200)).body;
      expect(iso().find((c: any) => c.code === 'AIMS-7.2').passed).toBe(true);
      expect(iso().find((c: any) => c.code === 'AIMS-7.3')).toMatchObject({ passed: false, not_assessed: true, evidence: 'Customer responsibility (owner: HR Learning)' });

      // Management review: inputs pre-filled from the board pack; approved actions land in the corrective-action register.
      const inputs = (await request(http).get(`${A}/mgmt-review/inputs`).set(auth(a.owner)).expect(200)).body;
      expect(inputs.inputs.compliance.total_models).toBe(1);
      // An org Admin gets this organisation's inputs only, not the whole platform.
      expect((await request(http).get(`${A}/mgmt-review/inputs`).set(auth(a.orgAdmin)).expect(200)).body.inputs.compliance.total_models).toBe(1);
      // A management review is recorded after it happens.
      await request(http).post(`${A}/MGMT_REVIEW`).set(auth(a.owner)).send({
        title: 'Next year review', content: { review_date: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10), attendees: ['CEO'] },
      }).expect(400);
      const mr = (await request(http).post(`${A}/MGMT_REVIEW`).set(auth(a.owner)).send({
        title: 'Q4 management review', content: { review_date: new Date().toISOString().slice(0, 10), attendees: ['CEO', 'CISO'], inputs: inputs.inputs,
          decisions: ['Fund a fairness re-test'], actions: [{ action: 'Commission fairness re-test of the credit model', due_at: new Date(Date.now() + 60 * 86_400_000).toISOString() }] },
      }).expect(201)).body;
      const mra = (await request(http).post(`${A}/records/${mr.record_id}/approve`).set(auth(a.owner)).expect(200)).body;
      expect(mra.corrective_actions_raised).toHaveLength(1);
      const cas = (await request(http).get('/api/v1/governance/actions?source=MGMT_REVIEW').set(auth(a.owner)).expect(200)).body;
      expect(cas.actions[0]).toMatchObject({ source: 'MGMT_REVIEW', source_id: mr.record_id });
      ctl = (await request(http).get(`${A}/controls`).set(auth(a.owner)).expect(200)).body;
      expect(iso().find((c: any) => c.code === 'AIMS-9.3').passed).toBe(true);
      expect(iso().find((c: any) => c.code === 'AIMS-10.2').passed).toBe(true);

      // Org controls never leak into per-model reports; recording writes ORG rows (no model).
      const cc = (await request(http).get(`/api/v1/inventory/models/${a.modelId}/compliance-check`).set(auth(a.owner)).expect(200)).body;
      expect(cc.iso_42001.checks.map((c: any) => c.control_code)).not.toContain('AIMS-4.3');
      const rec = (await request(http).post(`${A}/controls/evaluate`).set(auth(a.owner)).expect(200)).body;
      expect(rec.recorded).toBeGreaterThan(5);

      const sum = (await request(http).get(`${A}/summary`).set(auth(a.viewer)).expect(200)).body;
      expect(sum.types.find((t: any) => t.type === 'SCOPE').approved).toBe(1);
      expect((await request(http).get(`${A}/records`).set(auth(b.owner)).expect(200)).body.records).toEqual([]);
    });
  });

  /* ------------------------------------------------------------ Phase 2 */

  const userIds = async (admin: string, orgId: string) => {
    const all = (await request(http).get('/api/v1/users').set({ Authorization: `Bearer ${admin}` }).expect(200)).body as any[];
    return Object.fromEntries(all.filter((u) => u.organization_id === orgId).map((u) => [u.role, u.user_id])) as Record<string, string>;
  };

  it('PHASE 2 FLAGS: every Phase 2 route is a 404 while GOVERNANCE_V2 is off, and the features list says so', async () => {
    const a = await govOrg('P2Off');
    const { auth } = a;
    const routes = [
      '/api/v1/governance/au/register', `/api/v1/governance/models/${a.modelId}/reason-codes`, '/api/v1/governance/appeals',
      '/api/v1/governance/validations', `/api/v1/governance/fair-lending/${a.modelId}`, '/api/v1/governance/vendors',
      `/api/v1/governance/models/${a.modelId}/bom`, '/api/v1/governance/training/matrix', '/api/v1/governance/datasets', '/api/v1/governance/assurance',
    ];
    for (const r of routes) await request(http).get(r).set(auth(a.owner)).expect(404);
    await request(http).post(`/api/v1/governance/public/decisions/${a.modelId}/requests`).send({ decision_ref: 'x', description: 'please reconsider my case' }).expect(404);
    const f = (await request(http).get('/api/v1/governance/features').set(auth(a.viewer)).expect(200)).body;
    for (const k of ['auPack', 'usKit', 'modelValidation', 'fairLending', 'vendors', 'training', 'dataRegister', 'redTeamAuditRules']) expect(f[k]).toBe(false);
    // Under the master flag, a single epic can still be switched off.
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E2_5_VENDORS: 'false' }, async () => {
      await request(http).get('/api/v1/governance/vendors').set(auth(a.owner)).expect(404);
      await request(http).get('/api/v1/governance/datasets').set(auth(a.owner)).expect(200);
    });
  });

  it('E2.1 AUSTRALIA: opt-in pack, register export with formula-safe CSV and XLSX, share record by officers, accountable-official report, tenant isolation', async () => {
    const a = await govOrg('AuOrgA');
    const b = await govOrg('AuOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      // Not in force until the organisation opts in.
      const catalogue = (await request(http).get('/api/v1/governance/packs').set(auth(a.owner)).expect(200)).body;
      expect(catalogue.packs.find((p: any) => p.pack_id === 'au-dta')).toMatchObject({ opt_in: true, status: 'ACTIVE' });
      const inForce = async (t: string) => Object.keys((await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(t)).expect(200)).body.pack_versions);
      expect(await inForce(a.owner)).not.toContain('au-dta');
      const reg = (await request(http).get('/api/v1/governance/au/register').set(auth(a.viewer)).expect(200)).body;
      expect(reg.rows.map((r: any) => r.name)).toEqual(['AuOrgA Credit']);
      const csv = await request(http).get('/api/v1/governance/exports/dta-register?format=csv').set(auth(a.viewer)).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.split('\r\n')[0]).toContain('Use case name');
      const xlsx = await request(http).get('/api/v1/governance/exports/dta-register?format=xlsx').set(auth(a.viewer)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      // Only officers record a share; the share is audited and the next due date moves.
      await request(http).post('/api/v1/governance/exports/dta-register/share').set(auth(a.viewer)).send({ reference: 'DTA-2026-1' }).expect(403);
      const share = (await request(http).post('/api/v1/governance/exports/dta-register/share').set(auth(a.ciso)).send({ reference: 'DTA-2026-1' }).expect(201)).body;
      expect(share.use_cases).toBe(1);
      expect(share.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      expect((await request(http).get('/api/v1/governance/au/submissions').set(auth(a.viewer)).expect(200)).body.submissions).toHaveLength(1);
      expect((await request(http).get('/api/v1/governance/au/submissions').set(auth(b.owner)).expect(200)).body.submissions).toHaveLength(0);
      // The high-risk report goes through the accountable official only.
      await request(http).post(`/api/v1/governance/models/${a.modelId}/dta-report`).set(auth(a.owner)).send({ reasons: 'High risk credit decisions for the public' }).expect(400);
      // Bulk in-scope start creates draft assessments for unassessed use cases.
      const tracker = (await request(http).get('/api/v1/governance/au/in-scope').set(auth(a.owner)).expect(200)).body;
      expect(tracker.deadline).toBe('2027-04-30');
      expect(tracker.summary.outstanding).toBe(1);
      await request(http).post('/api/v1/governance/au/in-scope/bulk-start').set(auth(a.viewer)).send({}).expect(403);
      const bulk = (await request(http).post('/api/v1/governance/au/in-scope/bulk-start').set(auth(a.owner)).send({}).expect(200)).body;
      expect(bulk.started).toBe(1);
      // Tenant isolation: another org's model is a 404.
      await request(http).post(`/api/v1/governance/models/${a.modelId}/dta-report`).set(auth(b.owner)).send({ reasons: 'x'.repeat(20) }).expect(404);
      // Opting in brings the pack into force for this organisation only.
      await request(http).put('/api/v1/governance/settings').set(auth(a.owner)).send({ settings: { enabledPacks: ['au-dta'] }, reason: 'Australian operations in scope' }).expect(200);
      expect(await inForce(a.owner)).toContain('au-dta');
      const ctl = (await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(a.owner)).expect(200)).body;
      // Until the in-scope test is signed only the scoping clauses apply.
      const au = ctl.packs.find((p: any) => p.pack_id === 'au-dta');
      expect(au.tier).toBe('Not assessed');
      expect(au.clauses.map((c: any) => c.control_id)).toEqual(['CTL-AU-INSCOPE', 'CTL-AU-USAGE']);
      expect(au.clauses.every((c: any) => !c.passed)).toBe(true);
    });
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E2_1_AU_PACK: 'false' }, async () => {
      const off = (await request(http).get('/api/v1/governance/packs').set(auth(a.owner)).expect(200)).body;
      expect(off.packs.map((p: any) => p.pack_id)).not.toContain('au-dta');
      expect(Object.keys((await request(http).get(`/api/v1/governance/models/${a.modelId}/controls`).set(auth(a.owner)).expect(200)).body.pack_versions)).not.toContain('au-dta');
    });
  });

  it('E2.2 US DECISIONS: reason codes, consistent notices from explanations, appeal by a different reviewer, public request needs a known decision', async () => {
    const a = await govOrg('UsOrgA');
    const b = await govOrg('UsOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const R = `/api/v1/governance/models/${a.modelId}/reason-codes`;
      await request(http).put(R).set(auth(a.viewer)).send({ map: {} }).expect(403);
      await request(http).put(R).set(auth(a.owner)).send({ map: { dti: { code: 'bad code', text: 'x' } } }).expect(400);
      await request(http).put(R).set(auth(a.owner)).send({ map: { dti: { code: 'R01', text: 'Debt is high compared with income' }, late: { code: 'R02', text: 'Recent late payments' } } }).expect(200);
      expect((await request(http).get(R).set(auth(b.owner))).status).toBe(404);
      const ref = `DEC-${Date.now()}`;
      await request(http).post('/api/v1/audit/explainability/record').set(auth(a.admin)).send({
        decision_ref: ref, top_features: { dti: 0.6, late: -0.3 }, decision_outcome: 'DECLINED', confidence_score: 0.8, explanation_method: 'SHAP', human_readable_summary: 'Declined', is_contestable: true,
      }).expect(201);
      // A public request needs a decision tied to this system.
      await request(http).post(`/api/v1/governance/public/decisions/${a.modelId}/requests`).send({ decision_ref: ref, description: 'Please reconsider my application' }).expect(404);
      const notice = (await request(http).post(`/api/v1/governance/decisions/${ref}/notices`).set(auth(a.owner)).send({ model_id: a.modelId }).expect(201)).body;
      expect(notice.consistent).toBe(true);
      expect(notice.reason_codes.map((r: any) => r.code)).toEqual(['R01', 'R02']);
      const bad = (await request(http).post(`/api/v1/governance/decisions/${ref}/notices`).set(auth(a.owner)).send({ model_id: a.modelId, reason_codes: ['R02'] }).expect(201)).body;
      expect(bad.consistent).toBe(false);
      // Another org cannot issue a notice on this model.
      await request(http).post(`/api/v1/governance/decisions/${ref}/notices`).set(auth(b.owner)).send({ model_id: a.modelId }).expect(404);
      const pub = (await request(http).post(`/api/v1/governance/public/decisions/${a.modelId}/requests`).send({ decision_ref: ref, description: 'Please reconsider my application', complainant: 'applicant@example.test' }).expect(201)).body;
      expect(pub.reference ?? pub.request_id ?? pub.appeal_id).toBeTruthy();
      const appeals = (await request(http).get('/api/v1/governance/appeals').set(auth(a.ciso)).expect(200)).body.appeals;
      expect(appeals).toHaveLength(1);
      expect((await request(http).get('/api/v1/governance/appeals').set(auth(b.owner)).expect(200)).body.appeals).toHaveLength(0);
      const id = appeals[0].appeal_id;
      const decision = { outcome: 'UPHELD', authority: 'Credit committee delegate', evidence: 'Notice, explanation record and file review', outcome_notes: 'Reasons confirmed; decision stands' };
      // The person who issued the notice cannot decide the appeal.
      await request(http).post(`/api/v1/governance/appeals/${id}/decide`).set(auth(a.owner)).send(decision).expect(403);
      const decided = (await request(http).post(`/api/v1/governance/appeals/${id}/decide`).set(auth(a.ciso)).send(decision).expect(200)).body;
      expect(decided).toMatchObject({ status: 'DECIDED', outcome: 'UPHELD' });
      expect(decided.reviewer_user_id).toBeTruthy();
      expect(decided.retention_until).toBeTruthy();
    });
  });

  it('E2.3 VALIDATION: in-scope gate finding, independent validator only, validator-only analysis and completion, officer-only exception', async () => {
    const a = await govOrg('ValOrgA');
    const b = await govOrg('ValOrgB');
    const { auth } = a;
    const ids = await userIds(a.admin, a.orgId);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      await request(http).put(`/api/v1/governance/models/${a.modelId}/mrm-scope`).set(auth(a.owner)).send({ in_scope: false }).expect(400);
      await request(http).put(`/api/v1/governance/models/${a.modelId}/mrm-scope`).set(auth(a.owner)).send({ in_scope: true }).expect(200);
      await request(http).post('/api/v1/governance/validations').set(auth(a.owner)).send({ model_id: a.modelId, validator_user_id: (await userIds(b.admin, b.orgId)).CISO }).expect(400);
      const v = (await request(http).post('/api/v1/governance/validations').set(auth(a.owner)).send({ model_id: a.modelId, validator_user_id: ids.CISO, scope: 'Full validation' }).expect(201)).body;
      expect(v.independent).toBe(true);
      const V = `/api/v1/governance/validations/${v.validation_id}`;
      const analysis = { conceptual_soundness: 'Logistic scorecard suits the portfolio', implementation_review: 'Code matches the documented specification', outcomes_analysis: 'Back-testing within tolerance over two years' };
      await request(http).patch(V).set(auth(a.owner)).send(analysis).expect(403);
      await request(http).patch(V).set(auth(a.ciso)).send(analysis).expect(200);
      await request(http).post(`${V}/complete`).set(auth(a.owner)).send({ result: 'APPROVED' }).expect(403);
      const done = (await request(http).post(`${V}/complete`).set(auth(a.ciso)).send({ result: 'APPROVED' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'COMPLETED', result: 'APPROVED' });
      expect(done.expires_at).toBeTruthy();
      await request(http).post(`${V}/exception`).set(auth(a.viewer)).send({}).expect(403);
      await request(http).get(V).set(auth(b.owner)).expect(404);
      const agg = (await request(http).get('/api/v1/governance/validations/aggregate').set(auth(a.viewer)).expect(200)).body;
      expect(agg.totals ?? agg.projects).toBeTruthy();
    });
  });

  it('E2.4 FAIR LENDING: proxy scan as evidence, justification, disparate impact and alternatives search, tenant isolation', async () => {
    const a = await govOrg('FlOrgA');
    const b = await govOrg('FlOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const F = `/api/v1/governance/fair-lending/${a.modelId}`;
      await request(http).post(`${F}/scan`).set(auth(a.viewer)).send({ features: ['zip'] }).expect(403);
      await request(http).post(`${F}/scan`).set(auth(b.owner)).send({ features: ['zip'] }).expect(404);
      const scan = (await request(http).post(`${F}/scan`).set(auth(a.owner)).send({ features: ['applicant_zip_code', 'income', 'snapshot_date'] }).expect(200)).body;
      expect(scan.hits.map((h: any) => h.feature)).toEqual(['applicant_zip_code']);
      expect(scan.unjustified).toBe(1);
      await request(http).post(`${F}/justify`).set(auth(a.owner)).send({ feature: 'income', justification: 'not flagged so nothing to justify here' }).expect(400);
      const j = (await request(http).post(`${F}/justify`).set(auth(a.owner)).send({ feature: 'applicant_zip_code', justification: 'Used only for fraud geolocation, not in the credit score' }).expect(200)).body;
      expect(j.unjustified).toBe(0);
      await request(http).post(`${F}/disparate-impact`).set(auth(a.owner)).send({ ratio: 0.86 }).expect(201);
      await request(http).post(`${F}/lda-search`).set(auth(a.owner)).send({ alternatives: [{ description: 'Drop bureau age' }], conclusion: 'No alternative with equal accuracy and lower disparity' }).expect(201);
      const st = (await request(http).get(F).set(auth(a.viewer)).expect(200)).body;
      expect(st).toMatchObject({ applicable: true, ldaSearch: true });
      expect(st.disparateImpact.ratio).toBe(0.86);
    });
  });

  it('E2.5 VENDORS: register, scored assessment, BOM from discovery, a version change triggers risk review, tenant isolation', async () => {
    const a = await govOrg('VenOrgA');
    const b = await govOrg('VenOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      await request(http).post('/api/v1/governance/vendors').set(auth(a.viewer)).send({ name: 'Acme' }).expect(403);
      const v = (await request(http).post('/api/v1/governance/vendors').set(auth(a.owner)).send({ name: 'Acme AI', criticality: 'HIGH' }).expect(201)).body;
      expect(v.contract_gaps.length).toBe(6);
      await request(http).post('/api/v1/governance/vendors').set(auth(a.owner)).send({ name: 'Acme AI' }).expect(400);
      await request(http).get(`/api/v1/governance/vendors/${v.vendor_id}`).set(auth(b.owner)).expect(404);
      const checklist = (await request(http).get('/api/v1/governance/vendors/checklist').set(auth(a.viewer)).expect(200)).body.checklist;
      const answers = Object.fromEntries(checklist.map((c: any) => [c.id, 'YES']));
      await request(http).post(`/api/v1/governance/vendors/${v.vendor_id}/assessments`).set(auth(a.owner)).send({ answers: { audit_rights: 'YES' } }).expect(400);
      const as1 = (await request(http).post(`/api/v1/governance/vendors/${v.vendor_id}/assessments`).set(auth(a.owner)).send({ answers: { ...answers, audit_rights: 'NO' } }).expect(201)).body;
      expect(as1).toMatchObject({ version: 1, result: 'UNSATISFACTORY' });
      const as2 = (await request(http).post(`/api/v1/governance/vendors/${v.vendor_id}/assessments`).set(auth(a.owner)).send({ answers }).expect(201)).body;
      expect(as2).toMatchObject({ version: 2, result: 'SATISFACTORY', score: 100 });
      // Lowering criticality is for officers.
      await request(http).patch(`/api/v1/governance/vendors/${v.vendor_id}`).set(auth(a.owner)).send({ criticality: 'LOW' }).expect(200);
      const B = `/api/v1/governance/models/${a.modelId}/bom`;
      const item = (await request(http).post(B).set(auth(a.owner)).send({ component: 'xgboost', kind: 'LIBRARY', version: '1.7.0', licence: 'Apache-2.0', vendor_id: v.vendor_id }).expect(201)).body;
      expect(item.licence_class).toBe('PERMISSIVE');
      await request(http).post(B).set(auth(b.owner)).send({ component: 'x' }).expect(404);
      await request(http).post(`/api/v1/governance/models/${b.modelId}/bom`).set(auth(b.owner)).send({ component: 'x', vendor_id: v.vendor_id }).expect(400);
      const changed = (await request(http).patch(`/api/v1/governance/bom/${item.item_id}`).set(auth(a.owner)).send({ version: '2.0.0' }).expect(200)).body;
      expect(changed).toMatchObject({ previous_version: '1.7.0', version: '2.0.0', review_triggered: true });
      await request(http).patch(`/api/v1/governance/bom/${item.item_id}`).set(auth(b.owner)).send({ version: '3' }).expect(404);
      const bom = (await request(http).get(B).set(auth(a.viewer)).expect(200)).body;
      expect(bom.components).toHaveLength(1);
      expect(bom.facts).toMatchObject({ components: 1, unsatisfactory: 0 });
      const list = (await request(http).get('/api/v1/governance/vendors').set(auth(a.viewer)).expect(200)).body.vendors;
      expect(list[0].models.map((m: any) => m.model_id)).toEqual([a.modelId]);
      expect((await request(http).get('/api/v1/governance/vendors').set(auth(b.owner)).expect(200)).body.vendors).toEqual([]);
    });
  });

  it('E2.6 TRAINING: officers set courses, maintainers record completions, people acknowledge policies, matrix and user status', async () => {
    const a = await govOrg('TrOrgA');
    const b = await govOrg('TrOrgB');
    const { auth } = a;
    const ids = await userIds(a.admin, a.orgId);
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const T = '/api/v1/governance/training';
      await request(http).post(`${T}/courses`).set(auth(a.viewer)).send({ title: 'AI literacy' }).expect(403);
      const course = (await request(http).post(`${T}/courses`).set(auth(a.owner)).send({ title: 'AI literacy', topic: 'ai_literacy', validity_months: 12 }).expect(201)).body;
      const policy = (await request(http).post(`${T}/courses`).set(auth(a.owner)).send({ title: 'AI policy acknowledgement', kind: 'POLICY_ACK', topic: 'policy_ack' }).expect(201)).body;
      await request(http).post(`${T}/records`).set(auth(a.owner)).send({ course_id: course.course_id, user_id: (await userIds(b.admin, b.orgId)).OWNER }).expect(400);
      await request(http).post(`${T}/records`).set(auth(a.owner)).send({ course_id: course.course_id, user_id: ids.VIEWER, completed_at: '2099-01-01' }).expect(400);
      const r = (await request(http).post(`${T}/records`).set(auth(a.owner)).send({ course_id: course.course_id, user_id: ids.VIEWER, evidence_ref: 'LMS-1' }).expect(201)).body;
      expect(r.expires_at).toBeTruthy();
      // A course needs a recorded completion; a policy can be self-acknowledged.
      await request(http).post(`${T}/courses/${course.course_id}/acknowledge`).set(auth(a.viewer)).expect(403);
      await request(http).post(`${T}/courses/${policy.course_id}/acknowledge`).set(auth(a.viewer)).expect(200);
      await request(http).post(`${T}/courses/${policy.course_id}/acknowledge`).set(auth(b.viewer)).expect(404);
      const m = (await request(http).get(`${T}/matrix`).set(auth(a.owner)).expect(200)).body;
      const viewerRow = m.rows.find((x: any) => x.user_id === ids.VIEWER);
      expect(viewerRow.compliant).toBe(true);
      expect(m.facts.topics.policy_ack.completed).toBe(1);
      // A viewer sees only their own row.
      expect((await request(http).get(`${T}/matrix`).set(auth(a.viewer)).expect(200)).body.rows).toHaveLength(1);
      const status = (await request(http).get(`${T}/user-status`).set(auth(a.owner)).expect(200)).body.users;
      expect(status[ids.VIEWER].compliant).toBe(true);
      expect(status[ids.OWNER].compliant).toBe(false);
      expect((await request(http).get(`${T}/courses`).set(auth(b.owner)).expect(200)).body.courses).toEqual([]);
    });
  });

  it('E2.7 DATA REGISTER: datasets with lawful basis, model links, deletion order traced to models and closed with evidence', async () => {
    const a = await govOrg('DsOrgA');
    const b = await govOrg('DsOrgB');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const D = '/api/v1/governance/datasets';
      await request(http).post(D).set(auth(a.viewer)).send({ name: 'Bureau 2025' }).expect(403);
      await request(http).post(D).set(auth(a.owner)).send({ name: 'Bad', personal_data: true, lawful_basis: 'NOT_PERSONAL' }).expect(400);
      const ds = (await request(http).post(D).set(auth(a.owner)).send({ name: 'Bureau 2025', source: 'Credit bureau', personal_data: true, lawful_basis: 'CONTRACT', provenance: 'Monthly bureau extract', retention_until: '2030-01-01' }).expect(201)).body;
      expect(ds.gaps).toEqual(['quality checks']);
      await request(http).post(`/api/v1/governance/models/${a.modelId}/datasets`).set(auth(b.owner)).send({ dataset_id: ds.dataset_id }).expect(404);
      await request(http).post(`/api/v1/governance/models/${b.modelId}/datasets`).set(auth(b.owner)).send({ dataset_id: ds.dataset_id }).expect(400);
      await request(http).post(`/api/v1/governance/models/${a.modelId}/datasets`).set(auth(a.owner)).send({ dataset_id: ds.dataset_id, purpose: 'TRAINING' }).expect(201);
      const md = (await request(http).get(`/api/v1/governance/models/${a.modelId}/datasets`).set(auth(a.viewer)).expect(200)).body;
      expect(md.facts).toMatchObject({ linked: 1, missingLawfulBasis: 0, pendingDeletion: 0 });
      await request(http).post(`${D}/${ds.dataset_id}/deletion-orders`).set(auth(a.viewer)).send({ reason: 'Erasure request from a customer' }).expect(403);
      const ordered = (await request(http).post(`${D}/${ds.dataset_id}/deletion-orders`).set(auth(a.ciso)).send({ kind: 'ERASURE_REQUEST', reference: 'DSR-1', reason: 'Erasure request from a customer' }).expect(201)).body;
      expect(ordered.deletion_status).toBe('ORDERED');
      const order = ordered.deletion_orders[0];
      expect(order.models.map((m: any) => m.model_id)).toEqual([a.modelId]);
      await request(http).post(`${D}/${ds.dataset_id}/deletion-orders/${order.id}/complete`).set(auth(a.ciso)).send({ evidence: 'Ticket DEL-9' }).expect(400);
      await request(http).post(`${D}/${ds.dataset_id}/deletion-orders/${order.id}/model-action`).set(auth(a.owner)).send({ model_id: a.modelId, action: 'Retrained without the record on 2026-11-01' }).expect(200);
      const done = (await request(http).post(`${D}/${ds.dataset_id}/deletion-orders/${order.id}/complete`).set(auth(a.ciso)).send({ evidence: 'Ticket DEL-9' }).expect(200)).body;
      expect(done.deletion_status).toBe('DELETED');
      await request(http).get(`${D}/${ds.dataset_id}`).set(auth(b.owner)).expect(404);
      const lineage = (await request(http).get(`${D}/lineage`).set(auth(a.viewer)).expect(200)).body;
      expect(lineage.edges).toEqual([{ from: ds.dataset_id, to: a.modelId, purpose: 'TRAINING' }]);
    });
  });

  it('E2.8 RED TEAM AND AUDIT: CI escalation makes red teaming due (gate finding) until a later exercise; framework review facts', async () => {
    const a = await govOrg('RtOrgA');
    const { auth } = a;
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const S = `/api/v1/governance/models/${a.modelId}/assurance`;
      const before = (await request(http).get(S).set(auth(a.viewer)).expect(200)).body;
      expect(before.red_team.satisfied).toBe(true);
      expect(before.red_team.pre_deploy_rule).toBe(false);
      const ov = (await request(http).get('/api/v1/governance/assurance').set(auth(a.viewer)).expect(200)).body;
      expect(ov.framework_review).toMatchObject({ overdue: true, interval_months: 24 });
      await request(http).post(`/api/v1/governance/models/${a.modelId}/red-team`).set(auth(a.viewer)).send({ summary: 'Prompt-injection exercise' }).expect(403);
      await request(http).post(`/api/v1/governance/models/${a.modelId}/red-team`).set(auth(a.owner)).send({ summary: 'short' }).expect(400);
      const rec = (await request(http).post(`/api/v1/governance/models/${a.modelId}/red-team`).set(auth(a.owner)).send({ summary: 'Adversarial exercise on the scorecard inputs' }).expect(200)).body;
      expect(rec.red_team.last_red_team).toBeTruthy();

      // A CI scan that sees the code escalate above the registered tier makes red teaming due.
      const m = (await request(http).post('/api/v1/inventory/models').set(auth(a.owner)).send({
        name: 'Rt Support Ranker', model_type: 'MACHINE_LEARNING', functional_area: 'customer_support', use_case_description: 'Ranks support tickets for the desk.',
        human_oversight_required: true, owner_team: 'Ops', board_policy_ref: 'BP-1', source_ref: 'svc/credit/rank.py', project_id: a.projectId,
      }).expect(201)).body;
      expect(m.risk_level).not.toBe('HIGH');
      const tok = (await request(http).post('/api/v1/ci/tokens').set(auth(a.admin)).send({ project_id: a.projectId, label: 'rt' }).expect(201)).body.token;
      await request(http).post('/api/v1/ci/scan').set({ Authorization: `Bearer ${tok}` })
        .send({ commit_sha: 'rt1', files: [{ path: 'svc/credit/rank.py', content: 'import openai\n\ndef score(applicant):\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n' }] }).expect(200);
      const due = (await request(http).get(`/api/v1/governance/models/${m.model_id}/assurance`).set(auth(a.viewer)).expect(200)).body;
      expect(due.red_team.satisfied).toBe(false);
      expect(due.red_team.required_since).toBeTruthy();
      expect(due.red_team.reason).toMatch(/risk escalation/);
      const listed = (await request(http).get('/api/v1/governance/assurance').set(auth(a.viewer)).expect(200)).body.models;
      expect(listed.find((x: any) => x.model_id === m.model_id).red_team_due).toBe(true);
      const ctl = (await request(http).get(`/api/v1/governance/models/${m.model_id}/controls`).set(auth(a.viewer)).expect(200)).body;
      expect(ctl.controls.find((c: any) => c.control_id === 'CTL-RT-02').status).toBe('FAIL');
      await request(http).post(`/api/v1/governance/models/${m.model_id}/red-team`).set(auth(a.owner)).send({ summary: 'Red team after the escalation' }).expect(200);
      expect((await request(http).get(`/api/v1/governance/models/${m.model_id}/assurance`).set(auth(a.viewer)).expect(200)).body.red_team.satisfied).toBe(true);
    });
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E2_8_REDTEAM_AUDIT: 'false' }, async () => {
      await request(http).get(`/api/v1/governance/models/${a.modelId}/assurance`).set(auth(a.viewer)).expect(404);
    });
  });
});
