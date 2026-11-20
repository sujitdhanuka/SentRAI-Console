import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { LlmModelsService } from './llm-models.service';
import { ConfirmLlmModelsDto } from './telemetry.dto';

/**
 * The real LLM models behind an inventory record. The scan names the provider;
 * the model often lives in the scanned app's database. This shows where the
 * scan found it stored, the per-task list the owner confirmed, and what runtime
 * `llm_call` telemetry saw.
 */
@ApiTags('AI Model Inventory')
@ApiBearerAuth()
@Controller('api/v1/inventory/models/:modelId/llm-models')
export class LlmModelsController {
  constructor(private readonly llmModels: LlmModelsService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.llmModels.get(user, modelId);
  }

  /** Replace the confirmed per-task list. An empty list withdraws it. */
  @Put()
  confirm(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() dto: ConfirmLlmModelsDto) {
    return this.llmModels.confirm(user, modelId, dto);
  }
}
