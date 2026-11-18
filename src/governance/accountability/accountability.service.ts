/**
 * Accountability (E1.9): the organisation's accountable official (Chief AI
 * Officer in the US) and AI governance board, with change history, plus a
 * named owner per model and the owner register. The accountable official is
 * the executive whose sign-off the default risk appetite requires for HIGH
 * and CRITICAL risk acceptances (E1.3).
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, ModelLedgerEventEntity, OrganizationEntity, ProjectEntity, UserEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { v4 as uuidv4 } from 'uuid';

const EDITORS: Role[] = [Role.OWNER, Role.CISO];

@Injectable()
export class AccountabilityService {
  constructor(
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly flags: FeatureFlagsService,
  ) {}

  private async orgFor(user: CurrentUser, orgId: string): Promise<OrganizationEntity> {
    assertFlag(this.flags, 'accountability');
    if (user.role !== Role.ADMIN && user.tenantId !== orgId) throw new NotFoundException('Organization not found');
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private async userView(id: string | null | undefined) {
    if (!id) return null;
    const u = await this.users.findOne({ where: { id } });
    return u ? { user_id: u.id, email: u.email, full_name: u.fullName, role: u.role } : { user_id: id, email: null, full_name: null, role: null };
  }

  async get(user: CurrentUser, orgId: string) {
    const org = await this.orgFor(user, orgId);
    return {
      org_id: org.id,
      accountable_official: await this.userView(org.accountableOfficialUserId),
      governance_board: org.governanceBoard ?? [],
      history: [...(org.accountabilityHistory ?? [])].reverse(),
      can_edit: EDITORS.includes(user.role) && user.tenantId === orgId,
      // Candidates for the official, board members and model owners: active users of this org.
      members: (await this.users.find({ where: { tenantId: orgId, isActive: true }, order: { fullName: 'ASC' } })).map((u) => ({
        user_id: u.id, email: u.email, full_name: u.fullName, role: u.role,
      })),
    };
  }

  /** Is `user` the organisation's accountable official? (used for executive sign-off). */
  async isAccountableOfficial(orgId: string | null, userId: string): Promise<boolean> {
    if (!orgId) return false;
    const org = await this.orgs.findOne({ where: { id: orgId } });
    return Boolean(org?.accountableOfficialUserId) && org!.accountableOfficialUserId === userId;
  }

  async update(
    user: CurrentUser,
    orgId: string,
    body: { accountable_official_user_id?: string | null; governance_board?: Array<{ user_id?: string | null; name: string; title?: string | null }>; reason?: string },
  ) {
    const org = await this.orgFor(user, orgId);
    if (!EDITORS.includes(user.role) || user.tenantId !== orgId) {
      throw new ForbiddenException('Only the Owner or CISO of this organization can change accountability');
    }
    const reason = (body.reason ?? '').trim();
    if (reason.length < 5) throw new BadRequestException('A reason (at least 5 characters) is required');
    const before = { accountable_official_user_id: org.accountableOfficialUserId, governance_board: org.governanceBoard ?? [] };

    if (body.accountable_official_user_id !== undefined) {
      if (body.accountable_official_user_id) {
        const u = await this.users.findOne({ where: { id: body.accountable_official_user_id } });
        if (!u || u.tenantId !== orgId || !u.isActive) throw new BadRequestException('The accountable official must be an active user of this organization');
      }
      org.accountableOfficialUserId = body.accountable_official_user_id || null;
    }
    if (body.governance_board !== undefined) {
      if (!Array.isArray(body.governance_board)) throw new BadRequestException('governance_board must be a list');
      const board: Array<{ user_id: string | null; name: string; title: string | null }> = [];
      for (const m of body.governance_board) {
        const name = String(m?.name ?? '').trim();
        if (!name) throw new BadRequestException('Every board member needs a name');
        if (m.user_id) {
          const u = await this.users.findOne({ where: { id: m.user_id } });
          if (!u || u.tenantId !== orgId) throw new BadRequestException(`Board member ${name} is not a user of this organization`);
        }
        board.push({ user_id: m.user_id ?? null, name: name.slice(0, 200), title: m.title ? String(m.title).slice(0, 200) : null });
      }
      org.governanceBoard = board;
    }
    const after = { accountable_official_user_id: org.accountableOfficialUserId, governance_board: org.governanceBoard ?? [] };
    if (JSON.stringify(before) === JSON.stringify(after)) throw new BadRequestException('No changes');
    org.accountabilityHistory = [
      ...(org.accountabilityHistory ?? []),
      { changed_at: new Date().toISOString(), changed_by: user.email, changed_by_role: user.role, reason, from: before, to: after },
    ];
    org.updatedAt = new Date();
    await this.orgs.save(org);
    return this.get(user, orgId);
  }

  /** Owner register: every model in the organisation with its owner team and named owner. */
  async ownerRegister(user: CurrentUser, orgId: string) {
    await this.orgFor(user, orgId);
    const models = await this.models
      .createQueryBuilder('m')
      .innerJoin(ProjectEntity, 'p', 'p.id = m.projectId')
      .where('p.tenantId = :orgId AND m.isActive = 1', { orgId })
      .orderBy('m.name', 'ASC')
      .getMany();
    const ids = [...new Set(models.map((m) => m.ownerUserId).filter(Boolean))] as string[];
    const owners = new Map<string, any>();
    for (const id of ids) owners.set(id, await this.userView(id));
    return {
      org_id: orgId,
      models: models.map((m) => ({
        model_id: m.id,
        name: m.name,
        risk_level: m.riskLevel,
        lifecycle_stage: m.lifecycleStage,
        owner_team: m.ownerTeam,
        owner: m.ownerUserId ? owners.get(m.ownerUserId) : null,
      })),
      unowned: models.filter((m) => !m.ownerUserId).length,
    };
  }

  async setModelOwner(user: CurrentUser, modelId: string, ownerUserId: string | null, reason?: string) {
    assertFlag(this.flags, 'accountability');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (ownerUserId) {
      const u = await this.users.findOne({ where: { id: ownerUserId } });
      if (!u || !u.isActive || (orgId && u.tenantId !== orgId)) throw new BadRequestException('The owner must be an active user of the model’s organization');
    }
    const prev = model.ownerUserId;
    model.ownerUserId = ownerUserId || null;
    model.updatedAt = new Date();
    await this.models.save(model);
    await this.ledger.save({
      id: uuidv4(), modelId, eventType: 'OWNER_ASSIGNED',
      eventData: { from: prev, to: model.ownerUserId, reason: reason ?? null }, actor: user.email, occurredAt: new Date(),
    });
    return { model_id: modelId, owner: await this.userView(model.ownerUserId) };
  }
}
