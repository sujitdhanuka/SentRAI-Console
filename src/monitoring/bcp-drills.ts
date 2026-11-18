/**
 * Shared read of BCP drill evidence (E0.4). Every compliance path (model
 * detail, model list, project rollup, portfolio) reads the drill date through
 * here, so they always agree. Only drills that passed (with or without
 * findings) count towards RBI Rec 21: a failed drill shows the plan does not
 * work, so it never makes the check green.
 */
import { In, Repository } from 'typeorm';

import { getFeatureFlags } from '../common/feature-flags';
import { BcpDrillEntity } from '../database/entities';

export const SUCCESSFUL_DRILL_RESULTS = ['PASSED', 'PASSED_WITH_FINDINGS'];

/** Latest successful drill date per model. Empty (no query) while the drill flag is off. */
export async function latestSuccessfulDrills(
  repo: Repository<BcpDrillEntity>,
  modelIds: string[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!getFeatureFlags().bcpDrills || modelIds.length === 0) return out;
  // Entity reads (not a raw MAX) so the driver converts dates consistently:
  // SQLite returns raw datetimes without a zone, which parse as local time.
  const rows = await repo.find({
    where: { modelId: In(modelIds), result: In(SUCCESSFUL_DRILL_RESULTS) },
    select: ['modelId', 'conductedAt'],
    order: { conductedAt: 'DESC' },
  });
  for (const r of rows) if (!out.has(r.modelId)) out.set(r.modelId, r.conductedAt);
  return out;
}

export async function latestSuccessfulDrill(repo: Repository<BcpDrillEntity>, modelId: string): Promise<Date | null> {
  return (await latestSuccessfulDrills(repo, [modelId])).get(modelId) ?? null;
}
