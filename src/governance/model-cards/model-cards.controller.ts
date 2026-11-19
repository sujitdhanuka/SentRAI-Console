import { Body, Controller, Get, Param, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { ModelCardsService } from './model-cards.service';

/** Model cards (E4.1). 404 unless GOV_E4_1_MODEL_CARDS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class ModelCardsController {
  constructor(private readonly cards: ModelCardsService) {}

  /** The live card, readiness, and every frozen version with its staleness. */
  @Get('models/:id/model-card')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.cards.get(user, id);
  }

  /** Freeze the live card: { status: DRAFT | FINAL, note? }. FINAL needs an officer, every required field and clear gates. */
  @Post('models/:id/model-card/versions')
  @Roles(...MAINTAINERS)
  freeze(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.cards.freeze(user, id, body, req);
  }

  /** ?format=pdf|md|json, &version=N for a frozen version (otherwise the live draft). */
  @Get('models/:id/model-card/export')
  async export(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('version') version?: string,
  ): Promise<void> {
    const out = await this.cards.export(user, id, format ?? 'json', version);
    res.set({ 'Content-Type': out.type, 'Content-Disposition': `attachment; filename=${out.filename}` });
    res.send(out.body);
  }
}
