import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import { homedir, tmpdir } from 'os';

import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { ModelLifecycleStage, RiskLevel, Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
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
  private readonly logger = new Logger(DiscoveryService.name);

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

  /**
   * True when a path is inside an app-managed per-project workspace — either the
   * configured WORKSPACES_DIR or the temp-dir fallback the upload uses when the
   * app root is not writable.
   */
  private isManagedWorkspace(dir: string): boolean {
    const resolved = resolve(expandAndResolve(dir));
    const roots = [resolve(WORKSPACES_DIR), resolve(join(tmpdir(), 'sentrai-workspaces'))];
    return roots.some((root) => resolved === root || resolved.startsWith(root + sep));
  }

  /** Load a project and enforce org isolation (ADMIN is a global superuser). */
  private async assertProjectAccess(user: CurrentUser, projectId: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (user.role !== Role.ADMIN && project.tenantId !== (user.tenantId ?? null)) {
      throw new ForbiddenException('Project is outside your organization');
    }
    return project;
  }

  /**
   * Resolve the directory to scan for a caller. The path is ALWAYS derived from
   * the caller's OWN (tenant-verified) project — a client-supplied `directory`
   * is only honored for a global ADMIN operating with ALLOW_SERVER_FS. This is
   * what stops a user from scanning another organization's managed workspace by
   * passing its path: even a valid managed-workspace path is refused unless it
   * belongs to a project the caller owns.
   */
  private async resolveDirectory(
    user: CurrentUser,
    directory?: string | null,
    projectId?: string | null,
  ): Promise<{ dir: string; project: ProjectEntity | null }> {
    if (projectId) {
      const project = await this.assertProjectAccess(user, projectId);
      return { dir: project.rootDirectory, project };
    }
    if (directory) {
      // No project context: only a global admin may point at a raw server path,
      // and only when ALLOW_SERVER_FS is enabled.
      if (user.role !== Role.ADMIN) {
        throw new ForbiddenException('Scanning requires a project_id — upload a codebase to a project first.');
      }
      this.assertServerFsAllowed();
      return { dir: directory, project: null };
    }
    throw new BadRequestException('Provide a project_id to scan its uploaded codebase.');
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

  private storedResult(dir: string, project: ProjectEntity) {
    const r = project.lastScanResult!;
    return {
      directory: dir,
      ast_coverage: r.ast_coverage,
      files_flagged: r.files_flagged,
      candidates: r.candidates,
      served_from: 'stored',
      scanned_at: r.scanned_at,
    };
  }

  async scan(user: CurrentUser, directory?: string | null, projectId?: string | null) {
    // Resolve the workspace from the caller's OWN (tenant-verified) project so
    // the DB-stored scan is authoritative regardless of filesystem state — and
    // a client-supplied directory can never redirect the scan to another org.
    const { dir, project } = await this.resolveDirectory(user, directory, projectId);
    const resolved = expandAndResolve(dir);

    // A live scan is only possible when the files are present in a location we
    // may read (a managed workspace, or ALLOW_SERVER_FS for arbitrary paths).
    const filesPresent = existsSync(resolved) && statSync(resolved).isDirectory();
    const readable = filesPresent && (this.isManagedWorkspace(dir) || this.config.get<boolean>('allowServerFs'));

    if (!readable) {
      // No live read — serve the stored result if we have one.
      if (project?.lastScanResult) return this.storedResult(dir, project);
      // Otherwise explain: gated arbitrary path, or nothing to scan.
      if (filesPresent && !this.isManagedWorkspace(dir)) this.assertServerFsAllowed();
      throw new BadRequestException(
        'No codebase found for this project. Upload a codebase (zip/folder/GitHub) — it is scanned on upload and the result is stored.',
      );
    }

    let candidates: DiscoveredCandidate[];
    try {
      candidates = scanDirectory(resolved, this.treeSitter);
    } catch (e) {
      // A live read error must never lose a prior result — serve the stored one.
      if (project?.lastScanResult) {
        this.logger.warn(`live scan failed for ${dir}; serving stored result: ${String(e)}`);
        return this.storedResult(dir, project);
      }
      throw new BadRequestException(`Scan failed while reading ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const dicts = candidates.map(candidateAsDict);
    const astCoverage = this.treeSitter.ready ? 'full' : 'regex_only';
    if (project) {
      project.lastScannedAt = new Date();
      project.lastScanResult = {
        scanned_at: new Date().toISOString(),
        ast_coverage: astCoverage,
        files_flagged: dicts.length,
        candidates: dicts,
      };
      await this.projects.save(project);
    }
    return {
      directory: dir,
      // Surface scan assurance level so a degraded (regex-only) scan is never
      // silent — regulators and auditors can see when AST coverage was lost.
      ast_coverage: astCoverage,
      files_flagged: dicts.length,
      candidates: dicts,
      served_from: 'live',
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

  async import(user: CurrentUser, dto: ImportDto): Promise<ImportedModel[]> {
    const { dir, project } = await this.resolveDirectory(user, dto.directory, dto.project_id);
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
