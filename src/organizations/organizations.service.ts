import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { OrganizationEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { CreateOrganizationDto, OrganizationResponse, UpdatePlanDto } from './organizations.dto';
import { NotFoundException } from '@nestjs/common';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  private toResponse(o: OrganizationEntity): OrganizationResponse {
    return {
      organization_id: o.id,
      name: o.name,
      description: o.description,
      plan: o.plan ?? 'COMMUNITY',
      created_at: o.createdAt,
    };
  }

  async updatePlan(user: CurrentUser, orgId: string, dto: UpdatePlanDto): Promise<OrganizationResponse> {
    if (user.tenantId !== null) {
      throw new ForbiddenException('Only Global Admins can change an organization plan');
    }
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    org.plan = dto.plan;
    org.limitNotifiedAt = null; // reset the grace/notification cycle on plan change
    org.updatedAt = new Date();
    await this.orgs.save(org);
    return this.toResponse(org);
  }

  async list(user: CurrentUser): Promise<OrganizationResponse[]> {
    if (user.tenantId !== null) {
      throw new ForbiddenException('Only Global Admins can view organizations');
    }
    const rows = await this.orgs.find({ order: { createdAt: 'DESC' } });
    return rows.map((o) => this.toResponse(o));
  }

  async create(user: CurrentUser, dto: CreateOrganizationDto): Promise<OrganizationResponse> {
    if (user.tenantId !== null) {
      throw new ForbiddenException('Only Global Admins can create organizations');
    }
    const existing = await this.orgs.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('Organization already exists');
    }
    const now = new Date();
    const org = await this.orgs.save(
      this.orgs.create({
        id: uuidv4(),
        name: dto.name,
        description: dto.description ?? '',
        createdAt: now,
        updatedAt: now,
      }),
    );
    return this.toResponse(org);
  }
}
