/**
 * Module D domain — AI incident SLA helpers (REC 22).
 * Port of the SLA logic in src/sentrai/domain/incident.py.
 */
import { IncidentSeverity } from '../common/enums';

/** Severity → reporting SLA in hours (per SentrAI Rec 22). */
export const REPORTING_SLA_HOURS: Record<IncidentSeverity, number> = {
  [IncidentSeverity.P1_CRITICAL]: 6,
  [IncidentSeverity.P2_HIGH]: 24,
  [IncidentSeverity.P3_MEDIUM]: 72,
  [IncidentSeverity.P4_LOW]: 168, // 7 days
};

/** Reporting deadline computed from the observation time + severity SLA. */
export function computeReportingDeadline(observedAt: Date, severity: IncidentSeverity): Date {
  const hours = REPORTING_SLA_HOURS[severity];
  return new Date(observedAt.getTime() + hours * 3_600_000);
}

/** An incident is overdue only if it was never reported and the deadline has passed. */
export function isOverdue(reportingDeadline: Date, reportedAt: Date | null): boolean {
  if (reportedAt !== null) return false;
  return Date.now() > reportingDeadline.getTime();
}

export function hoursUntilDeadline(reportingDeadline: Date): number {
  return (reportingDeadline.getTime() - Date.now()) / 3_600_000;
}
