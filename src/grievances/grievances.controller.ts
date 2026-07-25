import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Public } from '../common/decorators/public.decorator';
import { GrievancesService } from './grievances.service';
import { FileGrievanceDto, GrievanceStatusDto, PublicGrievanceDto } from './grievances.dto';

@ApiTags('Societal — Consumer Grievances')
@ApiBearerAuth()
@Controller('api/v1/grievances')
export class GrievancesController {
  constructor(private readonly grievances: GrievancesService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
    @Query('model_id') modelId?: string,
  ) {
    return this.grievances.list(user, { status, modelId });
  }

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.grievances.summary(user);
  }

  /** File a grievance from the console (staff logging a consumer complaint). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  file(@CurrentUser() user: CurrentUserType, @Body() dto: FileGrievanceDto) {
    return this.grievances.fileAuthed(user, dto);
  }

  /**
   * Public consumer redress: file a grievance about a model by its (unguessable)
   * UUID, no account required — the redress channel the public model card links
   * to. Rate-limited by the global throttler.
   */
  @Public()
  @Post('public/:modelId')
  @HttpCode(HttpStatus.CREATED)
  filePublic(@Param('modelId') modelId: string, @Body() dto: PublicGrievanceDto) {
    return this.grievances.file(modelId, { ...dto, channel: 'web' }, 'consumer');
  }

  @Patch(':grievanceId/status')
  updateStatus(@CurrentUser() user: CurrentUserType, @Param('grievanceId') grievanceId: string, @Body() dto: GrievanceStatusDto) {
    return this.grievances.updateStatus(user, grievanceId, dto);
  }
}
