import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';

import { MonitoringService } from './monitoring.service';
import { BcpActivateDto, BcpDrillDto, DriftEvaluationDto, DriftReportResponse, ScoreIngestDto } from './monitoring.dto';

@ApiTags('Model Monitoring & Drift')
@ApiBearerAuth()
@Controller('api/v1/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Post('drift/evaluate')
  evaluateDrift(@Body() dto: DriftEvaluationDto): Promise<DriftReportResponse> {
    return this.monitoring.evaluateDrift(dto);
  }

  /** Push a reference/live score window; the hourly job evaluates pending windows. */
  @Post('scores/:modelId')
  ingestScores(@Param('modelId') modelId: string, @Body() dto: ScoreIngestDto) {
    return this.monitoring.ingestScores(modelId, dto);
  }

  /** Force an evaluation of the model's stored windows, as the hourly cron would. */
  @Post('drift/:modelId/evaluate')
  evaluateStored(@Param('modelId') modelId: string): Promise<DriftReportResponse> {
    return this.monitoring.evaluateStoredWindows(modelId);
  }

  @Get('drift/:modelId/history')
  driftHistory(@Param('modelId') modelId: string, @Query('limit') limit?: string): Promise<DriftReportResponse[]> {
    return this.monitoring.driftHistory(modelId, limit ? parseInt(limit, 10) : 30);
  }

  @Post('bcp/:modelId/activate')
  activateBcp(@Param('modelId') modelId: string, @Body() dto: BcpActivateDto) {
    return this.monitoring.activateBcp(modelId, dto);
  }

  @Post('bcp/:modelId/deactivate')
  deactivateBcp(@Param('modelId') modelId: string) {
    return this.monitoring.deactivateBcp(modelId);
  }

  @Get('bcp/:modelId/status')
  bcpStatus(@Param('modelId') modelId: string) {
    return this.monitoring.bcpStatus(modelId);
  }

  /** Record a BCP drill (E0.4). 404 unless GOV_E0_4_BCP_DRILLS is on. */
  @Post('bcp/:modelId/drills')
  @Roles(Role.OWNER, Role.CISO, Role.ADMIN)
  recordDrill(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() dto: BcpDrillDto) {
    return this.monitoring.recordDrill(user, modelId, dto);
  }

  /** Drill history and status for a model (E0.4). 404 unless the flag is on. */
  @Get('bcp/:modelId/drills')
  listDrills(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.monitoring.listDrills(user, modelId);
  }

  @Get('gpu/status')
  gpuStatus() {
    return this.monitoring.gpuStatus();
  }
}
