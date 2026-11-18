import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { VendorsService } from './vendors.service';

/** Third-party AI risk and the AI bill of materials (E2.5). 404 unless GOV_E2_5_VENDORS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class VendorsController {
  constructor(private readonly v: VendorsService) {}

  @Get('vendors/checklist')
  checklist() {
    return this.v.checklist();
  }

  @Get('vendors/summary')
  summary(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.v.summary(user, q);
  }

  @Get('vendors')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.v.list(user, q);
  }

  @Post('vendors')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.create(user, body, req);
  }

  @Get('vendors/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.v.get(user, id);
  }

  @Patch('vendors/:id')
  @Roles(...MAINTAINERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.update(user, id, body, req);
  }

  @Post('vendors/:id/assessments')
  @Roles(...MAINTAINERS)
  assess(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.assess(user, id, body, req);
  }

  @Get('models/:modelId/bom')
  bom(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.v.modelBom(user, modelId);
  }

  @Post('models/:modelId/bom/sync')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  sync(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.v.syncBom(user, modelId);
  }

  @Post('models/:modelId/bom')
  @Roles(...MAINTAINERS)
  add(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.v.addItem(user, modelId, body);
  }

  @Patch('bom/:itemId')
  @Roles(...MAINTAINERS)
  updateItem(@CurrentUser() user: CurrentUserType, @Param('itemId') itemId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.v.updateItem(user, itemId, body, req);
  }

  @Delete('bom/:itemId')
  @Roles(...MAINTAINERS)
  remove(@CurrentUser() user: CurrentUserType, @Param('itemId') itemId: string) {
    return this.v.removeItem(user, itemId);
  }
}
