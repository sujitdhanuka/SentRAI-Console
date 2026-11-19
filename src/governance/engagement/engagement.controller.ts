import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { EngagementService } from './engagement.service';

/** Organisational engagement records (E3.7). 404 unless GOV_E3_7_ORG_RECORDS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class EngagementController {
  constructor(private readonly e: EngagementService) {}

  @Get('engagement')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.e.list(user, q);
  }

  @Get('engagement/report')
  report(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.e.report(user, q);
  }

  @Get('engagement/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.e.get(user, id);
  }

  @Post('engagement')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.e.create(user, body, req);
  }
}
