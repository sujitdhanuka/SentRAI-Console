import { Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { ComplianceService } from './compliance.service';
import { coverageSummary } from './coverage.data';
import { generatePortfolioPdf } from './pdf-generator';
import { generateBoardReportPdf } from './board-report';

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('api/v1/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /**
   * Public coverage disclosure: exactly which controls each framework validator
   * evaluates, against the size of the full regime. Public by design — the
   * honesty page is a trust asset, not a secret.
   */
  @Public()
  @Get('coverage')
  coverage() {
    return coverageSummary();
  }

  /** Executive portfolio rollup: per-framework pass rates, risk tiers, top gaps. */
  @Get('portfolio')
  portfolio(@CurrentUser() user: CurrentUserType, @Query('project_id') projectId?: string, @Query('packs') packs?: string) {
    return this.compliance.portfolio(user, projectId ?? null, packs ? packs.split(',').map((p) => p.trim()).filter(Boolean) : null);
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

  /** Board pack: multi-section governance report (the periodic board deliverable). */
  @Get('board-report/export-pdf')
  async boardReportPdf(
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
    @Query('project_id') projectId?: string,
  ): Promise<void> {
    const payload = await this.compliance.boardReport(user, projectId ?? null);
    const pdf = await generateBoardReportPdf(payload);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=sentrai-board-report.pdf',
    });
    res.send(pdf);
  }

  /** Portfolio-level framework readiness PDF (executive/auditor deliverable). */
  @Get('portfolio/export-pdf')
  async portfolioPdf(
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
    @Query('project_id') projectId?: string,
  ): Promise<void> {
    const report = await this.compliance.portfolio(user, projectId ?? null);
    const governance = await this.compliance.programme(user, projectId ?? null, report);
    const pdf = await generatePortfolioPdf({ ...report, governance });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=sentrai-portfolio-readiness.pdf',
    });
    res.send(pdf);
  }
}
