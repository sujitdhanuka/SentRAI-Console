import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BcpStateEntity } from '../database/entities';
import { BCPFallbackState } from '../domain/monitoring';

/**
 * DB-backed BCP fallback state, keyed by model id. Persisted so a process
 * restart can never silently un-trip a circuit breaker (REC 21).
 */
@Injectable()
export class BcpStateStore {
  constructor(
    @InjectRepository(BcpStateEntity) private readonly repo: Repository<BcpStateEntity>,
  ) {}

  private toDomain(row: BcpStateEntity): BCPFallbackState {
    return {
      modelId: row.modelId,
      fallbackActive: row.fallbackActive,
      fallbackReason: row.fallbackReason,
      fallbackActivatedAt: row.fallbackActivatedAt,
      rulesEngineRef: row.rulesEngineRef,
      drillLastConducted: row.drillLastConducted,
      humanSamplePct: row.humanSamplePct,
    };
  }

  async get(modelId: string): Promise<BCPFallbackState | undefined> {
    const row = await this.repo.findOne({ where: { modelId } });
    return row ? this.toDomain(row) : undefined;
  }

  async save(state: BCPFallbackState): Promise<void> {
    await this.repo.save(this.repo.create({
      modelId: state.modelId,
      fallbackActive: state.fallbackActive,
      fallbackReason: state.fallbackReason,
      fallbackActivatedAt: state.fallbackActivatedAt,
      rulesEngineRef: state.rulesEngineRef,
      drillLastConducted: state.drillLastConducted,
      humanSamplePct: state.humanSamplePct,
    }));
  }

  async getOrCreate(modelId: string): Promise<BCPFallbackState> {
    const existing = await this.get(modelId);
    if (existing) return existing;
    const fresh: BCPFallbackState = {
      modelId,
      fallbackActive: false,
      fallbackReason: '',
      fallbackActivatedAt: null,
      rulesEngineRef: null,
      drillLastConducted: null,
      humanSamplePct: 0.01,
    };
    await this.save(fresh);
    return fresh;
  }
}
