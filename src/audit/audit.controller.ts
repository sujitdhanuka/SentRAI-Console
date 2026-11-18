import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { AuditService } from './audit.service';
import { AuditChecklistDto, AuditFindingDto, AuditResponse, ExplainabilityDto } from './audit.dto';

@ApiTags('AI Audit Framework')
@ApiBearerAuth()
@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('models/:modelId/audits')
  list(@Param('modelId') modelId: string, @CurrentUser() user: CurrentUserType) {
    return this.audit.list(modelId, user);
  }

  @Post('models/:modelId/initiate')
  @HttpCode(HttpStatus.CREATED)
  initiate(@Param('modelId') modelId: string, @Body() dto: AuditChecklistDto, @CurrentUser() user: CurrentUserType): Promise<AuditResponse> {
    return this.audit.initiate(modelId, dto, user);
  }

  @Post('models/:modelId/findings/:auditId')
  addFinding(
    @Param('modelId') modelId: string,
    @Param('auditId') auditId: string,
    @Body() dto: AuditFindingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.audit.addFinding(modelId, auditId, dto, user);
  }

  @Post('explainability/record')
  recordExplainability(@Body() dto: ExplainabilityDto, @CurrentUser() user: CurrentUserType) {
    return this.audit.recordExplainability(dto, user);
  }

  @Get('explainability/records')
  listExplainability(@CurrentUser() user: CurrentUserType, @Query('decision_ref') decisionRef?: string, @Query('limit') limit?: string) {
    return this.audit.listExplainability(decisionRef, limit ? parseInt(limit, 10) : 50, user);
  }

  /** Global audit-event stream: one row per mutating API action, PII-masked. */
  /** Recomputes the whole hash chain — proof the ledger hasn't been altered. */
  @Get('events/verify')
  @Roles(Role.ADMIN, Role.CISO, Role.REVIEWER)
  verifyChain() {
    return this.audit.verifyChain();
  }

  @Get('events')
  @Roles(Role.ADMIN, Role.CISO, Role.REVIEWER)
  listEvents(
    @Query('actor') actor?: string,
    @Query('path') path?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.listEvents({ actor, path, limit: limit ? parseInt(limit, 10) : 100 });
  }
}
