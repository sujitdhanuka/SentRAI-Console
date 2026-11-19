import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { OFFICERS } from '../phase2-util';
import { SoaService } from './soa.service';

/** ISO 42001 Statement of Applicability (E3.1). 404 unless GOV_E3_1_SOA is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/soa')
export class SoaController {
  constructor(private readonly soa: SoaService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.soa.get(user, q);
  }

  @Get('versions')
  versions(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.soa.versions(user, q);
  }

  @Get('versions/:version')
  version(@CurrentUser() user: CurrentUserType, @Param('version', ParseIntPipe) version: number, @Query() q: Record<string, string>) {
    return this.soa.version(user, version, q);
  }

  @Get('export')
  async export(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    const f = await this.soa.export(user, q);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.body);
  }

  @Post('approve')
  @Roles(...OFFICERS)
  approve(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.soa.approve(user, body, req);
  }

  @Put(':ref')
  @Roles(...OFFICERS)
  update(@CurrentUser() user: CurrentUserType, @Param('ref') ref: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.soa.update(user, ref, body, req);
  }
}
