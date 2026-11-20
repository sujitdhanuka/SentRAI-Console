import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../../acting-org.interceptor';
import { OFFICERS } from '../../phase2-util';
import { Role } from '../../../common/enums';
import { FrameworkRegistryService } from './registry/framework-registry.service';
import { CardV2Service } from './card-v2.service';
import { CardV2MigrationService } from './migration/card-v2-migration.service';

/** Model card v2. 404 unless GOV_E4_2_MODEL_CARD_V2 is on (it is on by default under GOVERNANCE_V2). */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class CardV2Controller {
  constructor(
    private readonly migration: CardV2MigrationService,
    private readonly registry: FrameworkRegistryService,
    private readonly cards: CardV2Service,
  ) {}

  /**
   * Migrate the organisation's v1 records to v2 cards. A dry run unless
   * `dry_run=false` is passed: the dry run reports what would change per
   * record and writes nothing. Officers only; ADMIN names the org with ?org_id=.
   */
  @Post('model-cards/v2/migrate-v1')
  @Roles(...OFFICERS)
  migrate(@CurrentUser() user: CurrentUserType, @Query('dry_run') dryRun?: string, @Query('org_id') orgId?: string, @Body() _body?: unknown) {
    return this.migration.migrate(user, { orgId: orgId ?? null, dryRun: dryRun !== 'false' });
  }

  /** The framework registry: the latest revision of every entry (identifiers, dates and paraphrases; all unverified until legal review). */
  @Get('framework-registry')
  listRegistry() {
    return this.registry.list();
  }

  /** One registry entry, at a pinned revision when `revision` is given, with its revision history. */
  @Get('framework-registry/:frameworkId')
  readRegistry(@Param('frameworkId') frameworkId: string, @Query('revision', new ParseIntPipe({ optional: true })) revision?: number) {
    return this.registry.read(frameworkId, revision);
  }

  /** A new revision of a registry entry (or a new entry). Platform administrators only; a reason is required. */
  @Post('framework-registry/:frameworkId/revisions')
  @Roles(Role.ADMIN)
  reviseRegistry(@CurrentUser() user: CurrentUserType, @Param('frameworkId') frameworkId: string, @Body() body: { changes?: Record<string, unknown>; reason?: string }) {
    return this.registry.revise(user, frameworkId, body);
  }

  // ---- the card ----

  /** The v2 card: applicable sections and fields with provenance, the four scores, risk explanation, frameworks, gate blockers. */
  @Get('models/:modelId/card-v2')
  readCard(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.cards.read(user, modelId);
  }

  /** Change one field: SET, UNKNOWN, NOT_APPLICABLE (with justification), ACCEPT, ACCEPT_SUGGESTION, ATTACH_EVIDENCE, VERIFY. */
  @Patch('models/:modelId/card-v2/fields/:fieldId')
  changeField(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('fieldId') fieldId: string, @Body() body: Record<string, any>) {
    return this.cards.changeField(user, modelId, fieldId, body);
  }

  /** Assess one registry control on this record (a person, with evidence where the status claims work was done). */
  @Put('models/:modelId/card-v2/controls/:frameworkId/:controlId')
  changeControl(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('frameworkId') frameworkId: string, @Param('controlId') controlId: string, @Body() body: Record<string, any>) {
    return this.cards.changeControl(user, modelId, frameworkId, controlId, body);
  }

  @Post('models/:modelId/card-v2/links')
  addLink(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.cards.addLink(user, modelId, body);
  }

  @Delete('models/:modelId/card-v2/links/:linkId')
  removeLink(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('linkId') linkId: string) {
    return this.cards.removeLink(user, modelId, linkId);
  }

  /** Workflow: START_ASSESSMENT, COLLECT_EVIDENCE, SUBMIT_FOR_REVIEW, APPROVE, APPROVE_WITH_CONDITIONS, REJECT, REASSESS, RETIRE, COMMENT, REQUEST_EVIDENCE, ASSIGN_REVIEWER. */
  @Post('models/:modelId/card-v2/workflow')
  workflow(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.cards.workflow(user, modelId, body);
  }

  @Post('models/:modelId/card-v2/versions')
  snapshot(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.cards.snapshot(user, modelId, body);
  }

  @Get('models/:modelId/card-v2/versions')
  versions(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.cards.listVersions(user, modelId);
  }

  @Get('models/:modelId/card-v2/versions/:version')
  version(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('version', ParseIntPipe) version: number) {
    return this.cards.getVersion(user, modelId, version);
  }

  /** What changed between two versions; either side may be `live`. */
  @Get('models/:modelId/card-v2/versions/:a/diff/:b')
  diff(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Param('a') a: string, @Param('b') b: string) {
    return this.cards.diff(user, modelId, a, b);
  }

  /** Export as PDF (default) or JSON; `version` picks a frozen version, otherwise the live card (watermarked DRAFT). */
  @Get('models/:modelId/card-v2/export')
  async exportCard(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Res() res: Response, @Query('format') format?: string, @Query('version') version?: string): Promise<void> {
    const file = await this.cards.exportCard(user, modelId, format ?? 'pdf', version);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  @Get('models/:modelId/card-v2/history')
  history(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.cards.history(user, modelId);
  }
}

