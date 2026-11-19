import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { DisclosuresService } from './disclosures.service';

const send = (res: Response, f: { body: Buffer | string; type: string; filename: string }) => {
  res.setHeader('Content-Type', f.type);
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.send(f.body);
};

/** Disclosures and regulator exports (E3.2). 404 unless GOV_E3_2_DISCLOSURES is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class DisclosuresController {
  constructor(private readonly d: DisclosuresService) {}

  @Get('disclosures')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.list(user, q);
  }

  @Post('disclosures')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.create(user, body, req);
  }

  @Get('disclosures/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.d.get(user, id);
  }

  @Get('disclosures/:id/export')
  async export(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Query('format') format: string, @Res() res: Response): Promise<void> {
    send(res, await this.d.exportOne(user, id, (format ?? 'pdf').toLowerCase()));
  }

  @Patch('disclosures/:id')
  @Roles(...MAINTAINERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.update(user, id, body, req);
  }

  @Post('disclosures/:id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  publish(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.publish(user, id, body, req);
  }

  @Post('disclosures/:id/notifications')
  @Roles(...MAINTAINERS)
  notify(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.notify(user, id, body, req);
  }

  @Get('exports/rbi-inspection')
  async rbi(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    send(res, await this.d.regulatorExport(user, 'rbi-inspection', q));
  }

  @Get('exports/omb-inventory')
  async omb(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    send(res, await this.d.regulatorExport(user, 'omb-inventory', q));
  }

  @Get('models/:id/deployers')
  deployers(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.d.listDeployers(user, id);
  }

  @Post('models/:id/deployers')
  @Roles(...MAINTAINERS)
  addDeployer(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.addDeployer(user, id, body, req);
  }

  @Patch('deployers/:id')
  @Roles(...MAINTAINERS)
  updateDeployer(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.updateDeployer(user, id, body, req);
  }
}
