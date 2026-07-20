import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { OrganizationEntity, UserEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { hashPassword } from '../common/password';
import { AddUserDto, ResetPasswordDto, UpdateUserDto, UserResponse } from './users.dto';

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

  /**
   * Role ceiling: only a global ADMIN may create or grant the ADMIN role. An
   * OWNER administers their own org and can grant any role up to CISO, but never
   * the global ADMIN role — that would be a privilege-escalation path out of the
   * tenant. (ADMIN is tenant-less/global by design.)
   */
  private assertCanAssignRole(actor: CurrentUser, role: Role | undefined): void {
    if (role === undefined) return;
    if (role === Role.ADMIN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only a global administrator can grant the ADMIN role.');
    }
  }

  /** Guard against removing the last active OWNER of an organization. */
  private async assertNotLastActiveOwner(target: UserEntity): Promise<void> {
    if (target.role !== Role.OWNER || !target.isActive || target.tenantId == null) return;
    const activeOwners = await this.users.count({
      where: { tenantId: target.tenantId, role: Role.OWNER, isActive: true },
    });
    if (activeOwners <= 1) {
      throw new ForbiddenException('Cannot remove the last active OWNER of the organization — appoint another owner first.');
    }
  }

  async add(admin: CurrentUser, dto: AddUserDto): Promise<UserResponse> {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('User already exists');
    this.assertCanAssignRole(admin, dto.role);

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

  /** Load a user the acting admin is allowed to manage (org-scoped). */
  private async getManageable(admin: CurrentUser, userId: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (admin.tenantId !== null && user.tenantId !== admin.tenantId) {
      throw new ForbiddenException('Cannot modify users outside your organization');
    }
    return user;
  }

  /** Guard against demoting/deactivating/deleting the last active administrator. */
  private async assertNotLastActiveAdmin(target: UserEntity): Promise<void> {
    if (target.role !== Role.ADMIN || !target.isActive) return;
    const activeAdmins = await this.users.count({ where: { role: Role.ADMIN, isActive: true } });
    if (activeAdmins <= 1) {
      throw new ForbiddenException('Cannot remove the last active administrator — promote another admin first.');
    }
  }

  async resetPassword(admin: CurrentUser, userId: string, dto: ResetPasswordDto): Promise<{ status: string; message: string }> {
    const user = await this.getManageable(admin, userId);
    user.hashedPassword = hashPassword(dto.new_password);
    user.updatedAt = new Date();
    await this.users.save(user);
    return { status: 'success', message: 'Password updated' };
  }

  /** Change a user's role, name, or active status. */
  async update(admin: CurrentUser, userId: string, dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.getManageable(admin, userId);
    const isSelf = user.email === admin.email;
    this.assertCanAssignRole(admin, dto.role);

    // Self-lockout guards.
    if (isSelf && dto.role !== undefined && dto.role !== user.role) {
      throw new ForbiddenException('You cannot change your own role.');
    }
    if (isSelf && dto.is_active === false) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }
    // Last-admin / last-owner guards: demoting or deactivating.
    const demoting = dto.role !== undefined && dto.role !== user.role;
    const deactivating = dto.is_active === false;
    if (demoting || deactivating) {
      await this.assertNotLastActiveAdmin(user);
      await this.assertNotLastActiveOwner(user);
    }

    if (dto.full_name !== undefined) user.fullName = dto.full_name;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.is_active !== undefined) user.isActive = dto.is_active;
    user.updatedAt = new Date();
    await this.users.save(user);
    return this.toResponse(user);
  }

  /** Permanently remove a user. */
  async remove(admin: CurrentUser, userId: string): Promise<void> {
    const user = await this.getManageable(admin, userId);
    if (user.email === admin.email) throw new ForbiddenException('You cannot delete your own account.');
    await this.assertNotLastActiveAdmin(user);
    await this.assertNotLastActiveOwner(user);
    await this.users.delete({ id: userId });
  }
}
