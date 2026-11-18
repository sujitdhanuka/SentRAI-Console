import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS, OFFICERS } from '../phase2-util';
import { DatasetsService } from './datasets.service';

/** Data register (E2.7). 404 unless GOV_E2_7_DATASETS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class DatasetsController {
  constructor(private readonly d: DatasetsService) {}

  @Get('datasets/retention')
  retention(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.retention(user, q);
  }

  @Get('datasets/lineage')
  lineage(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.lineage(user, q);
  }

  @Get('datasets')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.d.list(user, q);
  }

  @Post('datasets')
  @Roles(...MAINTAINERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.create(user, body, req);
  }

  @Get('datasets/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.d.get(user, id);
  }

  @Patch('datasets/:id')
  @Roles(...MAINTAINERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.update(user, id, body, req);
  }

  @Post('datasets/:id/deletion-orders')
  @Roles(...OFFICERS)
  order(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.orderDeletion(user, id, body, req);
  }

  @Post('datasets/:id/deletion-orders/:orderId/model-action')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  action(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Param('orderId') orderId: string, @Body() body: Record<string, any>) {
    return this.d.modelAction(user, id, orderId, body);
  }

  @Post('datasets/:id/deletion-orders/:orderId/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICERS)
  complete(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Param('orderId') orderId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.d.completeOrder(user, id, orderId, body, req);
  }

  @Get('models/:modelId/datasets')
  modelDatasets(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.d.modelDatasets(user, modelId);
  }

  @Post('models/:modelId/datasets')
  @Roles(...MAINTAINERS)
  link(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.d.link(user, modelId, body);
  }

  @Delete('models/:modelId/datasets/:datasetId')
  @Roles(...MAINTAINERS)
  unlink(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('datasetId') datasetId: string) {
    return this.d.unlink(user, modelId, datasetId);
  }
}
