import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { EnergyService } from './energy.service';

/** Energy and emissions (E3.5). 404 unless GOV_E3_5_ENERGY is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class EnergyController {
  constructor(private readonly e: EnergyService) {}

  @Get('energy')
  overview(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.e.overview(user, q);
  }

  @Get('energy/gpu')
  @Roles(...MAINTAINERS)
  gpu() {
    return this.e.gpuNow();
  }

  @Get('models/:id/energy')
  forModel(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.e.forModel(user, id);
  }

  @Post('models/:id/energy')
  @Roles(...MAINTAINERS)
  record(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.e.record(user, id, body, req);
  }
}
