import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { MonitoringService } from './monitoring.service';
import { BcpActivateDto, DriftEvaluationDto, DriftReportResponse } from './monitoring.dto';

@ApiTags('Model Monitoring & Drift')
@ApiBearerAuth()
@Controller('api/v1/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Post('drift/evaluate')
  evaluateDrift(@Body() dto: DriftEvaluationDto): Promise<DriftReportResponse> {
    return this.monitoring.evaluateDrift(dto);
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

  @Get('gpu/status')
  gpuStatus() {
    return this.monitoring.gpuStatus();
  }
}
