/**
 * Model card v2: owner fields must name a human (spec §11.1, defect D8).
 *
 * Accountable, technical and business owners point at a user record, never at
 * free text. A user whose accountType is SERVICE, an inactive user or a user
 * in another organisation is refused. Free text such as "Admin Dhancept" in
 * the v1 `ownerTeam` column is kept for history but does not fill the field.
 */

export const ACCOUNT_TYPES = ['HUMAN', 'SERVICE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface OwnerCandidate {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  tenantId: string | null;
  role: string;
  /** Missing on rows written before the column existed: read as HUMAN. */
  accountType?: string | null;
}

export type OwnerCheck = { ok: true } | { ok: false; code: 'OWNER_NOT_FOUND' | 'OWNER_SERVICE_ACCOUNT' | 'OWNER_INACTIVE' | 'OWNER_OTHER_ORG'; message: string };

/** Is this user acceptable as an owner of a record in `orgId`? Platform ADMINs (no tenant) may own records in any org. */
export function checkOwner(user: OwnerCandidate | null | undefined, orgId: string | null): OwnerCheck {
  if (!user) return { ok: false, code: 'OWNER_NOT_FOUND', message: 'The owner must be a named user in SentRAI.' };
  const who = user.fullName || user.email;
  if ((user.accountType ?? 'HUMAN') === 'SERVICE') {
    return { ok: false, code: 'OWNER_SERVICE_ACCOUNT', message: `${who} is a service account. An owner must be a named person.` };
  }
  if (!user.isActive) return { ok: false, code: 'OWNER_INACTIVE', message: `${who} is deactivated.` };
  if (user.tenantId !== null && orgId !== null && user.tenantId !== orgId) {
    return { ok: false, code: 'OWNER_OTHER_ORG', message: `${who} belongs to another organisation.` };
  }
  return { ok: true };
}
