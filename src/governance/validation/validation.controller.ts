import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { ValidationService } from './validation.service';

/** Model validation (E2.3, SR 26-2). 404 unless GOV_E2_3_VALIDATION is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class ValidationController {
  constructor(private readonly v: ValidationService) {}

  @Put('models/:modelId/mrm-scope')
  @Roles(...MAINTAINERS)
  scope(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.setScope(user, modelId, body, req);
  }

  @Get('validations/aggregate')
  aggregate(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.v.aggregate(user, q);
  }

  @Get('validations')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.v.list(user, q);
  }

  @Get('validations/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.v.get(user, id);
  }

  @Post('validations')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.v.create(user, body);
  }

  @Patch('validations/:id')
  @Roles(...MAINTAINERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.v.update(user, id, body);
  }

  @Post('validations/:id/findings')
  @Roles(...MAINTAINERS)
  finding(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.v.addFinding(user, id, body);
  }

  @Post('validations/:id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.complete(user, id, body, req);
  }

  @Post('validations/:id/exception')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  exception(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.exception(user, id, body, req);
  }
}
