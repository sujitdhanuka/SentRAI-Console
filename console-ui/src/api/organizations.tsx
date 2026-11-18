import { useEffect, useState } from 'react';

import { useSession } from '../stores/session';
import { api } from './client';

export interface AssignableOrg {
  organization_id: string;
  name: string;
}

/**
 * Organizations the signed-in user may place users and projects in. Only a
 * global (organization-less) OWNER or ADMIN chooses; everyone else always
 * works in their own organization, so `canChoose` is false for them.
 */
export function useAssignableOrgs(): { orgs: AssignableOrg[]; canChoose: boolean } {
  const user = useSession((s) => s.user);
  const canChoose = !user?.tenant_id && (user?.role === 'ADMIN' || user?.role === 'OWNER');
  const [orgs, setOrgs] = useState<AssignableOrg[]>([]);
  useEffect(() => {
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) return;
    let cancelled = false;
    api<AssignableOrg[]>('/users/organizations')
      .then((rows) => !cancelled && setOrgs(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);
  return { orgs, canChoose };
}

/** A select of organizations, with an explicit "none" option. */
export function OrgSelect({
  value,
  onChange,
  orgs,
  className,
  label,
  noneLabel = 'No organization',
}: {
  value: string;
  onChange: (v: string) => void;
  orgs: AssignableOrg[];
  className?: string;
  label: string;
  noneLabel?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{noneLabel}</option>
      {orgs.map((o) => (
        <option key={o.organization_id} value={o.organization_id}>{o.name}</option>
      ))}
    </select>
  );
}
