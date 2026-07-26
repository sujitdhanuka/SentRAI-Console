import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GA_SNIPPET } from '../common/analytics';
import { AIModelEntity } from '../database/entities';
import { operationalRegimes } from '../compliance/regimes';
import { GrievancesService } from '../grievances/grievances.service';

/**
 * Public transparency cards (Pillar 5 — Societal). A consumer-facing summary of
 * an AI system — what it does, its risk tier, whether a human is in the loop,
 * which regimes govern it, and how to seek redress — auto-generated from the
 * inventory and published at an unguessable per-model URL (like the PDF export).
 * The disclosures are driven by the framework-as-data regime registry.
 */
@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    private readonly grievances: GrievancesService,
  ) {}

  private async model(modelId: string): Promise<AIModelEntity> {
    const m = await this.models.findOne({ where: { id: modelId } });
    if (!m || !m.isActive) throw new NotFoundException('Model not found');
    return m;
  }

  async card(modelId: string) {
    const m = await this.model(modelId);
    const grievances = await this.grievances.publicSummaryForModel(modelId);
    const regimes = operationalRegimes();
    return {
      model_id: m.id,
      name: m.name,
      purpose: m.useCaseDescription || 'Not disclosed.',
      functional_area: m.functionalArea,
      risk_tier: m.riskLevel,
      human_oversight: m.humanOversightRequired,
      autonomous_scope: m.autonomousScope ?? null,
      owner_team: m.ownerTeam && !m.ownerTeam.toLowerCase().includes('unassigned') ? m.ownerTeam : null,
      lifecycle_stage: m.lifecycleStage,
      governed_under: regimes.map((r) => ({
        name: r.name, jurisdiction: r.jurisdiction, authority: r.authority,
        incident_report_hours: r.incidentReportHours, consumer_redress: r.consumerRedress,
      })),
      disclosures: [...new Set(regimes.flatMap((r) => r.disclosureObligations))],
      redress: {
        available: true,
        file_url: `/api/v1/grievances/public/${m.id}`,
        grievances,
      },
      generated_at: new Date().toISOString(),
    };
  }

  async renderHtml(modelId: string): Promise<string> {
    const c = await this.card(modelId);
    const esc = (t: string) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tierColor = c.risk_tier === 'HIGH' ? '#b23a2b' : c.risk_tier === 'MEDIUM' ? '#a4620f' : '#1e7a4f';
    const regimeRows = c.governed_under.map((r) => `
      <tr><td>${esc(r.name)}</td><td>${esc(r.jurisdiction)}</td>
      <td>${r.incident_report_hours ? `${r.incident_report_hours}h incident reporting` : '—'}</td>
      <td>${r.consumer_redress ? 'Yes' : 'No'}</td></tr>`).join('');
    const disclosures = c.disclosures.map((d) => `<li>${esc(d)}</li>`).join('');

    return `<!doctype html><html lang="en"><head>${GA_SNIPPET}<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Transparency Card — ${esc(c.name)}</title>
<style>
  :root{--paper:#f4f6f2;--ink:#0f2233;--muted:#586a77;--sig:#2240c9;--hair:#e2e6df;--surface:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}
  .eyebrow{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
  h1{font-size:30px;letter-spacing:-.02em;margin:8px 0 4px}
  .sub{color:var(--muted);margin:0 0 18px}
  .tier{display:inline-block;border:1px solid ${tierColor};color:${tierColor};border-radius:3px;padding:2px 9px;font:600 11px/1.4 ui-monospace,Menlo,monospace;text-transform:uppercase}
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:4px;padding:18px 20px;margin:14px 0}
  .card h2{font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--sig);margin:0 0 10px;border-bottom:1px solid var(--hair);padding-bottom:7px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .kv .k{font:600 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .kv .v{font-size:14px;margin-top:3px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--hair)}
  th{font:600 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  ul{margin:6px 0 0;padding-left:20px}
  .redress{border-color:var(--sig)}
  .btn{display:inline-block;background:var(--sig);color:#fff;text-decoration:none;border-radius:3px;padding:9px 16px;font-weight:600;font-size:14px;margin-top:6px}
  .foot{color:var(--muted);font:11px/1.5 ui-monospace,Menlo,monospace;margin-top:24px}
</style></head><body><div class="wrap">
  <div class="eyebrow">AI Transparency Card</div>
  <h1>${esc(c.name)}</h1>
  <p class="sub">${esc(c.functional_area)} · <span class="tier">${esc(c.risk_tier)} risk</span></p>

  <div class="card"><h2>What this system does</h2><p>${esc(c.purpose)}</p></div>

  <div class="card"><h2>How it is governed</h2>
    <div class="grid">
      <div class="kv"><div class="k">Human oversight</div><div class="v">${c.human_oversight ? 'A person reviews outputs' : 'Operates autonomously within a defined scope'}</div></div>
      <div class="kv"><div class="k">Accountable owner</div><div class="v">${c.owner_team ? esc(c.owner_team) : 'Being assigned'}</div></div>
      <div class="kv"><div class="k">Lifecycle stage</div><div class="v">${esc(c.lifecycle_stage)}</div></div>
    </div>
    ${c.autonomous_scope ? `<div class="kv" style="margin-top:10px"><div class="k">Autonomous scope</div><div class="v">${esc(c.autonomous_scope)}</div></div>` : ''}
  </div>

  <div class="card"><h2>Regulatory frameworks</h2>
    <table><thead><tr><th>Framework</th><th>Jurisdiction</th><th>Incident reporting</th><th>Redress</th></tr></thead>
    <tbody>${regimeRows}</tbody></table>
    <h2 style="margin-top:16px">Disclosure commitments</h2><ul>${disclosures}</ul>
  </div>

  <div class="card redress"><h2>Seek redress</h2>
    <p>If a decision by this AI system affected you unfairly, you can file a grievance. We acknowledge and investigate every submission under a service-level deadline.</p>
    <p style="color:var(--muted);font-size:13px">${c.redress.grievances.total} grievance(s) received · ${c.redress.grievances.resolved} resolved.</p>
    <a class="btn" href="${c.redress.file_url}">File a grievance</a>
  </div>

  <p class="foot">Auto-generated by SentRAI Console · ${esc(c.generated_at)} · RBI FREE-AI · NIST AI RMF · EU AI Act · ISO 42001</p>
</div></body></html>`;
  }
}
