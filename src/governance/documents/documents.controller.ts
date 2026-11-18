import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { RISK_WRITERS } from '../risks/risks.service';
import { DOC_APPROVERS, DocumentsService } from './documents.service';

/** Document control (E1.8). 404 unless GOV_E1_8_DOCUMENTS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@Controller('api/v1/governance/documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.docs.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.docs.get(user, id);
  }

  @Post()
  @Roles(...RISK_WRITERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.docs.create(user, body);
  }

  @Post(':id/new-version')
  @Roles(...RISK_WRITERS)
  newVersion(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.docs.newVersion(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...DOC_APPROVERS)
  approve(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.docs.approve(user, id, body ?? {}, req);
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  @Roles(...DOC_APPROVERS)
  retire(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.docs.retire(user, id, body.reason);
  }
}
