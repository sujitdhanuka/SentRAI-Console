import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve, sep } from 'path';

import { AIModelEntity, OrganizationEntity, ProjectEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { expandAndResolve, isDirectory } from '../common/fs-utils';
import { WORKSPACES_DIR } from '../common/paths';
import { RemoteRepoConnector } from '../discovery/connectors/repo-connector';
import { TreeSitterService } from '../discovery/tree-sitter-parser';
import { candidateAsDict, scanDirectory } from '../discovery/codebase-scanner';
import { modelEntityToEntry } from '../inventory/model.mapper';
import { sutrasBlockingGaps, sutrasOverallPass, validateSutrasCompliance } from '../compliance/sutras.validator';
import { CreateProjectDto, ProjectResponse, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    private readonly config: ConfigService,
    private readonly treeSitter: TreeSitterService,
  ) {}

  private validateDirectory(path: string): void {
    // Pointing a project at an arbitrary server path is server-filesystem
    // access — disabled on hosted deployments, where code arrives via upload.
    if (!this.config.get<boolean>('allowServerFs')) {
      throw new ForbiddenException(
        'Referencing a server directory is disabled on this deployment. Upload a codebase ZIP instead.',
      );
    }
    if (!isDirectory(path)) {
      throw new BadRequestException(`Not a directory the service can see: ${expandAndResolve(path)}`);
    }
  }

  private async toResponse(orm: ProjectEntity): Promise<ProjectResponse> {
    const models = await this.models.find({ where: { projectId: orm.id, isActive: true } });
    let compliant = 0;
    let openGaps = 0;
    for (const m of models) {
      const report = validateSutrasCompliance(modelEntityToEntry(m));
      if (sutrasOverallPass(report)) compliant += 1;
      else openGaps += sutrasBlockingGaps(report).length;
    }

    let tenantName: string | null = null;
    if (orm.tenantId) {
      const org = await this.orgs.findOne({ where: { id: orm.tenantId } });
      tenantName = org?.name ?? null;
    }

    return {
      project_id: orm.id,
      name: orm.name,
      description: orm.description,
      root_directory: orm.rootDirectory,
      last_scanned_at: orm.lastScannedAt,
      created_at: orm.createdAt,
      model_count: models.length,
      compliant_count: compliant,
      open_gap_count: openGaps,
      tenant_name: tenantName,
    };
  }

  async create(user: CurrentUser, dto: CreateProjectDto): Promise<ProjectResponse> {
    // Any logged-in user can create projects; org membership is optional and,
    // when present, scopes the project to that organization.
    const usesServerPath = Boolean(dto.root_directory && dto.root_directory.trim());
    if (usesServerPath) this.validateDirectory(dto.root_directory);

    const existing = await this.projects.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`A project named '${dto.name}' already exists`);

    const now = new Date();
    const id = uuidv4();
    let project: ProjectEntity;
    try {
      project = await this.projects.save(
        this.projects.create({
          id,
          name: dto.name,
          description: dto.description ?? '',
          // Without a server path the project scans its private upload workspace,
          // populated via POST /projects/:id/codebase.
          rootDirectory: usesServerPath ? expandAndResolve(dto.root_directory) : join(WORKSPACES_DIR, id),
          lastScannedAt: null,
          tenantId: user.tenantId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    } catch (e) {
      // Surface a DB-layer failure (e.g. connectivity, constraint) as an
      // actionable message rather than a bare "Internal server error".
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.error(`project create failed for '${dto.name}': ${reason}`);
      throw new InternalServerErrorException(`Could not save the project to the database: ${reason}`);
    }
    return this.toResponse(project);
  }

  // Never scan or store these — noise, VCS internals, or dependency trees.
  private static readonly JUNK_RE = /(^|\/)(node_modules|\.git|__MACOSX|\.venv|venv)(\/|$)/;

  private async loadProjectForUpload(user: CurrentUser, projectId: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (user.tenantId !== null && project.tenantId !== user.tenantId) {
      throw new ForbiddenException('Cannot upload into a project outside your organization');
    }
    return project;
  }

  /**
   * Clear and recreate the project's workspace. Prefers WORKSPACES_DIR, but on
   * a read-only / permission-restricted app root (common on shared hosting) it
   * falls back to the OS temp dir — the extracted files are only needed for the
   * scan-on-upload; the durable result is stored in the DB, not on disk.
   */
  private prepareWorkspace(projectId: string): { target: string; targetRoot: string } {
    const candidates = [join(WORKSPACES_DIR, projectId), join(tmpdir(), 'sentrai-workspaces', projectId)];
    let lastErr = '';
    for (const target of candidates) {
      try {
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        return { target, targetRoot: resolve(target) + sep };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        this.logger.warn(`workspace write failed at ${target}: ${lastErr}`);
      }
    }
    throw new InternalServerErrorException(
      `Could not write the codebase workspace (${lastErr}). Set WORKSPACES_DIR to a writable path.`,
    );
  }

  /**
   * Write one file into the workspace, defending against path-traversal
   * ("zip-slip") and skipping junk paths. Returns whether the file was written.
   */
  private writeWorkspaceFile(target: string, targetRoot: string, rawPath: string, data: Buffer): boolean {
    const norm = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || norm.split('/').some((seg) => seg === '..') || ProjectsService.JUNK_RE.test(norm)) {
      return false;
    }
    const dest = join(target, norm);
    if (!resolve(dest).startsWith(targetRoot)) return false;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    return true;
  }

  private extractZipToWorkspace(zip: AdmZip, target: string, targetRoot: string): { extracted: number; skipped: number } {
    let extracted = 0;
    let skipped = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (this.writeWorkspaceFile(target, targetRoot, entry.entryName, entry.getData())) extracted += 1;
      else skipped += 1;
    }
    return { extracted, skipped };
  }

  private async finalizeWorkspace(
    project: ProjectEntity,
    target: string,
    extracted: number,
    skipped: number,
    source: string,
    user: CurrentUser,
  ) {
    if (extracted === 0) throw new BadRequestException('No usable files were found in the codebase');

    // Scan immediately, while the files are guaranteed present, and persist the
    // result to the DB. Discovery then never depends on the workspace surviving
    // on disk (redeploys and ephemeral hosting filesystems wipe it).
    const now = new Date();
    let candidates: any[] = [];
    try {
      candidates = scanDirectory(target, this.treeSitter).map(candidateAsDict);
    } catch (e) {
      this.logger.warn(`scan-on-upload failed for project=${project.id}: ${String(e)}`);
    }

    project.rootDirectory = target;
    project.lastScannedAt = now;
    project.lastScanResult = {
      scanned_at: now.toISOString(),
      ast_coverage: this.treeSitter.ready ? 'full' : 'regex_only',
      files_flagged: candidates.length,
      candidates,
    };
    project.updatedAt = now;
    await this.projects.save(project);
    this.logger.log(
      `codebase loaded project=${project.id} source=${source} files=${extracted} skipped=${skipped} ` +
        `models_discovered=${candidates.length} by=${user.email}`,
    );
    return {
      project_id: project.id,
      root_directory: target,
      files_extracted: extracted,
      entries_skipped: skipped,
      models_discovered: candidates.length,
      source,
      uploaded_by: user.email,
    };
  }

  /**
   * Receive a codebase ZIP from the browser and extract it into the project's
   * private workspace, which becomes the scan root. This is how hosted users
   * onboard code — a web page cannot hand the server local filesystem paths.
   */
  async uploadCodebase(
    user: CurrentUser,
    projectId: string,
    file: { originalname?: string; size?: number; buffer?: Buffer } | undefined,
  ) {
    const project = await this.loadProjectForUpload(user, projectId);
    if (!file?.buffer?.length) throw new BadRequestException('Attach a .zip file in the "file" field');
    if (file.originalname && !file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Only .zip archives are supported');
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(file.buffer);
    } catch {
      throw new BadRequestException('The uploaded file is not a readable ZIP archive');
    }

    const { target, targetRoot } = this.prepareWorkspace(projectId);
    const { extracted, skipped } = this.extractZipToWorkspace(zip, target, targetRoot);
    return this.finalizeWorkspace(project, target, extracted, skipped, 'zip', user);
  }

  /**
   * Receive an entire folder from the browser (webkitdirectory upload): many
   * files, each carrying its relative path in `originalname`. They are written
   * into the project's private workspace, preserving structure.
   */
  async uploadCodebaseFolder(
    user: CurrentUser,
    projectId: string,
    files: Array<{ originalname?: string; buffer?: Buffer }> | undefined,
    paths?: string | string[],
  ) {
    const project = await this.loadProjectForUpload(user, projectId);
    if (!files?.length) throw new BadRequestException('Select a folder to upload (no files received)');

    // multer reduces originalname to a basename, losing folder structure and
    // defeating junk filtering. The browser sends the true relative paths in a
    // parallel `paths` field, matched to files by index.
    const relPaths = Array.isArray(paths) ? paths : paths ? [paths] : [];

    const { target, targetRoot } = this.prepareWorkspace(projectId);
    let extracted = 0;
    let skipped = 0;
    files.forEach((f, i) => {
      const relPath = relPaths[i] || f.originalname || '';
      if (f.buffer && this.writeWorkspaceFile(target, targetRoot, relPath, f.buffer)) extracted += 1;
      else skipped += 1;
    });
    return this.finalizeWorkspace(project, target, extracted, skipped, 'folder', user);
  }

  /**
   * Import a public or private GitHub repository by downloading its zipball
   * and extracting it into the project's private workspace. The optional token
   * is used once for the download and never stored.
   */
  async importCodebaseFromGithub(
    user: CurrentUser,
    projectId: string,
    dto: { owner: string; repo: string; branch?: string | null; token?: string | null },
  ) {
    const project = await this.loadProjectForUpload(user, projectId);
    const branch = (dto.branch && dto.branch.trim()) || 'main';

    let buffer: Buffer;
    try {
      buffer = await RemoteRepoConnector.fetchGithubZipball(dto.owner, dto.repo, branch, dto.token ?? null);
    } catch (e) {
      throw new BadRequestException(
        `Could not fetch GitHub repository ${dto.owner}/${dto.repo}@${branch}: ${String(e instanceof Error ? e.message : e)}`,
      );
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('GitHub returned an unreadable archive');
    }

    const { target, targetRoot } = this.prepareWorkspace(projectId);
    const { extracted, skipped } = this.extractZipToWorkspace(zip, target, targetRoot);
    return this.finalizeWorkspace(project, target, extracted, skipped, `github:${dto.owner}/${dto.repo}@${branch}`, user);
  }

  async list(user: CurrentUser): Promise<ProjectResponse[]> {
    const where = user.tenantId ? { tenantId: user.tenantId } : {};
    const rows = await this.projects.find({ where, order: { createdAt: 'DESC' } });
    return Promise.all(rows.map((p) => this.toResponse(p)));
  }

  async get(projectId: string): Promise<ProjectResponse> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    return this.toResponse(project);
  }

  async update(user: CurrentUser, projectId: string, dto: UpdateProjectDto): Promise<ProjectResponse> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    if (user.tenantId !== null && project.tenantId !== user.tenantId) {
      throw new ForbiddenException('Cannot modify a project outside your organization');
    }

    if (dto.name !== undefined && dto.name !== null) project.name = dto.name;
    if (dto.description !== undefined && dto.description !== null) project.description = dto.description;
    if (dto.root_directory !== undefined && dto.root_directory !== null) {
      this.validateDirectory(dto.root_directory);
      project.rootDirectory = expandAndResolve(dto.root_directory);
    }
    project.updatedAt = new Date();
    await this.projects.save(project);
    return this.toResponse(project);
  }

  async remove(user: CurrentUser, projectId: string, cascade: boolean): Promise<void> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    if (user.tenantId !== null && project.tenantId !== user.tenantId) {
      throw new ForbiddenException('Cannot delete a project outside your organization');
    }

    const modelCount = await this.models.count({ where: { projectId } });
    if (modelCount > 0) {
      if (!cascade) {
        throw new ConflictException(
          'Cannot delete a project with tracked models. Deactivate or reassign its models first.',
        );
      }
      await this.models.delete({ projectId });
    }
    await this.projects.delete({ id: projectId });
  }
}
