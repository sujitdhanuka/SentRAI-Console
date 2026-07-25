import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { TelemetryService } from './telemetry.service';
import { IngestEventsDto } from './telemetry.dto';

@ApiTags('Visibility — Runtime Telemetry')
@ApiBearerAuth()
@Controller('api/v1/telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** Ingest a batch of runtime action events from deployed agents. */
  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  ingest(@CurrentUser() user: CurrentUserType, @Body() dto: IngestEventsDto) {
    return this.telemetry.ingest(user, dto);
  }

  /** Organization-wide runtime-visibility summary. */
  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.telemetry.summary(user);
  }

  @Get('models/:modelId/events')
  events(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Query('limit') limit?: string) {
    return this.telemetry.listForModel(user, modelId, limit ? parseInt(limit, 10) : 100);
  }

  /** Cross-ledger timeline for one model (ledger + gate + incident + drift + actions). */
  @Get('models/:modelId/timeline')
  timeline(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Query('limit') limit?: string) {
    return this.telemetry.timeline(user, modelId, limit ? parseInt(limit, 10) : 120);
  }
}
