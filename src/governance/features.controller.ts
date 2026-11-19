import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { FeatureFlagsService, PHASE2_FLAGS, PHASE3_FLAGS, PHASE4_FLAGS } from '../common/feature-flags';
import { ActingOrgInterceptor } from './acting-org.interceptor';

/**
 * Which governance features are switched on, so the console can show or hide
 * its governance pages. A new route only; no existing response changes.
 */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class GovernanceFeaturesController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('features')
  features() {
    const f = this.flags.flags;
    // With the master flag off the response keeps its pre-Phase 2 shape (the console treats a missing key as off).
    // Phase 3 keys are dropped the same way.
    if (f.governanceV2) return f;
    const out: Record<string, boolean> = { ...f };
    for (const k of [...PHASE2_FLAGS, ...PHASE3_FLAGS, ...PHASE4_FLAGS]) delete out[k];
    return out;
  }
}
