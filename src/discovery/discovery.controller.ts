import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { DiscoveryService } from './discovery.service';
import { BrowseResponse, ImportDto, ImportedModel, InfraScanDto, RemoteScanDto, ScanDto } from './discovery.dto';

@ApiTags('Codebase Discovery')
@ApiBearerAuth()
@Controller('api/v1/discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  // Browsing the server filesystem is admin-only and additionally gated by the
  // ALLOW_SERVER_FS flag inside the service (off in production).
  @Roles(Role.ADMIN, Role.CISO)
  @Get('browse')
  browse(@Query('path') path?: string): BrowseResponse {
    return this.discovery.browse(path);
  }

  // All scans are bound to the caller: the service resolves the workspace from
  // the caller's own project and refuses projects outside their organization.
  @Post('scan')
  scan(@CurrentUser() user: CurrentUserType, @Body() dto: ScanDto) {
    return this.discovery.scan(user, dto.directory, dto.project_id);
  }

  // Importing creates governed models — restrict to roles that own governance.
  @Roles(Role.OWNER, Role.APPROVER, Role.CISO, Role.ADMIN)
  @Post('import')
  import(@CurrentUser() user: CurrentUserType, @Body() dto: ImportDto): Promise<ImportedModel[]> {
    return this.discovery.import(user, dto);
  }

  @Roles(Role.OWNER, Role.APPROVER, Role.CISO, Role.ADMIN)
  @Post('scan-remote')
  scanRemote(@Body() dto: RemoteScanDto) {
    return this.discovery.scanRemote(dto);
  }

  @Roles(Role.OWNER, Role.APPROVER, Role.CISO, Role.ADMIN)
  @Post('scan-infrastructure')
  scanInfrastructure(@Body() dto: InfraScanDto) {
    return this.discovery.scanInfrastructure(dto);
  }
}
