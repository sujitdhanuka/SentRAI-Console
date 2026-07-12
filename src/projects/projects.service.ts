import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';

import { AIModelEntity, OrganizationEntity, ProjectEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { expandAndResolve, isDirectory } from '../common/fs-utils';
import { WORKSPACES_DIR } from '../common/paths';
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
    const project = await this.projects.save(
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
    return this.toResponse(project);
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
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (user.tenantId !== null && project.tenantId !== user.tenantId) {
      throw new ForbiddenException('Cannot upload into a project outside your organization');
    }
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

    const target = join(WORKSPACES_DIR, projectId);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const targetRoot = resolve(target) + sep;

    let extracted = 0;
    let skipped = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const norm = entry.entryName.replace(/\\/g, '/');
      // Zip-slip protection + junk we never want to scan or store.
      if (norm.split('/').some((seg) => seg === '..') ||
          /(^|\/)(node_modules|\.git|__MACOSX|\.venv|venv)(\/|$)/.test(norm)) {
        skipped += 1;
        continue;
      }
      const dest = join(target, norm);
      if (!resolve(dest).startsWith(targetRoot)) {
        skipped += 1;
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, entry.getData());
      extracted += 1;
    }
    if (extracted === 0) throw new BadRequestException('The archive contained no usable files');

    project.rootDirectory = target;
    project.updatedAt = new Date();
    await this.projects.save(project);
    this.logger.log(`codebase uploaded project=${projectId} files=${extracted} skipped=${skipped} by=${user.email}`);

    return {
      project_id: projectId,
      root_directory: target,
      files_extracted: extracted,
      entries_skipped: skipped,
      uploaded_by: user.email,
    };
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
