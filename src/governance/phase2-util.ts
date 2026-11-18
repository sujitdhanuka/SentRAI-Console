/**
 * Small helpers shared by the Phase 2 governance services (E2.1 to E2.8):
 * input parsing, organisation scoping and the role sets that may write.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { In, Repository } from 'typeorm';

import { Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { AIModelEntity, ProjectEntity, UserEntity } from '../database/entities';
import { orgScope } from './governance-access';
import { resolveForPacks } from './packs/pack-engine';
import { packRegistry } from './packs/pack-loader';
import type { PacksService } from './packs/packs.service';

export const DAY_MS = 86_400_000;

/** Governance officers: may change registers that carry legal weight. */
export const OFFICERS: Role[] = [Role.OWNER, Role.CISO, Role.ADMIN];
/** Everyone who maintains governance records day to day. */
export const MAINTAINERS: Role[] = [Role.OWNER, Role.CISO, Role.ADMIN, Role.APPROVER, Role.REVIEWER];

export function requireRole(user: CurrentUser, roles: Role[], what: string): void {
  if (!roles.includes(user.role)) throw new ForbiddenException(`Only ${roles.join(', ')} can ${what}`);
}

/** An optional date; '' and null clear it. Throws 400 on a bad value. */
export function optDate(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a date`);
  return d;
}

/** Required trimmed text of at least `min` characters, capped at `max`. */
export function reqText(v: unknown, field: string, min = 1, max = 4000): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new BadRequestException(min > 1 ? `${field} needs at least ${min} characters` : `${field} is required`);
  return s.slice(0, max);
}

/** Optional trimmed text, or null. */
export function optText(v: unknown, field: string, max = 4000): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new BadRequestException(`${field} must be text`);
  return v.trim().slice(0, max) || null;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const s = String(v ?? '').toUpperCase();
  if (!(allowed as readonly string[]).includes(s)) throw new BadRequestException(`${field} must be one of ${allowed.join(', ')}`);
  return s as T;
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/** The organisation a request acts on (caller's own; ADMIN may name one). */
export function orgFor(user: CurrentUser, requested?: string | null): string {
  return orgScope(user, requested);
}

/** Active models in an organisation (through their project's tenant). */
export async function orgModels(models: Repository<AIModelEntity>, projects: Repository<ProjectEntity>, orgId: string): Promise<AIModelEntity[]> {
  const projectIds = (await projects.find({ where: { tenantId: orgId }, select: ['id'] })).map((p) => p.id);
  if (!projectIds.length) return [];
  return models.find({ where: { projectId: In(projectIds), isActive: true }, order: { name: 'ASC' } });
}

/** The organisation that owns a model, or null. */
export async function orgOfModel(models: Repository<AIModelEntity>, projects: Repository<ProjectEntity>, modelId: string): Promise<string | null> {
  const m = await models.findOne({ where: { id: modelId }, select: ['id', 'projectId'] });
  if (!m?.projectId) return null;
  const p = await projects.findOne({ where: { id: m.projectId } });
  return p?.tenantId ?? null;
}

/** A user of the organisation, or 400. */
export async function orgMember(users: Repository<UserEntity>, orgId: string, userId: unknown, field: string): Promise<UserEntity> {
  if (!userId || typeof userId !== 'string') throw new BadRequestException(`${field} is required`);
  const u = await users.findOne({ where: { id: userId } });
  if (!u || u.tenantId !== orgId || !u.isActive) throw new BadRequestException(`${field} must be an active member of the organization`);
  return u;
}

/** Stable CSV cell. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: Array<{ key: string; label: string }>, rows: Array<Record<string, any>>): string {
  return [headers.map((h) => csvCell(h.label)).join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h.key])).join(','))].join('\r\n') + '\r\n';
}

/** Resolved parameters (packs in force for the org plus its settings, strictest wins). */
export async function orgParams(packs: PacksService, orgId: string | null, at = new Date()): Promise<Record<string, any>> {
  const ctx = await packs.contextFor(orgId, at);
  return resolveForPacks(packRegistry().activeAt(at).filter((p) => ctx.packIds.includes(p.definition.id)), ctx.extraSources).values;
}

/** Whether a pack applies to an organisation (enabled in its settings, or a default pack). */
export async function packApplies(packs: PacksService, orgId: string | null, packId: string, at = new Date()): Promise<boolean> {
  return (await packs.contextFor(orgId, at)).packIds.includes(packId);
}

/** The caller's user row id. The JWT's userId is the email in this codebase, so look the row up by email. */
export async function selfUserId(users: Repository<UserEntity>, user: CurrentUser): Promise<string | null> {
  const u = await users.findOne({ where: { email: user.email }, select: ['id'] });
  return u?.id ?? null;
}
