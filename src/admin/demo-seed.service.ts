import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';

import { DEMO_REPO_CANDIDATES } from '../common/paths';

/**
 * Provisions (or tops up) the "Meridian Finance" demonstration tenant + a
 * read-only "judge" account, in-process, by driving the app's own REST API on
 * localhost. This is the compiled-in twin of scripts/seed-demo.mjs: identical
 * flow, but it ships inside dist/ so it runs on any host with no scripts/
 * folder, and it authenticates with a caller-supplied token (the logged-in
 * admin's session, or the boot admin) so no password is ever handled here.
 *
 * Idempotent: every object is found by name and reused, so a re-run only tops
 * up what a demo session consumed.
 */

const CISO_EMAIL = 'priya.ciso@meridianfinance.demo';
const JUDGE_EMAIL = 'judge@meridianfinance.demo';
const ORG_NAME = 'Meridian Finance';
const PROJECT_NAME = 'Retail Lending Platform';
const SUTRAS = [
  'TRUST_IS_THE_FOUNDATION',
  'PEOPLE_FIRST',
  'INNOVATION_OVER_RESTRAINT',
  'FAIRNESS_AND_EQUITY',
  'ACCOUNTABILITY',
  'UNDERSTANDABLE_BY_DESIGN',
  'SAFETY_RESILIENCE_SUSTAINABILITY',
];

export interface DemoSeedResult {
  ok: boolean;
  base_url: string;
  steps: string[];
  credentials: {
    ciso: { email: string; password: string };
    judge: { email: string; password: string; role: 'VIEWER (read-only)' };
  };
  org_id?: string;
  project_id?: string;
  models?: number;
  error?: string;
}

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger('DemoSeed');

  /**
   * @param adminToken a valid ADMIN bearer token (caller's session, or a boot
   *   login). Used for org/user creation; a CISO token is minted from it for
   *   the tenant-scoped work.
   * @param baseUrl    origin of this instance, e.g. http://127.0.0.1:8000.
   */
  async seed(adminToken: string, baseUrl: string): Promise<DemoSeedResult> {
    const BASE = baseUrl.replace(/\/$/, '');
    const cisoPassword = process.env.MERIDIAN_CISO_PASSWORD ?? 'Meridian!Demo2026';
    const judgePassword = process.env.JUDGE_PASSWORD ?? 'Review!Meridian2026';
    const steps: string[] = [];
    const note = (m: string) => {
      steps.push(m);
      this.logger.log(m);
    };

    const api = async (path: string, opts: { method?: string; token?: string; body?: unknown; raw?: BodyInit } = {}) => {
      const { method = 'GET', token, body, raw } = opts;
      const res = await fetch(`${BASE}/api/v1${path}`, {
        method,
        headers: {
          ...(raw ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: raw ?? (body ? JSON.stringify(body) : undefined),
      });
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
      return json;
    };
    const login = async (username: string, password: string): Promise<string> =>
      (await api('/auth/token', { method: 'POST', body: { username, password } })).access_token;

    const result: DemoSeedResult = {
      ok: false,
      base_url: BASE,
      steps,
      credentials: {
        ciso: { email: CISO_EMAIL, password: cisoPassword },
        judge: { email: JUDGE_EMAIL, password: judgePassword, role: 'VIEWER (read-only)' },
      },
    };

    try {
      // Organization
      const orgs = await api('/organizations/', { token: adminToken });
      let org = orgs.find((o: any) => o.name === ORG_NAME);
      if (!org) {
        org = await api('/organizations/', {
          method: 'POST',
          token: adminToken,
          body: { name: ORG_NAME, description: 'Mid-size NBFC — retail lending (demo tenant)' },
        });
        note(`Organization "${ORG_NAME}": created`);
      } else note(`Organization "${ORG_NAME}": exists`);
      const orgId = org.organization_id ?? org.id;
      result.org_id = orgId;

      // CISO + read-only judge
      const users = await api('/users', { token: adminToken });
      if (!users.find((u: any) => u.email === CISO_EMAIL)) {
        await api('/users', {
          method: 'POST',
          token: adminToken,
          body: { email: CISO_EMAIL, full_name: 'Priya Nair', password: cisoPassword, role: 'CISO', organization_id: orgId },
        });
        note(`CISO ${CISO_EMAIL}: created`);
      } else note(`CISO ${CISO_EMAIL}: exists`);

      if (!users.find((u: any) => u.email === JUDGE_EMAIL)) {
        await api('/users', {
          method: 'POST',
          token: adminToken,
          body: { email: JUDGE_EMAIL, full_name: 'Awards Reviewer', password: judgePassword, role: 'VIEWER', organization_id: orgId },
        });
        note(`Judge ${JUDGE_EMAIL}: created (VIEWER — read-only)`);
      } else note(`Judge ${JUDGE_EMAIL}: exists`);

      const ciso = await login(CISO_EMAIL, cisoPassword);

      // Project
      const projects = await api('/projects', { token: ciso });
      let project = projects.find((p: any) => p.name === PROJECT_NAME);
      if (!project) {
        project = await api('/projects', {
          method: 'POST',
          token: ciso,
          body: { name: PROJECT_NAME, description: 'Credit, KYC, collections, fraud and support services' },
        });
        note(`Project "${PROJECT_NAME}": created`);
      } else note(`Project "${PROJECT_NAME}": exists`);
      const projectId = project.project_id;
      result.project_id = projectId;

      // Codebase upload + scan + import (only when the project has no models yet)
      let models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });
      if (models.length === 0) {
        const repoDir = DEMO_REPO_CANDIDATES.find((p) => existsSync(p));
        if (!repoDir) {
          note('Codebase: demo repo assets not found on host — skipping discovery (tenant still usable)');
        } else {
          const zip = new AdmZip();
          zip.addLocalFolder(repoDir);
          const form = new FormData();
          form.append('file', new Blob([new Uint8Array(zip.toBuffer())]), 'meridian.zip');
          await api(`/projects/${projectId}/codebase`, { method: 'POST', token: ciso, raw: form });
          const scan = await api('/discovery/scan', { method: 'POST', token: ciso, body: { project_id: projectId } });
          const imported = await api('/discovery/import', {
            method: 'POST',
            token: ciso,
            body: { project_id: projectId, file_paths: scan.candidates.map((c: any) => c.file_path) },
          });
          note(`Discovery: ${scan.candidates.length} candidates scanned, ${imported.length} imported`);
          models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });
        }
      } else note(`Codebase: ${models.length} models already present — skipping discovery`);

      // Backfill the agent + MCP server if discovery missed them
      const ensureKind = async (pattern: RegExp, name: string, body: Record<string, unknown>) => {
        if (models.some((m: any) => pattern.test(m.name))) return;
        await api('/inventory/models', { method: 'POST', token: ciso, body: { ...body, name, project_id: projectId } });
        note(`Registered ${name} (discovery missed it)`);
      };
      await ensureKind(/copilot|agent/i, 'Support Copilot Agent', {
        model_type: 'AGENT',
        functional_area: 'customer_support',
        use_case_description:
          'Tool-calling agent that drafts responses to customer-service tickets from the knowledge base, with hardship-escalation guardrails and a four-step autonomy cap.',
        human_oversight_required: true,
        board_policy_ref: 'MF-AI-POL-2026-02',
      });
      await ensureKind(/mcp/i, 'Statement MCP Server', {
        model_type: 'MCP_SERVER',
        functional_area: 'customer_support',
        use_case_description: 'Read-only MCP server exposing masked account-statement retrieval tools to the support copilot.',
        human_oversight_required: true,
        board_policy_ref: 'MF-AI-POL-2026-02',
      });
      models = await api(`/inventory/models?project_id=${projectId}`, { token: ciso });
      result.models = models.length;

      // Governance — three models fully governed (mixed story by design)
      const govern = async (name: string) => {
        const m = models.find((x: any) => x.name === name);
        if (!m) return;
        if (m.owner_team && m.owner_team !== 'UNASSIGNED — pending review') return;
        await api(`/inventory/models/${m.model_id}/governance`, {
          method: 'PATCH',
          token: ciso,
          body: {
            owner_team: 'Model Risk Committee',
            board_policy_ref: 'MF-AI-POL-2026-01',
            human_oversight_required: true,
            sutras_alignment: SUTRAS,
            last_red_team_date: new Date(Date.now() - 42 * 864e5).toISOString().slice(0, 10),
            actor: CISO_EMAIL,
          },
        });
        note(`Governed ${name}`);
      };
      await govern('Retail Credit Scorer');
      await govern('Kyc Doc Classifier');
      await govern('Copilot Agent');

      // Drift windows — breaker armed, not tripped
      const coll = models.find((m: any) => m.name.toLowerCase().includes('collections'));
      if (coll) {
        const hist = await api(`/monitoring/drift/${coll.model_id}/history`, { token: ciso });
        if (hist.length === 0) {
          const ref = Array.from({ length: 400 }, (_, i) => 0.25 + (i % 25) * 0.004);
          const live = Array.from({ length: 400 }, (_, i) => 0.58 + (i % 25) * 0.005);
          await api(`/monitoring/scores/${coll.model_id}`, { method: 'POST', token: ciso, body: { kind: 'reference', scores: ref, accuracy: 0.91 } });
          await api(`/monitoring/scores/${coll.model_id}`, { method: 'POST', token: ciso, body: { kind: 'live', scores: live, accuracy: 0.82 } });
          note('Drift windows staged (Evaluate now will trip the breaker)');
        }
      }

      // Incidents — one open (clock running), one resolved
      const incidents = await api('/compliance/incident', { token: ciso });
      const kyc = models.find((m: any) => m.name === 'Kyc Doc Classifier') ?? models[0];
      if (kyc && !incidents.some((i: any) => i.category === 'EXPLAINABILITY_FAILURE')) {
        await api('/compliance/incident/report', {
          method: 'POST',
          token: ciso,
          body: {
            model_id: kyc.model_id,
            model_name: kyc.name,
            re_name: 'Meridian Finance Ltd',
            functional_area: 'onboarding',
            incident_category: 'EXPLAINABILITY_FAILURE',
            severity: 'P2_HIGH',
            description:
              'Three onboarding applicants were rejected by the KYC document classifier with no reason code surfaced to the agent desktop, leaving support unable to explain the decision to the customers.',
            immediate_action_taken:
              'Affected applications rerouted to the manual verification queue; reason-code propagation fix scheduled with the platform team.',
            observed_at: new Date(Date.now() - 3 * 36e5).toISOString(),
            detected_at: new Date(Date.now() - 2 * 36e5).toISOString(),
            model_risk_level: kyc.risk_level,
            system_suspended: false,
            fallback_activated: true,
          },
        });
        note('Reported open P2 incident (24h regulatory clock)');
      }
      if (!incidents.some((i: any) => i.category === 'MODEL_DRIFT')) {
        const rep = await api('/compliance/incident/report', {
          method: 'POST',
          token: ciso,
          body: {
            model_id: coll?.model_id ?? kyc?.model_id,
            model_name: coll?.name ?? kyc?.name,
            re_name: 'Meridian Finance Ltd',
            functional_area: 'collections',
            incident_category: 'MODEL_DRIFT',
            severity: 'P4_LOW',
            description:
              'Routine drift review flagged a mild population-stability shift on the collections propensity model after a festive-season spending pattern change; no customer impact identified in sampling.',
            immediate_action_taken: 'Model retrained on the extended window and revalidated by the model risk committee.',
            observed_at: new Date(Date.now() - 6 * 864e5).toISOString(),
            detected_at: new Date(Date.now() - 6 * 864e5).toISOString(),
            model_risk_level: coll?.risk_level ?? 'LOW',
            fallback_activated: false,
          },
        });
        await api(`/compliance/incident/${rep.incident_id}/status`, { method: 'PATCH', token: ciso, body: { status: 'RESOLVED', notes: 'Retrained and revalidated.' } });
        note('Seeded resolved P4 incident');
      }

      result.ok = true;
      note(`Meridian Finance ready — ${result.models} models. Judge: ${JUDGE_EMAIL} (read-only).`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`seed failed: ${msg}`);
      result.error = msg;
      return result;
    }
  }
}
