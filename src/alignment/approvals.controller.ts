import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { ApprovalsService } from './approvals.service';
import { ApprovalDecisionDto, ApprovalRequestDto } from './alignment.dto';

@ApiTags('Alignment — Review-Board Approvals')
@ApiBearerAuth()
@Controller('api/v1/alignment/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
    @Query('model_id') modelId?: string,
  ) {
    return this.approvals.list(user, { status, modelId });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  request(@CurrentUser() user: CurrentUserType, @Body() dto: ApprovalRequestDto) {
    return this.approvals.request(user, dto);
  }

  @Get(':approvalId')
  get(@CurrentUser() user: CurrentUserType, @Param('approvalId') approvalId: string) {
    return this.approvals.get(user, approvalId);
  }

  /** Cast an approve/reject decision — restricted to the governance board. */
  @Post(':approvalId/decide')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.APPROVER, Role.CISO, Role.ADMIN)
  decide(
    @CurrentUser() user: CurrentUserType,
    @Param('approvalId') approvalId: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.decide(user, approvalId, dto);
  }

  @Post(':approvalId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentUser() user: CurrentUserType, @Param('approvalId') approvalId: string) {
    return this.approvals.withdraw(user, approvalId);
  }
}
