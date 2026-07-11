import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIModelEntity, OrganizationEntity, ProjectEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { expandAndResolve, isDirectory } from '../common/fs-utils';
import { modelEntityToEntry } from '../inventory/model.mapper';
import { sutrasBlockingGaps, sutrasOverallPass, validateSutrasCompliance } from '../compliance/sutras.validator';
import { CreateProjectDto, ProjectResponse, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  private validateDirectory(path: string): void {
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
    this.validateDirectory(dto.root_directory);

    const existing = await this.projects.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`A project named '${dto.name}' already exists`);

    const now = new Date();
    const project = await this.projects.save(
      this.projects.create({
        id: uuidv4(),
        name: dto.name,
        description: dto.description ?? '',
        rootDirectory: expandAndResolve(dto.root_directory),
        lastScannedAt: null,
        tenantId: user.tenantId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return this.toResponse(project);
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
