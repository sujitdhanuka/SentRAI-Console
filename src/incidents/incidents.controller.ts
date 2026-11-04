import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IncidentSeverity, IncidentStatus } from '../common/enums';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { IncidentsService } from './incidents.service';
import { IncidentReportDto, IncidentResponse, IncidentStatusUpdateDto } from './incidents.dto';

@ApiTags('AI Incident Reporting')
@ApiBearerAuth()
@Controller('api/v1/compliance/incident')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('severity') severity?: IncidentSeverity,
    @Query('status_filter') statusFilter?: IncidentStatus,
    @Query('project_id') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.incidents.list(user, { severity, statusFilter, projectId, limit: limit ? parseInt(limit, 10) : 100 });
  }

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  report(@CurrentUser() user: CurrentUserType, @Body() dto: IncidentReportDto): Promise<IncidentResponse> {
    return this.incidents.report(user, dto);
  }

  @Patch(':incidentId/status')
  updateStatus(@CurrentUser() user: CurrentUserType, @Param('incidentId') incidentId: string, @Body() dto: IncidentStatusUpdateDto) {
    return this.incidents.updateStatus(user, incidentId, dto);
  }

  // Must be declared before the ':incidentId' route so it isn't captured as an id.
  @Get('sectoral-risk')
  sectoralRisk(@CurrentUser() user: CurrentUserType, @Query('project_id') projectId?: string) {
    return this.incidents.sectoralRisk(user, projectId);
  }

  @Get(':incidentId')
  get(@CurrentUser() user: CurrentUserType, @Param('incidentId') incidentId: string) {
    return this.incidents.get(user, incidentId);
  }
}
