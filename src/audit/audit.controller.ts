import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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
}
