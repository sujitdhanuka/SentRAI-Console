import { useEffect, useState } from 'react';

import { api } from './client';
import { useSession } from '../stores/session';

export interface ModelRow {
  model_id: string;
  name: string;
  risk_level: string;
  lifecycle_stage: string;
  project_id: string | null;
  compliance_pass: boolean;
  open_gap_count: number;
  owner_team: string | null;
  registered_at: string;
}

/** Shared model list, scoped to the active project — used by the pages that
 *  operate on one model at a time (monitoring, audit, incidents, lineage). */
export function useModels(): { models: ModelRow[]; loading: boolean } {
  const activeProjectId = useSession((s) => s.activeProjectId);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = activeProjectId ? `?project_id=${encodeURIComponent(activeProjectId)}` : '';
    api<ModelRow[]>(`/inventory/models${qs}`)
      .then((rows) => !cancelled && setModels(rows))
      .catch(() => !cancelled && setModels([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  return { models, loading };
}
