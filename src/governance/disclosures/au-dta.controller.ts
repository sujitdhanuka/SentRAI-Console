import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { AuDtaService } from './au-dta.service';

/** Australia pack (E2.1): DTA register, export, share and high-risk report records, in-scope tracker. 404 unless GOV_E2_1_AU_PACK is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class AuDtaController {
  constructor(private readonly au: AuDtaService) {}

  @Get('au/register')
  register(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.au.register(user, q);
  }

  /** GET /governance/exports/dta-register?format=csv|xlsx */
  @Get('exports/dta-register')
  async exportRegister(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    const file = await this.au.exportRegister(user, q);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  @Post('exports/dta-register/share')
  @Roles(...OFFICERS)
  share(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.au.recordShare(user, body, req);
  }

  @Get('au/submissions')
  submissions(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.au.submissionsList(user, q);
  }

  @Post('models/:modelId/dta-report')
  recordReport(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.au.recordHighRiskReport(user, modelId, body, req);
  }

  @Get('au/in-scope')
  inScope(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.au.inScopeTracker(user, q);
  }

  @Post('au/in-scope/bulk-start')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  bulkStart(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.au.bulkStart(user, body);
  }

  @Get('au/reference')
  reference() {
    return this.au.reference();
  }
}
