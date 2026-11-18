import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ViewerWritable } from '../../common/decorators/viewer-writable.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { TrainingService } from './training.service';

/** AI training and literacy (E2.6). 404 unless GOV_E2_6_TRAINING is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/training')
export class TrainingController {
  constructor(private readonly t: TrainingService) {}

  @Get('catalogue')
  catalogue() {
    return this.t.catalogue();
  }

  @Get('courses')
  courses(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.t.listCourses(user, q);
  }

  @Post('courses')
  @Roles(...OFFICERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.createCourse(user, body, req);
  }

  @Patch('courses/:id')
  @Roles(...OFFICERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.updateCourse(user, id, body, req);
  }

  @Post('courses/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  // Every member, viewers included, acknowledges policies for themselves (writes only their own record).
  @ViewerWritable()
  acknowledge(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.t.acknowledge(user, id, req);
  }

  @Get('records')
  records(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.t.listRecords(user, q);
  }

  @Post('records')
  @Roles(...MAINTAINERS)
  record(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.t.record(user, body, req);
  }

  @Get('matrix')
  matrix(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.t.matrixView(user, q);
  }

  @Get('matrix.csv')
  async exportMatrix(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    const csv = await this.t.exportMatrix(user, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="training-matrix.csv"');
    res.send(csv);
  }

  @Get('user-status')
  userStatus(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.t.userStatus(user, q);
  }
}
