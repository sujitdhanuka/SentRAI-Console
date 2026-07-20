import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve, sep } from 'path';

import { AIModelEntity, DeploymentGateEventEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { DiscoveredCandidate, scanDirectory } from '../discovery/codebase-scanner';
import { TreeSitterService } from '../discovery/tree-sitter-parser';
import { modelEntityToEntry } from '../inventory/model.mapper';
import { hasEvidence } from '../domain/model-inventory';
import { CiScanDto, CiFileDto } from './ci.dto';
import { parsePolicy, PolicyContract } from './policy';

const POLICY_PATH = '.sentrai/policy.yaml';
const JUNK_RE = /(^|\/)(node_modules|\.git|__MACOSX|\.venv|venv)(\/|$)/;

export interface BlockingGap {
  model_name: string;
  severity: string;
  file_location: string;
  missing: string[];
  reason: string;
  shadow: boolean;
}

@Injectable()
export class CiEvaluationService {
  private readonly logger = new Logger(CiEvaluationService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(DeploymentGateEventEntity) private readonly gates: Repository<DeploymentGateEventEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly notifier: NotifierService,
  ) {}

  /** Materialize the payload into a throwaway workspace and run the real scanner. */
  private scanPayload(files: CiFileDto[]): { candidates: DiscoveredCandidate[]; policyRaw?: string } {
    const root = mkdtempSync(join(tmpdir(), 'sentrai_ci_'));
    const rootResolved = resolve(root) + sep;
    let policyRaw: string | undefined;
    try {
      for (const f of files) {
        const norm = (f.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (norm === POLICY_PATH) policyRaw = f.content;
        // Path-traversal guard + junk skip (same posture as the upload path).
        if (!norm || norm.split('/').some((s) => s === '..') || JUNK_RE.test(norm)) continue;
        const dest = join(root, norm);
        if (!resolve(dest).startsWith(rootResolved)) continue;
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, f.content ?? '');
      }
      const candidates = scanDirectory(root, this.treeSitter);
      return { candidates, policyRaw };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  /** Governance metrics for a discovered asset, resolved against the inventory. */
  private governanceMetrics(
    candidate: DiscoveredCandidate,
    registered: AIModelEntity[],
  ): { metrics: Record<string, boolean>; matched: AIModelEntity | null } {
    const matched =
      registered.find((m) => m.sourceRef && m.sourceRef === candidate.filePath) ??
      registered.find((m) => m.name.toLowerCase() === candidate.suggestedName.toLowerCase()) ??
      null;

    if (!matched) {
      // Shadow AI: no governed model backs this asset — every requirement fails.
      return { metrics: { registered: false }, matched: null };
    }
    const entry = modelEntityToEntry(matched);
    return {
      matched,
      metrics: {
        registered: true,
        owner_team: Boolean(matched.ownerTeam) && !matched.ownerTeam.toLowerCase().includes('unassigned'),
        board_policy_ref: Boolean(matched.boardPolicyRef && matched.boardPolicyRef.trim()),
        human_oversight: matched.humanOversightRequired,
        bias_test_evidence: hasEvidence(entry, 'bias_test'),
        red_team_evidence: hasEvidence(entry, 'red_team') || matched.lastRedTeamDate != null,
      },
    };
  }

  private evaluate(candidates: DiscoveredCandidate[], registered: AIModelEntity[], policy: PolicyContract): BlockingGap[] {
    const gaps: BlockingGap[] = [];
    for (const candidate of candidates) {
      const severity = String(candidate.riskHint).toUpperCase();
      const { metrics, matched } = this.governanceMetrics(candidate, registered);
      for (const rule of policy.gates.block_on) {
        if (String(rule.severity).toUpperCase() !== severity) continue;
        const missing = rule.missing.filter((req) => metrics[req] !== true);
        if (missing.length > 0) {
          gaps.push({
            model_name: candidate.suggestedName,
            severity,
            file_location: candidate.filePath,
            missing,
            shadow: matched === null,
            reason:
              (matched === null ? 'Ungoverned "shadow" AI asset. ' : '') +
              `Missing required governance for ${severity}-risk models: ${missing.join(', ')}.`,
          });
        }
      }
    }
    return gaps;
  }

  private buildSarif(gaps: BlockingGap[], commitSha: string) {
    const rules = [...new Set(gaps.map((g) => g.severity))].map((sev) => ({
      id: `SENTRAI-GATE-${sev}`,
      name: `Ungoverned${sev}RiskModel`,
      shortDescription: { text: `${sev}-risk AI model missing required governance` },
      defaultConfiguration: { level: 'error' },
      helpUri: 'https://sentraiconsole.com',
    }));
    return {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: { name: 'Sentrai-Console', informationUri: 'https://sentraiconsole.com', version: '1.0.0-ci', rules },
          },
          properties: { commitSha },
          results: gaps.map((g) => ({
            ruleId: `SENTRAI-GATE-${g.severity}`,
            level: 'error',
            message: { text: g.reason },
            locations: [
              { physicalLocation: { artifactLocation: { uri: g.file_location }, region: { startLine: 1 } } },
            ],
            properties: { shadow: g.shadow, missing: g.missing },
          })),
        },
      ],
    };
  }

  async runScanAndEvaluate(projectId: string, actor: string, dto: CiScanDto) {
    const { candidates, policyRaw } = this.scanPayload(dto.files);
    const { policy, usedDefault } = parsePolicy(policyRaw);
    const registered = await this.models.find({ where: { projectId, isActive: true } });

    const blockingGaps = this.evaluate(candidates, registered, policy);
    const verdict: 'pass' | 'fail' = blockingGaps.length > 0 ? 'fail' : 'pass';

    // Immutable pre-deployment audit record — one row per pipeline decision.
    const event = await this.gates.save(
      this.gates.create({
        id: uuidv4(),
        projectId,
        commitSha: dto.commit_sha,
        prNumber: dto.pr_number ?? null,
        pipelineRunId: dto.pipeline_run_id ?? null,
        verdict,
        modelsDetected: candidates.length,
        blockingGaps,
        triggeredBy: actor,
        occurredAt: new Date(),
      }),
    );

    if (verdict === 'fail') {
      await this.notifier.notify('ci_gate_failed', {
        project_id: projectId,
        commit_sha: dto.commit_sha,
        pr_number: dto.pr_number ?? null,
        blocking_violations: blockingGaps.length,
        shadow_assets: blockingGaps.filter((g) => g.shadow).length,
        gate_event_id: event.id,
      });
    }

    this.logger.log(
      `ci_gate project=${projectId} commit=${dto.commit_sha} verdict=${verdict} ` +
        `detected=${candidates.length} blocking=${blockingGaps.length} ast=${this.treeSitter.ready ? 'full' : 'regex_only'}`,
    );

    return {
      gate_event_id: event.id,
      verdict,
      policy_source: usedDefault ? 'default' : 'repository',
      ast_coverage: this.treeSitter.ready ? 'full' : 'regex_only',
      summary: {
        models_detected: candidates.length,
        blocking_violations: blockingGaps.length,
        shadow_assets: blockingGaps.filter((g) => g.shadow).length,
        frameworks: policy.gates.frameworks,
      },
      blocking_violations: blockingGaps,
      sarif: this.buildSarif(blockingGaps, dto.commit_sha),
    };
  }

  /** Read the immutable gate-decision trail for a project (auditor view). */
  async history(projectId: string, limit = 50) {
    const rows = await this.gates.find({
      where: { projectId },
      order: { occurredAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      gate_event_id: r.id,
      commit_sha: r.commitSha,
      pr_number: r.prNumber,
      pipeline_run_id: r.pipelineRunId,
      verdict: r.verdict,
      models_detected: r.modelsDetected,
      blocking_violations: r.blockingGaps,
      triggered_by: r.triggeredBy,
      occurred_at: r.occurredAt.toISOString(),
    }));
  }
}
