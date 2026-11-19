import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { TevvService } from './tevv.service';

/** TEVV register and retirement workflow (E3.4). 404 unless GOV_E3_4_TEVV is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class TevvController {
  constructor(private readonly t: TevvService) {}

  @Get('tevv')
  overview(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.t.overview(user, q);
  }

  @Get('models/:id/test-sets')
  sets(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.t.listForModel(user, id);
  }

  @Post('models/:id/test-sets')
  @Roles(...MAINTAINERS)
  createSet(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.createSet(user, id, body, req);
  }

  @Patch('test-sets/:id')
  @Roles(...MAINTAINERS)
  updateSet(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.updateSet(user, id, body, req);
  }

  @Get('test-sets/:id/runs')
  runs(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.t.runsFor(user, id);
  }

  @Post('test-sets/:id/runs')
  @Roles(...MAINTAINERS)
  run(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.recordRun(user, id, body, req);
  }

  @Post('test-sets/:id/review')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  review(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.review(user, id, body, req);
  }

  @Get('models/:id/retirement')
  retirement(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.t.retirementFor(user, id);
  }

  @Post('models/:id/retirement')
  @Roles(...MAINTAINERS)
  request(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.requestRetirement(user, id, body, req);
  }

  @Post('retirements/:id/decide')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  decide(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.decide(user, id, body, req);
  }

  @Post('retirements/:id/checklist')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  checklist(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.checklistItem(user, id, body, req);
  }

  @Post('retirements/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  complete(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.t.complete(user, id, req);
  }

  @Post('retirements/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  cancel(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.t.cancel(user, id, req);
  }
}
