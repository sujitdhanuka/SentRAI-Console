import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import { homedir } from 'os';

import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { ModelLifecycleStage, RiskLevel } from '../common/enums';
import { AIModelEntry, triageAiModel } from '../domain/model-inventory';
import { expandAndResolve } from '../common/fs-utils';
import { WORKSPACES_DIR } from '../common/paths';
import { candidateAsDict, DiscoveredCandidate, scanDirectory } from './codebase-scanner';
import { TreeSitterService } from './tree-sitter-parser';
import { Neo4jClient } from './neo4j-client';
import { SupervisorCoordinator } from './agents/supervisor';
import { Neo4jLineageAgent } from './agents/neo4j-lineage-agent';
import { RemoteRepoConnector } from './connectors/repo-connector';
import { InfrastructureDiscoveryConnector } from './connectors/infra-connector';
import { BrowseResponse, ImportDto, ImportedModel, InfraScanDto, RemoteScanDto } from './discovery.dto';

const RISK_ORDER: Record<string, number> = { [RiskLevel.LOW]: 0, [RiskLevel.MEDIUM]: 1, [RiskLevel.HIGH]: 2 };

@Injectable()
export class DiscoveryService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    @InjectRepository(PromptEntity) private readonly prompts: Repository<PromptEntity>,
    @InjectRepository(AIIncidentEntity) private readonly incidents: Repository<AIIncidentEntity>,
    @InjectRepository(DriftReportEntity) private readonly drifts: Repository<DriftReportEntity>,
    @InjectRepository(AIAuditTrailEntity) private readonly audits: Repository<AIAuditTrailEntity>,
    private readonly treeSitter: TreeSitterService,
    private readonly neo4j: Neo4jClient,
    private readonly config: ConfigService,
  ) {}

  /** Server-filesystem access (browse / raw-path scan) is gated in production. */
  private assertServerFsAllowed(): void {
    if (!this.config.get<boolean>('allowServerFs')) {
      throw new ForbiddenException(
        'Server filesystem access is disabled on this deployment. Upload a codebase ZIP to a project instead.',
      );
    }
  }

  /** True when a path is inside the app-managed per-project workspace tree. */
  private isManagedWorkspace(dir: string): boolean {
    const resolved = resolve(expandAndResolve(dir));
    const root = resolve(WORKSPACES_DIR);
    return resolved === root || resolved.startsWith(root + sep);
  }

  private async resolveDirectory(
    directory?: string | null,
    projectId?: string | null,
  ): Promise<{ dir: string; project: ProjectEntity | null }> {
    let project: ProjectEntity | null = null;
    if (projectId) {
      project = await this.projects.findOne({ where: { id: projectId } });
      if (!project) throw new NotFoundException('Project not found');
    }
    if (directory) {
      // An uploaded project's own workspace is app-managed and always safe to
      // scan. Only arbitrary server paths require ALLOW_SERVER_FS.
      if (!this.isManagedWorkspace(directory)) this.assertServerFsAllowed();
      return { dir: directory, project };
    }
    if (project) return { dir: project.rootDirectory, project };
    throw new BadRequestException('Provide either a directory or a project_id');
  }

  browse(path?: string | null): BrowseResponse {
    this.assertServerFsAllowed();
    const target = path ? expandAndResolve(path) : homedir();
    if (!existsSync(target)) throw new NotFoundException(`Path does not exist: ${target}`);
    let st;
    try {
      st = statSync(target);
    } catch {
      throw new ForbiddenException(`Permission denied: ${target}`);
    }
    if (!st.isDirectory()) throw new BadRequestException(`Not a directory: ${target}`);

    let entries: string[];
    try {
      entries = readdirSync(target);
    } catch {
      throw new ForbiddenException(`Permission denied: ${target}`);
    }
    const directories = entries
      .filter((name) => !name.startsWith('.'))
      .filter((name) => {
        try {
          return statSync(join(target, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => ({ name, path: join(target, name) }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    const parent = dirname(target);
    return {
      current_path: target,
      parent_path: parent !== target ? parent : null,
      directories,
    };
  }

  async scan(directory?: string | null, projectId?: string | null) {
    const { dir, project } = await this.resolveDirectory(directory, projectId);
    const resolved = expandAndResolve(dir);
    if (!existsSync(resolved)) {
      // The usual hosted cause: workspaces live under the app root and are
      // wiped on redeploy. Say so, and point at the persistent-path fix.
      throw new BadRequestException(
        this.isManagedWorkspace(dir)
          ? 'The uploaded codebase is no longer on disk — project workspaces are wiped on redeploy unless WORKSPACES_DIR points at a persistent path. Re-upload the codebase to this project, then scan again.'
          : `Directory does not exist: ${dir}`,
      );
    }
    if (!statSync(resolved).isDirectory()) {
      throw new BadRequestException(`${dir} is not a directory`);
    }
    let candidates: DiscoveredCandidate[];
    try {
      candidates = scanDirectory(resolved, this.treeSitter);
    } catch (e) {
      throw new BadRequestException(`Scan failed while reading ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (project) {
      project.lastScannedAt = new Date();
      await this.projects.save(project);
    }
    return {
      directory: dir,
      // Surface scan assurance level so a degraded (regex-only) scan is never
      // silent — regulators and auditors can see when AST coverage was lost.
      ast_coverage: this.treeSitter.ready ? 'full' : 'regex_only',
      files_flagged: candidates.length,
      candidates: candidates.map(candidateAsDict),
    };
  }

  private autoDescription(cand: DiscoveredCandidate): string {
    if (cand.description) return cand.description;
    const cats = [...new Set(cand.signals.map((s) => s.category))].sort();
    let desc = `Auto-discovered via static codebase scan. Detected signals: ${cats.join(', ')}.`;
    if (cand.domainTags.length) desc += ` Domain: ${cand.domainTags.join(', ')}.`;
    return desc;
  }

  private async deleteModelCascade(modelId: string): Promise<void> {
    await this.audits.delete({ modelId });
    await this.drifts.delete({ modelId });
    await this.incidents.delete({ modelId });
    await this.ledger.delete({ modelId });
    await this.prompts.delete({ modelId });
    await this.models.delete({ id: modelId });
  }

  async import(dto: ImportDto): Promise<ImportedModel[]> {
    const { dir, project } = await this.resolveDirectory(dto.directory, dto.project_id);
    const candidates = scanDirectory(expandAndResolve(dir), this.treeSitter);

    const wanted = new Set(dto.file_paths);
    const selected = candidates.filter((c) => wanted.has(c.filePath));
    if (selected.length === 0) {
      throw new NotFoundException('None of the requested file_paths matched a current scan result');
    }

    const imported: ImportedModel[] = [];
    for (const cand of selected) {
      const existing = await this.models
        .createQueryBuilder('m')
        .where('m.isActive = 1')
        .andWhere(dto.project_id ? 'm.projectId = :pid' : 'm.projectId IS NULL', dto.project_id ? { pid: dto.project_id } : {})
        .andWhere('(m.name = :name OR m.sourceRef = :src)', { name: cand.suggestedName, src: cand.filePath })
        .getMany();

      if (existing.length) {
        if (dto.overwrite) {
          for (const m of existing) await this.deleteModelCascade(m.id);
        } else {
          continue;
        }
      }

      const now = new Date();
      const entry: AIModelEntry = {
        modelId: uuidv4(),
        name: cand.suggestedName,
        modelType: cand.modelTypeGuess,
        functionalArea: cand.functionalAreaGuess,
        useCaseDescription: this.autoDescription(cand),
        targetCustomerSegments: [],
        riskLevel: RiskLevel.LOW,
        lifecycleStage: ModelLifecycleStage.DESIGN,
        ownerTeam: dto.owner_team ?? 'UNASSIGNED — pending review',
        developedBy: 'internal',
        deploymentDate: null,
        dependencies: [],
        performanceBenchmarks: [],
        sutrasAlignment: [],
        humanOversightRequired: true,
        autonomousScope: null,
        boardPolicyRef: dto.board_policy_ref ?? '',
        lastRedTeamDate: null,
        nextAuditDue: null,
        grievanceCount: 0,
        grievanceResolutionNotes: '',
        sourceRef: cand.filePath,
        registeredAt: now,
        updatedAt: now,
        isActive: true,
        projectId: dto.project_id ?? null,
      };

      const triaged = triageAiModel(entry);
      const finalRisk = RISK_ORDER[triaged] >= RISK_ORDER[cand.riskHint] ? triaged : cand.riskHint;

      await this.models.save(this.models.create({
        id: entry.modelId,
        projectId: entry.projectId,
        name: entry.name,
        modelType: entry.modelType,
        functionalArea: entry.functionalArea,
        useCaseDescription: entry.useCaseDescription,
        targetCustomerSegments: [],
        riskLevel: finalRisk,
        lifecycleStage: entry.lifecycleStage,
        ownerTeam: entry.ownerTeam,
        developedBy: entry.developedBy,
        deploymentDate: null,
        dependencies: [],
        performanceBenchmarks: [],
        sutrasAlignment: [],
        humanOversightRequired: entry.humanOversightRequired,
        autonomousScope: null,
        boardPolicyRef: entry.boardPolicyRef,
        lastRedTeamDate: null,
        nextAuditDue: null,
        grievanceCount: 0,
        grievanceResolutionNotes: '',
        sourceRef: entry.sourceRef,
        isActive: true,
        registeredAt: entry.registeredAt,
        updatedAt: entry.updatedAt,
      }));

      for (const p of cand.prompts) {
        await this.prompts.save(this.prompts.create({
          id: uuidv4(),
          modelId: entry.modelId,
          rawText: p.raw_text,
          promptType: p.prompt_type,
          injectionRisk: p.injection_risk,
          piiDetected: p.pii_detected,
        }));
      }

      await this.ledger.save(this.ledger.create({
        id: uuidv4(),
        modelId: entry.modelId,
        eventType: 'MODEL_DISCOVERED_AND_IMPORTED',
        eventData: {
          source_ref: cand.filePath,
          static_risk_hint: cand.riskHint,
          triaged_risk_level: triaged,
          final_risk_level: finalRisk,
          confidence: cand.confidence,
        },
        actor: 'codebase_scanner',
        occurredAt: entry.registeredAt,
      }));

      imported.push({
        model_id: entry.modelId,
        name: entry.name,
        source_ref: cand.filePath,
        risk_level: finalRisk,
        remaining_gaps: cand.gaps,
      });
    }

    if (project) {
      project.lastScannedAt = new Date();
      await this.projects.save(project);
    }
    return imported;
  }

  async scanRemote(dto: RemoteScanDto) {
    let tempPath: string;
    if (dto.provider.toLowerCase() === 'github') {
      if (!dto.owner || !dto.repo) throw new BadRequestException('owner and repo are required for github');
      tempPath = await RemoteRepoConnector.downloadGithubRepo(dto.owner, dto.repo, dto.branch, dto.token);
    } else if (dto.provider.toLowerCase() === 'gitlab') {
      if (!dto.project_id) throw new BadRequestException('project_id is required for gitlab');
      tempPath = await RemoteRepoConnector.downloadGitlabRepo(dto.project_id, dto.branch, dto.token, dto.host);
    } else {
      throw new BadRequestException('Unsupported remote provider. Use github or gitlab');
    }

    try {
      const candidates = scanDirectory(tempPath, this.treeSitter);

      // Record lineage in Neo4j (no-op if unavailable).
      const coord = new SupervisorCoordinator();
      coord.registerAgent(new Neo4jLineageAgent(this.neo4j));
      await coord.coordinateScan({ rootPath: tempPath, candidates });

      const results = candidates.map((c) => ({
        name: c.suggestedName,
        model_type: c.modelTypeGuess,
        confidence: c.confidence,
        file_path: c.filePath,
        risk_hint: c.riskHint,
        gaps: c.gaps,
        prompts: c.prompts,
        secrets: c.secrets,
      }));
      return { candidates: results };
    } finally {
      this.cleanupTempScan(tempPath);
    }
  }

  private cleanupTempScan(p: string): void {
    try {
      // Walk up to the mkdtemp root (basename starts with sentrai_scan_) and remove it.
      let cur = resolve(p);
      while (cur && cur !== dirname(cur)) {
        if (basename(cur).startsWith('sentrai_scan_')) {
          rmSync(cur, { recursive: true, force: true });
          return;
        }
        cur = dirname(cur);
      }
    } catch {
      // ignore cleanup failures
    }
  }

  async scanInfrastructure(dto: InfraScanDto) {
    const provider = dto.provider.toLowerCase();
    if (provider === 'kubernetes') {
      return { deployments: await InfrastructureDiscoveryConnector.scanKubernetesNamespaces(dto.namespace) };
    }
    if (provider === 'triton') {
      if (!dto.endpoint_url) throw new BadRequestException('endpoint_url is required for triton provider');
      return { models: await InfrastructureDiscoveryConnector.scanTritonServer(dto.endpoint_url) };
    }
    throw new BadRequestException('Unsupported infrastructure provider. Use kubernetes or triton');
  }
}
