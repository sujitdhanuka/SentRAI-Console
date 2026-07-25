import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { ControlService } from './control.service';
import { SuspendDto } from './control.dto';

@ApiTags('Control — Operational Kill Switch')
@ApiBearerAuth()
@Controller('api/v1/control')
export class ControlController {
  constructor(private readonly control: ControlService) {}

  /** Currently suspended models in the caller's organization. */
  @Get('suspended')
  listSuspended(@CurrentUser() user: CurrentUserType) {
    return this.control.listSuspended(user);
  }

  /** Suspend a model — the kill switch. Restricted to ADMIN / CISO. */
  @Post('models/:modelId/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.CISO)
  suspend(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() dto: SuspendDto) {
    return this.control.suspend(user, modelId, dto.reason);
  }

  @Post('models/:modelId/resume')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.CISO)
  resume(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.control.resume(user, modelId);
  }

  @Get('models/:modelId/state')
  state(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.control.state(user, modelId);
  }

  /**
   * Public polled kill-switch contract. A deployed agent checks this each loop
   * (by its unguessable model UUID) and halts when kill_switch is true — no user
   * session required, mirroring the public PDF-export route.
   */
  @Public()
  @Get('models/:modelId/poll')
  poll(@Param('modelId') modelId: string) {
    return this.control.publicState(modelId);
  }
}
