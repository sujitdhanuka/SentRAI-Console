import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { AuditService } from './audit.service';
import { AuditChecklistDto, AuditFindingDto, AuditResponse, ExplainabilityDto } from './audit.dto';

@ApiTags('AI Audit Framework')
@ApiBearerAuth()
@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('models/:modelId/audits')
  list(@Param('modelId') modelId: string) {
    return this.audit.list(modelId);
  }

  @Post('models/:modelId/initiate')
  @HttpCode(HttpStatus.CREATED)
  initiate(@Param('modelId') modelId: string, @Body() dto: AuditChecklistDto): Promise<AuditResponse> {
    return this.audit.initiate(modelId, dto);
  }

  @Post('models/:modelId/findings/:auditId')
  addFinding(
    @Param('modelId') modelId: string,
    @Param('auditId') auditId: string,
    @Body() dto: AuditFindingDto,
  ) {
    return this.audit.addFinding(modelId, auditId, dto);
  }

  @Post('explainability/record')
  recordExplainability(@Body() dto: ExplainabilityDto) {
    return this.audit.recordExplainability(dto);
  }

  @Get('explainability/records')
  listExplainability(@Query('decision_ref') decisionRef?: string, @Query('limit') limit?: string) {
    return this.audit.listExplainability(decisionRef, limit ? parseInt(limit, 10) : 50);
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
