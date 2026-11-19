import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { AiSecurityService } from './ai-security.service';

/** AI security (E3.6). 404 unless GOV_E3_6_AI_SECURITY is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class AiSecurityController {
  constructor(private readonly s: AiSecurityService) {}

  @Get('security')
  overview(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.s.overview(user, q);
  }

  @Get('security/template')
  template() {
    return this.s.template();
  }

  @Get('models/:id/security')
  forModel(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.s.forModel(user, id);
  }

  @Post('models/:id/threat-model')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.s.createThreatModel(user, id, req);
  }

  @Put('threat-models/:id')
  @Roles(...MAINTAINERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.s.updateThreatModel(user, id, body, req);
  }

  @Post('threat-models/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  approve(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.s.approve(user, id, req);
  }

  @Post('models/:id/security-evals')
  @Roles(...MAINTAINERS)
  evaluate(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.s.recordEvaluation(user, id, body, req);
  }
}
