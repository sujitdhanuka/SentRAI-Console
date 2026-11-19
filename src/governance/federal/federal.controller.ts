import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { OFFICERS } from '../phase2-util';
import { FederalVendorService } from './federal.service';

/** Federal-vendor support (E3.8). 404 unless GOV_E3_8_FEDERAL_VENDOR is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class FederalVendorController {
  constructor(private readonly f: FederalVendorService) {}

  @Get('external-ai')
  policy(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.f.policy(user, q);
  }

  @Get('ai-attestations')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.f.list(user, q);
  }

  @Post('ai-attestations')
  @Roles(...OFFICERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.f.create(user, body, req);
  }

  @Post('ai-attestations/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  revoke(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.f.revoke(user, id, req);
  }

  /** POST so the audit ledger records every export (GETs are not audited). */
  @Post('org-export')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  async export(@CurrentUser() user: CurrentUserType, @Body() q: Record<string, string>, @Req() req: any, @Res() res: Response): Promise<void> {
    const f = await this.f.exportOrg(user, q, req);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.body);
  }
}
