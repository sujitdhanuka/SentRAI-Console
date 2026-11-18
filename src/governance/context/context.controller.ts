import { Body, Controller, Get, Param, Patch, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { RISK_WRITERS } from '../risks/risks.service';
import { ContextProfileService } from './context.service';
import { ActingOrgInterceptor } from '../acting-org.interceptor';

/** Model context profile (E1.5). 404 unless GOV_E1_5_CONTEXT is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/inventory/models/:modelId/context')
export class ContextProfileController {
  constructor(private readonly ctx: ContextProfileService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.ctx.get(user, modelId);
  }

  @Patch()
  @Roles(...RISK_WRITERS)
  update(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.ctx.update(user, modelId, body);
  }
}
