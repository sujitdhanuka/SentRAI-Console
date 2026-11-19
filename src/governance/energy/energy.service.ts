/**
 * Energy and emissions per model (E3.5): readings from GPU power samples
 * (posted by an agent, or nvidia-smi CSV logs) or a metered figure, summed
 * on the model as kWh and kg CO2e with the organisation's grid factor.
 * Shown on the transparency card and in the transparency statement.
 */
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, EnergyReadingEntity, ProjectEntity } from '../../database/entities';
import { getGpuPower } from '../../monitoring/gpu-monitor';
import { assertFlag, modelForUser } from '../governance-access';
import { addCardFields, addModelFacts } from '../hooks';
import { MAINTAINERS, oneOf, optDate, optText, orgFor, orgModels, requireRole } from '../phase2-util';
import { GovernanceSettingsService } from '../settings/settings.service';
import { co2eKg, DEFAULT_GRID_FACTORS, DEFAULT_MAX_GAP_S, integrateKwh, parseNvidiaSmiCsv, parseSamples, PowerSample, round } from './energy.model';

@Injectable()
export class EnergyService implements OnModuleInit {
  constructor(
    @InjectRepository(EnergyReadingEntity) private readonly readings: Repository<EnergyReadingEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('energy')) return undefined;
      const last = await this.readings.findOne({ where: { modelId }, order: { periodEnd: 'DESC' } });
      const m = await this.models.findOne({ where: { id: modelId }, select: ['id', 'energyKwh', 'co2eKg'] });
      return { energy: { kwh: m?.energyKwh ?? null, co2eKg: m?.co2eKg ?? null, lastReadingAt: last?.periodEnd?.toISOString() ?? null, maxAgeDays: 365 } };
    });
    addCardFields(async (modelId) => {
      if (!this.flags.isEnabled('energy')) return undefined;
      const m = await this.models.findOne({ where: { id: modelId }, select: ['id', 'energyKwh', 'co2eKg'] });
      if (m?.energyKwh === null || m?.energyKwh === undefined) return undefined;
      const last = await this.readings.findOne({ where: { modelId }, order: { periodEnd: 'DESC' } });
      return { energy: { kwh: round(m.energyKwh, 3), co2e_kg: round(m.co2eKg ?? 0, 3), last_measured: last?.periodEnd?.toISOString().slice(0, 10) ?? null } };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'energy');
  }

  /** The grid factor in force: the organisation's setting, else its jurisdiction's default. */
  async gridFactor(orgId: string): Promise<{ value: number; source: string }> {
    const s = (await this.settings.inForce(orgId)).settings;
    if (typeof s.energy?.gridFactorKgPerKwh === 'number') return { value: s.energy.gridFactorKgPerKwh, source: 'settings' };
    const j = s.primaryJurisdiction ?? 'INTL';
    return { value: DEFAULT_GRID_FACTORS[j] ?? DEFAULT_GRID_FACTORS.INTL, source: `default for ${j}` };
  }

  private view(r: EnergyReadingEntity) {
    return {
      reading_id: r.id, model_id: r.modelId, period_start: r.periodStart, period_end: r.periodEnd, kwh: round(r.kwh), grid_factor: r.gridFactor,
      co2e_kg: round(r.co2eKg), source: r.source, sample_count: r.sampleCount, note: r.note, recorded_by: r.recordedBy, created_at: r.createdAt,
    };
  }

  async forModel(user: CurrentUser, modelId: string) {
    this.assert();
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const rows = await this.readings.find({ where: { modelId }, order: { periodEnd: 'DESC' }, take: 200 });
    return {
      model_id: modelId, kwh: model.energyKwh ?? null, co2e_kg: model.co2eKg ?? null,
      grid_factor: orgId ? await this.gridFactor(orgId) : null, readings: rows.map((r) => this.view(r)),
    };
  }

  async overview(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const models = await orgModels(this.models, this.projects, orgId);
    const measured = models.filter((m) => m.energyKwh !== null && m.energyKwh !== undefined);
    return {
      org_id: orgId, grid_factor: await this.gridFactor(orgId),
      totals: { kwh: round(measured.reduce((a, m) => a + (m.energyKwh ?? 0), 0), 3), co2e_kg: round(measured.reduce((a, m) => a + (m.co2eKg ?? 0), 0), 3), systems_measured: measured.length, systems: models.length },
      models: models.map((m) => ({ model_id: m.id, name: m.name, kwh: m.energyKwh ?? null, co2e_kg: m.co2eKg ?? null })),
    };
  }

  /** Current GPU power draw on this server (empty without nvidia-smi). */
  gpuNow() {
    this.assert();
    return { gpus: getGpuPower() };
  }

  async record(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record energy readings');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    const source = oneOf(body.source, ['SAMPLES', 'NVIDIA_SMI', 'METERED'] as const, 'source');
    let kwh: number;
    let periodStart: Date;
    let periodEnd: Date;
    let count = 0;
    let note = optText(body.note, 'note', 500);
    if (source === 'METERED') {
      kwh = Number(body.kwh);
      if (body.kwh === null || body.kwh === '' || !Number.isFinite(kwh) || kwh < 0 || kwh > 1e9) throw new BadRequestException('kwh must be a number from 0 to 1,000,000,000');
      const s = optDate(body.period_start, 'period_start');
      const e = optDate(body.period_end, 'period_end');
      if (!s || !e || s >= e) throw new BadRequestException('A metered reading needs period_start before period_end');
      periodStart = s;
      periodEnd = e;
    } else {
      let samples: PowerSample[];
      try {
        samples = source === 'SAMPLES' ? parseSamples(body.samples) : parseNvidiaSmiCsv(body.csv);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const maxGap = body.max_gap_seconds === undefined ? DEFAULT_MAX_GAP_S : Number(body.max_gap_seconds);
      if (!Number.isFinite(maxGap) || maxGap < 1 || maxGap > 3600) throw new BadRequestException('max_gap_seconds must be 1 to 3600');
      const r = integrateKwh(samples, maxGap);
      kwh = r.kwh;
      count = samples.length;
      periodStart = samples[0].at;
      periodEnd = samples[samples.length - 1].at;
      if (r.gaps) note = [note, `${r.gaps} gap(s) longer than ${maxGap}s not counted`].filter(Boolean).join('; ');
    }
    if (periodEnd.getTime() > Date.now() + 60_000) throw new BadRequestException('Readings cannot be in the future');
    // The same period cannot be counted twice.
    const overlap = await this.readings
      .createQueryBuilder('r')
      .where('r.modelId = :modelId AND r.periodStart < :end AND r.periodEnd > :start', { modelId, start: periodStart, end: periodEnd })
      .getCount();
    if (overlap) throw new BadRequestException('This period overlaps a reading already recorded for the model');
    const factor = body.grid_factor !== undefined ? Number(body.grid_factor) : (await this.gridFactor(orgId)).value;
    if (!Number.isFinite(factor) || factor < 0 || factor > 2) throw new BadRequestException('grid_factor must be 0 to 2 kg CO2e per kWh');
    const row = await this.readings.save(this.readings.create({
      id: uuidv4(), orgId, modelId, periodStart, periodEnd, kwh, gridFactor: factor, co2eKg: co2eKg(kwh, factor), source, sampleCount: count,
      note, recordedBy: user.email, createdAt: new Date(),
    }));
    await this.recompute(modelId);
    if (req) req.auditSummary = { energy_recorded: { model_id: modelId, kwh: round(kwh), source } };
    return this.view(row);
  }

  private async recompute(modelId: string): Promise<void> {
    const sum = await this.readings
      .createQueryBuilder('r')
      .select('SUM(r.kwh)', 'kwh')
      .addSelect('SUM(r.co2eKg)', 'co2e')
      .where('r.modelId = :modelId', { modelId })
      .getRawOne<{ kwh: number | string | null; co2e: number | string | null }>();
    await this.models.update({ id: modelId }, { energyKwh: sum?.kwh === null || sum?.kwh === undefined ? null : Number(sum.kwh), co2eKg: sum?.co2e === null || sum?.co2e === undefined ? null : Number(sum.co2e) });
  }
}
