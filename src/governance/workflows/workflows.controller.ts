import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { WorkflowsService } from './workflows.service';

/**
 * Governance workflows (W0 to W12) with each step's status, read from the
 * same checks as the compliance check, the deploy gate and the readiness
 * report. Read-only; any signed-in member of the organisation.
 */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  /** Organisation workflow: set-up, project onboarding, periodic review and disclosure. */
  @Get('org')
  org(@CurrentUser() user: CurrentUserType, @Query('org_id') orgId?: string) {
    return this.workflows.org(user, orgId);
  }

  /** Progress per model (narrowed to the selected project). */
  @Get('models')
  models(@CurrentUser() user: CurrentUserType, @Query('org_id') orgId?: string) {
    return this.workflows.modelSummaries(user, orgId);
  }

  /** One model's workflow, W1 to W12. */
  @Get('models/:modelId')
  model(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.workflows.model(user, modelId);
  }
}
