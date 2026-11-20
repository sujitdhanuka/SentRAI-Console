import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';

import { NotifierService } from '../common/notifier.service';
import { Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { LeadEntity } from '../database/entities';
import { BookDemoDto, ContactDto, LeadUpdateDto } from './leads.dto';
import { generateSlots, parseSlotConfig, SlotConfig } from './demo-slots';

const ACTIVE_DEMO = ['NEW', 'CONFIRMED'];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);
  private readonly cfg: SlotConfig;

  constructor(
    @InjectRepository(LeadEntity) private readonly leads: Repository<LeadEntity>,
    private readonly notifier: NotifierService,
    config: ConfigService,
  ) {
    this.cfg = parseSlotConfig((k) => config.get<string>(k) ?? process.env[k]);
  }

  /** Open demo slots in the next window, grouped by the sales team's local date. */
  async slots() {
    const days = generateSlots(this.cfg);
    const first = days[0]?.slots[0];
    const booked = first
      ? await this.leads.find({ where: { kind: 'demo', status: In(ACTIVE_DEMO), slotStart: MoreThanOrEqual(first) }, select: ['slotStart'] })
      : [];
    const taken = new Set(booked.map((b) => b.slotStart && new Date(b.slotStart).getTime()));
    return {
      timezone: this.cfg.timezone,
      slot_minutes: this.cfg.slotMinutes,
      days: days.map((d) => ({
        date: d.date,
        weekday: d.weekday,
        slots: d.slots.map((s) => ({ start: s.toISOString(), available: !taken.has(s.getTime()) })),
      })),
    };
  }

  async contact(dto: ContactDto) {
    if (dto.website) return { id: uuid(), received: true }; // honeypot: pretend success
    const lead = await this.save({
      kind: 'contact', name: dto.name.trim(), email: dto.email.trim().toLowerCase(), company: dto.company?.trim() || null,
      topic: dto.topic ?? 'general', message: dto.message.trim(), status: 'NEW',
    });
    void this.notifier.notify('lead.contact_received', {
      lead_id: lead.id, name: lead.name, email: lead.email, company: lead.company, topic: lead.topic,
      message: lead.message?.slice(0, 500), review_at: '/dashboard/#/leads',
    });
    this.logger.log(`contact message received lead=${lead.id} topic=${lead.topic}`);
    return { id: lead.id, received: true };
  }

  async bookDemo(dto: BookDemoDto) {
    const start = new Date(dto.slot_start);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('slot_start is not a valid date.');
    if (dto.website) return { id: uuid(), slot_start: start.toISOString(), slot_minutes: this.cfg.slotMinutes };
    const offered = generateSlots(this.cfg).some((d) => d.slots.some((s) => s.getTime() === start.getTime()));
    if (!offered) throw new BadRequestException('That time is not an available demo slot. Please pick another.');
    const clash = await this.leads.findOne({ where: { kind: 'demo', status: In(ACTIVE_DEMO), slotStart: start } });
    if (clash) throw new ConflictException('Sorry, that slot was just booked. Please pick another time.');
    const tz = dto.timezone && this.validTz(dto.timezone) ? dto.timezone : null;
    const lead = await this.save({
      kind: 'demo', name: dto.name.trim(), email: dto.email.trim().toLowerCase(), company: dto.company.trim(),
      jobRole: dto.role?.trim() || null, message: dto.message?.trim() || null, slotStart: start,
      slotMinutes: this.cfg.slotMinutes, visitorTimezone: tz, status: 'NEW',
    });
    void this.notifier.notify('lead.demo_booked', {
      lead_id: lead.id, name: lead.name, email: lead.email, company: lead.company, role: lead.jobRole,
      slot_start: start.toISOString(), slot_minutes: this.cfg.slotMinutes,
      slot_local: this.fmt(start, this.cfg.timezone), visitor_timezone: tz, review_at: '/dashboard/#/leads',
    });
    this.logger.log(`demo booked lead=${lead.id} slot=${start.toISOString()}`);
    return { id: lead.id, slot_start: start.toISOString(), slot_minutes: this.cfg.slotMinutes, timezone: this.cfg.timezone };
  }

  // ── admin ──
  async list(user: CurrentUser, kind?: string, status?: string) {
    this.assertGlobalAdmin(user);
    const where: Record<string, unknown> = {};
    if (kind === 'contact' || kind === 'demo') where.kind = kind;
    if (status) where.status = status;
    const rows = await this.leads.find({ where, order: { createdAt: 'DESC' }, take: 500 });
    return rows.map((r) => this.view(r));
  }

  async summary(user: CurrentUser) {
    this.assertGlobalAdmin(user);
    const now = new Date();
    const [newContacts, newDemos, upcoming] = await Promise.all([
      this.leads.count({ where: { kind: 'contact', status: 'NEW' } }),
      this.leads.count({ where: { kind: 'demo', status: 'NEW' } }),
      this.leads.find({ where: { kind: 'demo', status: In(ACTIVE_DEMO), slotStart: MoreThanOrEqual(now) }, order: { slotStart: 'ASC' }, take: 1 }),
    ]);
    const upcomingCount = await this.leads.count({ where: { kind: 'demo', status: In(ACTIVE_DEMO), slotStart: MoreThanOrEqual(now) } });
    return {
      new_total: newContacts + newDemos, new_contacts: newContacts, new_demos: newDemos,
      upcoming_demos: upcomingCount, next_demo: upcoming[0] ? this.view(upcoming[0]) : null, timezone: this.cfg.timezone,
    };
  }

  async update(user: CurrentUser, id: string, dto: LeadUpdateDto) {
    this.assertGlobalAdmin(user);
    const lead = await this.leads.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found.');
    if (dto.status) {
      if (lead.kind === 'contact' && dto.status === 'CONFIRMED') throw new BadRequestException('Only demo bookings can be confirmed.');
      if (lead.kind === 'demo' && dto.status === 'CONFIRMED' && lead.slotStart) {
        const clash = await this.leads.findOne({ where: { kind: 'demo', status: In(ACTIVE_DEMO), slotStart: lead.slotStart, id: Not(lead.id) } });
        if (clash) throw new ConflictException('Another active booking holds this slot.');
      }
      lead.status = dto.status;
    }
    if (dto.admin_notes !== undefined) lead.adminNotes = dto.admin_notes.trim() || null;
    lead.handledBy = user.email;
    lead.updatedAt = new Date();
    await this.leads.save(lead);
    return this.view(lead);
  }

  private assertGlobalAdmin(user: CurrentUser) {
    if (user.role !== Role.ADMIN || user.tenantId) throw new ForbiddenException('Only a platform administrator can see leads.');
  }

  private async save(fields: Partial<LeadEntity>): Promise<LeadEntity> {
    const now = new Date();
    const lead = this.leads.create({
      id: uuid(), company: null, jobRole: null, topic: null, message: null, slotStart: null, slotMinutes: null,
      visitorTimezone: null, adminNotes: null, handledBy: null, createdAt: now, updatedAt: now, ...fields,
    } as LeadEntity);
    return this.leads.save(lead);
  }

  private validTz(tz: string) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
  }

  private fmt(d: Date, tz: string) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(d);
  }

  private view(r: LeadEntity) {
    return {
      lead_id: r.id, kind: r.kind, name: r.name, email: r.email, company: r.company, role: r.jobRole, topic: r.topic,
      message: r.message, slot_start: r.slotStart ? new Date(r.slotStart).toISOString() : null, slot_minutes: r.slotMinutes,
      visitor_timezone: r.visitorTimezone, status: r.status, admin_notes: r.adminNotes, handled_by: r.handledBy,
      created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(),
    };
  }
}
