import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { FairLendingService } from './fair-lending.service';

/** Fair-lending checks (E2.4). 404 unless GOV_E2_4_FAIR_LENDING is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/fair-lending/:modelId')
export class FairLendingController {
  constructor(private readonly f: FairLendingService) {}

  @Get()
  status(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.f.status(user, modelId);
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  scan(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.f.scan(user, modelId, body);
  }

  @Post('justify')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  justify(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.f.justify(user, modelId, body);
  }

  @Post('disparate-impact')
  @Roles(...MAINTAINERS)
  di(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.f.disparateImpact(user, modelId, body);
  }

  @Post('lda-search')
  @Roles(...MAINTAINERS)
  lda(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.f.ldaSearch(user, modelId, body);
  }
}
