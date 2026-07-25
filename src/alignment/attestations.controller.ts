import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { AttestationsService } from './attestations.service';
import { AttestDto, OpenCampaignDto } from './alignment.dto';

@ApiTags('Alignment — Attestation Campaigns')
@ApiBearerAuth()
@Controller('api/v1/alignment/attestations')
export class AttestationsController {
  constructor(private readonly attestations: AttestationsService) {}

  @Get()
  listCampaigns(@CurrentUser() user: CurrentUserType) {
    return this.attestations.listCampaigns(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  openCampaign(@CurrentUser() user: CurrentUserType, @Body() dto: OpenCampaignDto) {
    return this.attestations.openCampaign(user, dto);
  }

  @Get(':campaignId')
  getCampaign(@CurrentUser() user: CurrentUserType, @Param('campaignId') campaignId: string) {
    return this.attestations.getCampaign(user, campaignId);
  }

  @Post(':campaignId/close')
  @HttpCode(HttpStatus.OK)
  closeCampaign(@CurrentUser() user: CurrentUserType, @Param('campaignId') campaignId: string) {
    return this.attestations.closeCampaign(user, campaignId);
  }

  @Post('items/:itemId/attest')
  @HttpCode(HttpStatus.OK)
  attest(
    @CurrentUser() user: CurrentUserType,
    @Param('itemId') itemId: string,
    @Body() dto: AttestDto,
  ) {
    return this.attestations.attest(user, itemId, dto);
  }
}
