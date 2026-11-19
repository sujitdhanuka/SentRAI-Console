import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { IncidentExtensionsService } from './incident-ext.service';

/** Incident extensions and ITSM / SIEM integrations (E3.3). 404 unless GOV_E3_3_INCIDENTS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class IncidentExtensionsController {
  constructor(private readonly x: IncidentExtensionsService) {}

  @Get('incidents')
  queue(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.x.queue(user, q);
  }

  @Get('incidents/:id/extensions')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.x.get(user, id);
  }

  // Officers or the accountable official (checked in the service, which may be any role).
  @Post('incidents/:id/sign-off')
  @HttpCode(HttpStatus.OK)
  signOff(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.signOff(user, id, body, req);
  }

  @Post('incidents/:id/affected-notice')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  notice(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.affectedNotice(user, id, body, req);
  }

  @Post('incidents/:id/external-ticket')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  ticket(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.externalTicket(user, id, body, req);
  }

  @Post('incidents/:id/dta-notification')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  dta(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.dtaNotification(user, id, body, req);
  }

  @Post('incidents/:id/playbook')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  playbook(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.cisaPhase(user, id, body, req);
  }

  @Post('incidents/:id/push')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  push(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.x.push(user, id, req);
  }

  @Get('integrations')
  @Roles(...OFFICERS)
  integrations(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.x.listIntegrations(user, q);
  }

  @Get('integrations/deliveries')
  @Roles(...OFFICERS)
  deliveries(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.x.listDeliveries(user, q);
  }

  @Post('integrations')
  @Roles(...OFFICERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.createIntegration(user, body, req);
  }

  @Patch('integrations/:id')
  @Roles(...OFFICERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.x.updateIntegration(user, id, body, req);
  }

  @Post('integrations/:id/test')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  test(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.x.test(user, id);
  }
}
