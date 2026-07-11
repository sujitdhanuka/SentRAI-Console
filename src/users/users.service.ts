import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { OrganizationEntity, UserEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { hashPassword } from '../common/password';
import { AddUserDto, ResetPasswordDto, UserResponse } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  private async orgName(tenantId: string | null): Promise<string | null> {
    if (!tenantId) return null;
    const org = await this.orgs.findOne({ where: { id: tenantId } });
    return org?.name ?? null;
  }

  private async toResponse(u: UserEntity): Promise<UserResponse> {
    return {
      user_id: u.id,
      email: u.email,
      full_name: u.fullName,
      role: u.role,
      is_active: u.isActive,
      organization_id: u.tenantId ?? null,
      organization_name: await this.orgName(u.tenantId),
    };
  }

  async list(admin: CurrentUser): Promise<UserResponse[]> {
    const where = admin.tenantId !== null ? { tenantId: admin.tenantId } : {};
    const rows = await this.users.find({ where, order: { createdAt: 'DESC' } });
    return Promise.all(rows.map((u) => this.toResponse(u)));
  }

  async add(admin: CurrentUser, dto: AddUserDto): Promise<UserResponse> {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('User already exists');

    // Org admins can only create users in their own organization.
    const tenantId = admin.tenantId !== null ? admin.tenantId : (dto.organization_id ?? null);

    const now = new Date();
    const user = await this.users.save(
      this.users.create({
        id: uuidv4(),
        email: dto.email,
        fullName: dto.full_name,
        hashedPassword: hashPassword(dto.password),
        role: dto.role,
        tenantId: tenantId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return this.toResponse(user);
  }

  async resetPassword(admin: CurrentUser, userId: string, dto: ResetPasswordDto): Promise<{ status: string; message: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (admin.tenantId !== null && user.tenantId !== admin.tenantId) {
      throw new ForbiddenException('Cannot modify users outside your organization');
    }
    user.hashedPassword = hashPassword(dto.new_password);
    user.updatedAt = new Date();
    await this.users.save(user);
    return { status: 'success', message: 'Password updated' };
  }
}
