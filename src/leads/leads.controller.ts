import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { BookDemoDto, ContactDto, LeadUpdateDto } from './leads.dto';
import { LeadsService } from './leads.service';

/**
 * Landing-page leads. The three public routes back the contact form and the
 * demo calendar; the rest is the platform admin's inbox in the console.
 */
@ApiTags('Leads — contact and demo bookings')
@Controller('api/v1/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('demo-slots')
  slots() {
    return this.leads.slots();
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('contact')
  @HttpCode(HttpStatus.CREATED)
  contact(@Body() dto: ContactDto) {
    return this.leads.contact(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('demo')
  @HttpCode(HttpStatus.CREATED)
  book(@Body() dto: BookDemoDto) {
    return this.leads.bookDemo(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query('kind') kind?: string, @Query('status') status?: string) {
    return this.leads.list(user, kind, status);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.leads.summary(user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: LeadUpdateDto) {
    return this.leads.update(user, id, dto);
  }
}
