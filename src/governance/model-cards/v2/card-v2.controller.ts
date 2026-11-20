import { Body, Controller, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../../acting-org.interceptor';
import { OFFICERS } from '../../phase2-util';
import { CardV2MigrationService } from './migration/card-v2-migration.service';

/** Model card v2. 404 unless GOV_E4_2_MODEL_CARD_V2 is on (it is on by default under GOVERNANCE_V2). */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class CardV2Controller {
  constructor(private readonly migration: CardV2MigrationService) {}

  /**
   * Migrate the organisation's v1 records to v2 cards. A dry run unless
   * `dry_run=false` is passed: the dry run reports what would change per
   * record and writes nothing. Officers only; ADMIN names the org with ?org_id=.
   */
  @Post('model-cards/v2/migrate-v1')
  @Roles(...OFFICERS)
  migrate(@CurrentUser() user: CurrentUserType, @Query('dry_run') dryRun?: string, @Query('org_id') orgId?: string, @Body() _body?: unknown) {
    return this.migration.migrate(user, { orgId: orgId ?? null, dryRun: dryRun !== 'false' });
  }
}
