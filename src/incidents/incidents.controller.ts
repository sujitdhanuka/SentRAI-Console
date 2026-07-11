import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { IncidentSeverity, IncidentStatus } from '../common/enums';
import { IncidentsService } from './incidents.service';
import { IncidentReportDto, IncidentResponse, IncidentStatusUpdateDto } from './incidents.dto';

@ApiTags('AI Incident Reporting')
@ApiBearerAuth()
@Controller('api/v1/compliance/incident')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(
    @Query('severity') severity?: IncidentSeverity,
    @Query('status_filter') statusFilter?: IncidentStatus,
    @Query('limit') limit?: string,
  ) {
    return this.incidents.list(severity, statusFilter, limit ? parseInt(limit, 10) : 100);
  }

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  report(@Body() dto: IncidentReportDto): Promise<IncidentResponse> {
    return this.incidents.report(dto);
  }

  @Patch(':incidentId/status')
  updateStatus(@Param('incidentId') incidentId: string, @Body() dto: IncidentStatusUpdateDto) {
    return this.incidents.updateStatus(incidentId, dto);
  }

  // Must be declared before the ':incidentId' route so it isn't captured as an id.
  @Get('sectoral-risk')
  sectoralRisk() {
    return this.incidents.sectoralRisk();
  }

  @Get(':incidentId')
  get(@Param('incidentId') incidentId: string) {
    return this.incidents.get(incidentId);
  }
}
