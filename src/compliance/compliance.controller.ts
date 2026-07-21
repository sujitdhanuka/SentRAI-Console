import { Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { ComplianceService } from './compliance.service';
import { generatePortfolioPdf } from './pdf-generator';

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('api/v1/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Executive portfolio rollup: per-framework pass rates, risk tiers, top gaps. */
  @Get('portfolio')
  portfolio(@CurrentUser() user: CurrentUserType, @Query('project_id') projectId?: string) {
    return this.compliance.portfolio(user, projectId ?? null);
  }

  /** Draft the board-facing executive paragraph, grounded in the rollup numbers. */
  @Post('exec-narrative')
  @HttpCode(HttpStatus.OK)
  execNarrative(@CurrentUser() user: CurrentUserType, @Query('project_id') projectId?: string) {
    return this.compliance.execNarrative(user, projectId ?? null);
  }

  /** Fleet matrix for the dashboard: per-model framework verdicts + drift + gaps in one call. */
  @Get('matrix')
  matrix(@CurrentUser() user: CurrentUserType, @Query('project_id') projectId?: string) {
    return this.compliance.matrix(user, projectId ?? null);
  }

  /** Portfolio-level framework readiness PDF (executive/auditor deliverable). */
  @Get('portfolio/export-pdf')
  async portfolioPdf(
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
    @Query('project_id') projectId?: string,
  ): Promise<void> {
    const report = await this.compliance.portfolio(user, projectId ?? null);
    const pdf = await generatePortfolioPdf(report);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=sentrai-portfolio-readiness.pdf',
    });
    res.send(pdf);
  }
}
