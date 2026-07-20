import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

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

  it('SECURITY: rejects weak registration passwords', async () => {
    await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@x.test', full_name: 'W', password: 'short' })
      .expect(400);
  });

  it('gates lifecycle promotion on governance completeness', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Ungoverned Draft',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'fraud_detection',
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

    // Complete governance, then promotion succeeds.
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ owner_team: 'Fraud Ops', board_policy_ref: 'POLICY-9', human_oversight_required: true, actor: 'e2e' })
      .expect(200);
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' })
      .expect(200);
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
});
