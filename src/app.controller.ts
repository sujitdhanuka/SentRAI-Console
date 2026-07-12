import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { readFile } from 'fs/promises';
import { ConfigService } from '@nestjs/config';

import { Public } from './common/decorators/public.decorator';
import { INDEX_HTML, LANDING_HTML, HELP_MD } from './common/paths';
import { SUTRAS } from './common/sutras.data';

@ApiTags('Root')
@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  /** Serves the public marketing landing page (product, pricing, responsible-AI story). */
  @Public()
  @Get('/')
  @ApiExcludeEndpoint()
  async landing(@Res() res: Response): Promise<void> {
    res.sendFile(LANDING_HTML);
  }

  /** Serves the compliance console UI — a single-page dashboard with no build step. */
  @Public()
  @Get('/console')
  @ApiExcludeEndpoint()
  async dashboard(@Res() res: Response): Promise<void> {
    res.sendFile(INDEX_HTML);
  }

  @Public()
  @Get('/health')
  health(): { status: string; service: string } {
    return { status: 'ok', service: this.config.get<string>('appName')! };
  }

  /** Serves the HELP.md content as JSON (mirrors GET /api/v1/docs). */
  @Public()
  @Get('/api/v1/docs')
  async getDocs(): Promise<{ content: string; error?: string }> {
    try {
      const content = await readFile(HELP_MD, 'utf-8');
      return { content };
    } catch (e) {
      return { error: `Failed to read HELP.md: ${String(e)}`, content: '' };
    }
  }

  @Public()
  @Get('/api/v1/sutras')
  listSutras(): typeof SUTRAS {
    return SUTRAS;
  }
}
