import { Controller, Get, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@ApiBearerAuth()
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Mounted at top level (no /api/v1 prefix), matching the Python app.
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
