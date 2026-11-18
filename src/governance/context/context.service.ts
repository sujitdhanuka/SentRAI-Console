/** Model context profile API (E1.5). 404 unless GOV_E1_5_CONTEXT is on. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { emitModelEvent } from '../hooks';
import { contextView, DTA_USAGE_PATTERNS, missingFields, OVERSIGHT_PATTERNS, parseContextProfile, suggestContext } from './context-profile';

@Injectable()
export class ContextProfileService {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly flags: FeatureFlagsService,
  ) {}

  async get(user: CurrentUser, modelId: string) {
    assertFlag(this.flags, 'contextProfile');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    return {
      model_id: modelId,
      profile: contextView(model.contextProfile as any),
      missing: missingFields(model.contextProfile as any),
      options: { oversight_patterns: OVERSIGHT_PATTERNS, dta_usage_patterns: DTA_USAGE_PATTERNS },
      suggestion: { source: 'derived', profile: contextView(suggestContext(model)) },
    };
  }

  async update(user: CurrentUser, modelId: string, body: Record<string, any>) {
    assertFlag(this.flags, 'contextProfile');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    let patch;
    try {
      patch = parseContextProfile(body ?? {});
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (!Object.keys(patch).length) throw new BadRequestException('No context fields given');
    const before = model.contextProfile ?? {};
    const next = { ...before, ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete (next as any)[k];
    model.contextProfile = next;
    model.updatedAt = new Date();
    await this.models.save(model);
    await this.ledger.save({
      id: uuidv4(), modelId, eventType: 'CONTEXT_PROFILE_UPDATED',
      eventData: { fields: Object.keys(patch) }, actor: user.email, occurredAt: new Date(),
    });
    // A changed context invalidates a signed impact assessment (E1.4).
    await emitModelEvent(modelId, 'CONTEXT_CHANGED', { ref: Object.keys(patch).join(', ') });
    return this.get(user, modelId);
  }
}
