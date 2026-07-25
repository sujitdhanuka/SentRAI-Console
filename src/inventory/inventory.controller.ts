import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { RiskLevel } from '../common/enums';
import { InventoryService } from './inventory.service';
import { GenerationQueueService } from './generation-queue.service';
import {
  AdversarialEvidenceDto,
  EvalEvidenceDto,
  EvidenceDto,
  GovernanceUpdateDto,
  GrievanceUpdateDto,
  LifecycleUpdateDto,
  ModelRegisterDto,
  ModelResponse,
  RescanDto,
  RescanSummary,
  SummarizeResponse,
} from './inventory.dto';

@ApiTags('AI Model Inventory')
@ApiBearerAuth()
@Controller('api/v1/inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly genQueue: GenerationQueueService,
  ) {}

  @Post('models')
  @HttpCode(HttpStatus.CREATED)
  register(@CurrentUser() user: CurrentUserType, @Body() dto: ModelRegisterDto): Promise<ModelResponse> {
    return this.inventory.register(user, dto);
  }

  @Post('models/rescan')
  @HttpCode(HttpStatus.OK)
  rescan(@CurrentUser() user: CurrentUserType, @Body() dto: RescanDto): Promise<RescanSummary> {
    return this.inventory.rescan(user, dto.project_id ?? undefined);
  }

  @Get('models')
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('risk_level') riskLevel?: RiskLevel,
    @Query('project_id') projectId?: string,
    @Query('active_only') activeOnly?: string,
  ): Promise<ModelResponse[]> {
    return this.inventory.list(user, {
      riskLevel,
      projectId,
      activeOnly: activeOnly === undefined ? true : activeOnly !== 'false',
    });
  }

  @Patch('models/:modelId/lifecycle')
  updateLifecycle(@Param('modelId') modelId: string, @Body() dto: LifecycleUpdateDto) {
    return this.inventory.updateLifecycle(modelId, dto);
  }

  @Delete('models/:modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: CurrentUserType,
    @Param('modelId') modelId: string,
    @Query('permanent') permanent?: string,
    @Query('actor') actor = 'dashboard_user',
  ): Promise<void> {
    return this.inventory.remove(user, modelId, permanent === 'true' || permanent === '1', actor);
  }

  @Patch('models/:modelId/grievances')
  recordGrievance(@Param('modelId') modelId: string, @Body() dto: GrievanceUpdateDto) {
    return this.inventory.recordGrievance(modelId, dto);
  }

  @Patch('models/:modelId/governance')
  updateGovernance(@Param('modelId') modelId: string, @Body() dto: GovernanceUpdateDto) {
    return this.inventory.updateGovernance(modelId, dto);
  }

  /** Regenerate the model's description as a plain-language governance summary. */
  @Post('models/:modelId/summarize')
  @HttpCode(HttpStatus.OK)
  summarize(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string): Promise<SummarizeResponse> {
    return this.inventory.summarizeModel(user, modelId);
  }

  /** Draft an auditor-facing justification of the assigned risk level. */
  @Post('models/:modelId/risk-rationale')
  @HttpCode(HttpStatus.OK)
  draftRiskRationale(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.inventory.draftRiskRationale(user, modelId);
  }

  /** Propose the model's autonomous-action boundary from its code signals (for human review). */
  @Post('models/:modelId/autonomous-scope')
  @HttpCode(HttpStatus.OK)
  draftAutonomousScope(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.inventory.draftAutonomousScope(user, modelId);
  }

  /** Draft one remediation step per open compliance gap; persisted with provenance. */
  @Post('models/:modelId/draft-remediation')
  @HttpCode(HttpStatus.OK)
  draftRemediation(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.inventory.draftGapRemediation(user, modelId);
  }

  /** Progress of the background auto-generation started by a scan or re-scan. */
  @Get('generation-status')
  generationStatus() {
    return this.genQueue.status();
  }

  /**
   * Queue the missing generations for specific models (or force a full regen).
   * Lets the console top up records that predate auto-generation.
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: { model_ids: string[]; force?: boolean },
  ) {
    const queued = await this.genQueue.enqueueMissing(user, dto.model_ids ?? [], Boolean(dto.force));
    return { queued, models: (dto.model_ids ?? []).length };
  }

  @Get('models/:modelId/compliance-check')
  complianceCheck(@Param('modelId') modelId: string) {
    return this.inventory.complianceCheck(modelId);
  }

  /** Full record for one model (tool authorization, operational state, …). */
  @Get('models/:modelId')
  getModel(@Param('modelId') modelId: string): Promise<ModelResponse> {
    return this.inventory.getModel(modelId);
  }

  /** Attach an evidence artifact — bias-test report, red-team report, model card. */
  @Post('models/:modelId/evidence')
  @HttpCode(HttpStatus.CREATED)
  addEvidence(@Param('modelId') modelId: string, @Body() dto: EvidenceDto) {
    return this.inventory.addEvidence(modelId, dto, dto.actor);
  }

  @Get('models/:modelId/evidence')
  listEvidence(@Param('modelId') modelId: string) {
    return this.inventory.listEvidence(modelId);
  }

  /** Ingest behavioral-eval-harness output as typed evidence (parsed pass-rate). */
  @Post('models/:modelId/eval-evidence')
  @HttpCode(HttpStatus.CREATED)
  ingestEvalEvidence(@Param('modelId') modelId: string, @Body() dto: EvalEvidenceDto) {
    return this.inventory.ingestEvalEvidence(modelId, dto);
  }

  /** Ingest an adversarial/red-team report; sets the model's last-red-team date. */
  @Post('models/:modelId/adversarial-evidence')
  @HttpCode(HttpStatus.CREATED)
  ingestAdversarialEvidence(@Param('modelId') modelId: string, @Body() dto: AdversarialEvidenceDto) {
    return this.inventory.ingestAdversarialEvidence(modelId, dto);
  }

  /** Model usage vs. the organization's plan limit (soft limits only). */
  @Get('organizations/:orgId/usage')
  orgUsage(@Param('orgId') orgId: string) {
    return this.inventory.orgUsage(orgId);
  }

  @Get('models/:modelId/ledger')
  getLedger(@Param('modelId') modelId: string) {
    return this.inventory.getLedger(modelId);
  }

  // Public: the dashboard opens this via a plain <a href> that cannot carry the
  // bearer token; the model_id is an unguessable UUID.
  @Public()
  @Get('models/:modelId/export-pdf')
  async exportPdf(@Param('modelId') modelId: string, @Res() res: Response): Promise<void> {
    const pdf = await this.inventory.exportPdf(modelId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=sentrai-compliance-${modelId}.pdf`,
    });
    res.send(pdf);
  }
}
