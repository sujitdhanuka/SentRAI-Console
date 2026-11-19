import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { EuActService } from './eu-act.service';

/** EU AI Act workspace (E5.1). 404 unless GOV_E5_1_EU_ACT is on; 409 while the organisation has not enabled the EU pack. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/eu')
export class EuActController {
  constructor(private readonly eu: EuActService) {}

  @Get()
  overview(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.eu.overview(user, q);
  }

  @Put('org')
  @Roles(...MAINTAINERS)
  putOrg(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.putOrg(user, body, req);
  }

  @Get('queue')
  queue(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.eu.queue(user, q);
  }

  @Get('models/:modelId')
  get(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.eu.get(user, modelId);
  }

  @Put('models/:modelId/profile')
  @Roles(...MAINTAINERS)
  putProfile(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.putProfile(user, modelId, body, req);
  }

  @Put('models/:modelId/art5')
  @Roles(...MAINTAINERS)
  putArt5(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.putArt5(user, modelId, body, req);
  }

  @Post('models/:modelId/art5/sign')
  @Roles(...MAINTAINERS)
  signArt5(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Req() req: any) {
    return this.eu.signArt5(user, modelId, req);
  }

  @Put('models/:modelId/classification')
  @Roles(...MAINTAINERS)
  putClassification(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.putClassification(user, modelId, body, req);
  }

  @Post('models/:modelId/classification/sign')
  @Roles(...MAINTAINERS)
  signClassification(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Req() req: any) {
    return this.eu.signClassification(user, modelId, req);
  }

  @Post('models/:modelId/conformity')
  @Roles(...MAINTAINERS)
  saveConformity(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.saveConformity(user, modelId, body, req);
  }

  @Post('conformity/:id/sign')
  @Roles(...MAINTAINERS)
  signConformity(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.signConformity(user, id, body, req);
  }

  @Post('models/:modelId/declaration')
  @Roles(...MAINTAINERS)
  issueDeclaration(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.issueDeclaration(user, modelId, body, req);
  }

  @Post('models/:modelId/registrations')
  @Roles(...MAINTAINERS)
  register(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.register(user, modelId, body, req);
  }

  @Post('models/:modelId/nonconformities')
  @Roles(...MAINTAINERS)
  addNonconformity(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.addNonconformity(user, modelId, body, req);
  }

  @Put('nonconformities/:id')
  @Roles(...MAINTAINERS)
  updateNonconformity(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.updateNonconformity(user, id, body, req);
  }

  @Post('changes/:id/assess')
  @Roles(...MAINTAINERS)
  assessChange(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.assessChange(user, id, body, req);
  }

  @Post('models/:modelId/real-world-tests')
  @Roles(...MAINTAINERS)
  addRealWorldTest(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.addRealWorldTest(user, modelId, body, req);
  }

  @Post('models/:modelId/retention/apply')
  @Roles(...MAINTAINERS)
  applyRetention(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Req() req: any) {
    return this.eu.applyRetention(user, modelId, req);
  }

  @Post('models/:modelId/explanations')
  @Roles(...MAINTAINERS)
  requestExplanation(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.requestExplanation(user, modelId, body, req);
  }

  @Post('explanations/:id/answer')
  @Roles(...MAINTAINERS)
  answerExplanation(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.answerExplanation(user, id, body, req);
  }

  @Put('incidents/:id')
  @Roles(...MAINTAINERS)
  putIncident(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.eu.putIncident(user, id, body, req);
  }

  @Get('incidents/:id/report')
  incidentReport(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.eu.incidentReport(user, id);
  }

  /** Annex IV (json or md), Art. 13 instructions, Annex VIII (section A, B or C), the Annex V declaration, the Art. 21 authority bundle. */
  @Get('models/:modelId/export/:kind')
  async export(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('kind') kind: string, @Query() q: Record<string, string>, @Res() res: Response): Promise<void> {
    const out = await this.eu.exportDoc(user, modelId, kind, q);
    res.set({ 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"` });
    res.send(out.body);
  }
}

/** Art. 86 public request path for an affected person. */
@ApiTags('Governance')
@Controller('api/v1/governance')
export class EuActPublicController {
  constructor(private readonly eu: EuActService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/eu/decisions/:modelId/explanations')
  request(@Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.eu.publicExplanation(modelId, body);
  }
}
