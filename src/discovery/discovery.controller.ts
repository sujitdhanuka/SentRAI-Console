import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
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

  @Post('scan')
  scan(@Body() dto: ScanDto) {
    return this.discovery.scan(dto.directory, dto.project_id);
  }

  @Post('import')
  import(@Body() dto: ImportDto): Promise<ImportedModel[]> {
    return this.discovery.import(dto);
  }

  @Post('scan-remote')
  scanRemote(@Body() dto: RemoteScanDto) {
    return this.discovery.scanRemote(dto);
  }

  @Post('scan-infrastructure')
  scanInfrastructure(@Body() dto: InfraScanDto) {
    return this.discovery.scanInfrastructure(dto);
  }
}
