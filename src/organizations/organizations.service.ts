import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { OrganizationEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { CreateOrganizationDto, OrganizationResponse } from './organizations.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  private toResponse(o: OrganizationEntity): OrganizationResponse {
    return { organization_id: o.id, name: o.name, description: o.description, created_at: o.createdAt };
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
