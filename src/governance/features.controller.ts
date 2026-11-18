import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { FeatureFlagsService } from '../common/feature-flags';
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
    return this.flags.flags;
  }
}
