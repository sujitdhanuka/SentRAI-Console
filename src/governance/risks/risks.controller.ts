import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { RISK_WRITERS, RisksService } from './risks.service';

/** Risk register (E1.3). 404 unless GOV_E1_3_RISKS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@Controller('api/v1/governance')
export class RisksController {
  constructor(private readonly risks: RisksService) {}

  @Get('risks')
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.risks.list(user, q);
  }

  @Get('risks/catalogue')
  catalogue() {
    return this.risks.catalogue();
  }

  @Get('risks/heatmap')
  heatmap(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.risks.heatmap(user, q);
  }

  @Get('risks/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.risks.get(user, id);
  }

  @Post('risks')
  @Roles(...RISK_WRITERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.risks.create(user, body);
  }

  @Patch('risks/:id')
  @Roles(...RISK_WRITERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.risks.update(user, id, body);
  }

  @Post('risks/:id/assess')
  @HttpCode(HttpStatus.OK)
  @Roles(...RISK_WRITERS)
  assess(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.risks.assess(user, id, body, req);
  }

  /** Any signed-in member may try; the risk appetite decides who qualifies for the band (403 otherwise). */
  @Post('risks/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.risks.accept(user, id, body, req);
  }

  @Post('risks/:id/actions')
  @Roles(...RISK_WRITERS)
  addAction(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.risks.addAction(user, id, body);
  }

  @Patch('risks/:id/actions/:actionId')
  @Roles(...RISK_WRITERS)
  updateAction(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Param('actionId') actionId: string, @Body() body: Record<string, any>) {
    return this.risks.updateAction(user, id, actionId, body);
  }

  @Post('risks/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @Roles(...RISK_WRITERS)
  dismiss(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.risks.dismiss(user, id, body.reason);
  }

  /** Pre-fill draft risks from the starter catalogue and the model's operational signals. */
  @Post('models/:modelId/risks/suggest')
  @Roles(...RISK_WRITERS)
  suggest(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.risks.suggest(user, modelId);
  }

  /** The residual-risk / impact-assessment gate verdict for a model (what CI and promotion apply). */
  @Get('models/:modelId/gate')
  gate(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.risks.gateView(user, modelId);
  }
}
