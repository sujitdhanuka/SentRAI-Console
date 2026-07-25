import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { REGIMES } from '../compliance/regimes';
import { CardsService } from './cards.service';

@ApiTags('Societal — Public Transparency Cards')
@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  /** Public transparency card as JSON (by unguessable model UUID). */
  @Public()
  @Get('api/v1/cards/:modelId')
  card(@Param('modelId') modelId: string) {
    return this.cards.card(modelId);
  }

  /** Framework-as-data: the regulatory regime registry (disclosure timelines). */
  @Public()
  @Get('api/v1/regimes')
  regimes() {
    return { regimes: REGIMES };
  }

  /** Public, human-readable transparency card page (consumer-facing). */
  @Public()
  @Get('card/:modelId')
  @ApiExcludeEndpoint()
  async cardPage(@Param('modelId') modelId: string, @Res() res: Response): Promise<void> {
    const html = await this.cards.renderHtml(modelId);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }
}
