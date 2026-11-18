import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { DecisionsService } from './decisions.service';

/** US adverse-action and reconsideration kit (E2.2). 404 unless GOV_E2_2_US_KIT is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class DecisionsController {
  constructor(private readonly d: DecisionsService) {}

  @Get('models/:modelId/reason-codes')
  reasonCodes(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.d.getReasonCodes(user, modelId);
  }

  @Put('models/:modelId/reason-codes')
  @Roles(...MAINTAINERS)
  putReasonCodes(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.putReasonCodes(user, modelId, body, req);
  }

  @Get('decisions/:ref')
  decision(@CurrentUser() user: CurrentUserType, @Param('ref') ref: string, @Query() q: Record<string, string>) {
    return this.d.decision(user, ref, q);
  }

  @Post('decisions/:ref/notices')
  @Roles(...MAINTAINERS)
  notice(@CurrentUser() user: CurrentUserType, @Param('ref') ref: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.createNotice(user, ref, body, req);
  }

  @Get('notices')
  notices(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.listNotices(user, q);
  }

  @Post('grievances/:id/link-decision')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  link(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.d.linkDecision(user, id, body);
  }

  /** Appeal after rejection, or a reconsideration / data-correction request (body.type). */
  @Post('grievances/:id/appeal')
  @Roles(...MAINTAINERS)
  appeal(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.d.requestFromGrievance(user, id, body);
  }

  @Post('grievances/:id/reconsider')
  @Roles(...MAINTAINERS)
  reconsider(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.d.requestFromGrievance(user, id, { ...body, type: body.type ?? 'RECONSIDERATION' });
  }

  @Get('appeals')
  appeals(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.listAppeals(user, q);
  }

  @Post('appeals/:id/decide')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  decide(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.decide(user, id, body, req);
  }

  /** Public consumer path: reconsideration, data correction or appeal on a decision. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/decisions/:modelId/requests')
  publicRequest(@Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.d.publicRequest(modelId, body);
  }
}
