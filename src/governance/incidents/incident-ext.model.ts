/**
 * Incident extensions (E3.3): webhook payloads for ITSM (Jira, ServiceNow)
 * and SIEM / SOC, the CISA playbook mapping, and the closure rule. Pure
 * functions, so payload shapes and rules are unit-tested.
 */
import { createHmac } from 'crypto';

export const INTEGRATION_KINDS = ['JIRA', 'SERVICENOW', 'SIEM', 'WEBHOOK'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const INTEGRATION_EVENTS = ['INCIDENT_REPORTED', 'INCIDENT_PUSHED', 'DRIFT_ALERT', 'RED_TEAM_FINDING', 'RISK_ESCALATION'] as const;
export const SERIOUS = ['P1_CRITICAL', 'P2_HIGH'];

export interface IncidentLike {
  id: string;
  modelId: string;
  modelName: string;
  severity: string;
  status: string;
  incidentCategory: string;
  description: string;
  reportingDeadline: Date;
  createdAt: Date;
  affectedConsumers?: Record<string, any> | null;
  systemSuspended?: boolean;
  fallbackActivated?: boolean;
  seniorSignOffAt?: Date | null;
  affectedPartiesNotifiedAt?: Date | null;
  governanceExt?: Record<string, any> | null;
}

const PRIORITY: Record<string, { jira: string; snow: number; siem: number }> = {
  P1_CRITICAL: { jira: 'Highest', snow: 1, siem: 10 },
  P2_HIGH: { jira: 'High', snow: 2, siem: 8 },
  P3_MEDIUM: { jira: 'Medium', snow: 3, siem: 5 },
  P4_LOW: { jira: 'Low', snow: 3, siem: 3 },
};

const summary = (i: IncidentLike) => `[SentRAI ${i.severity}] ${i.incidentCategory.replace(/_/g, ' ').toLowerCase()} on ${i.modelName}`.slice(0, 250);

/** Jira Cloud "create issue" body (REST v2: plain-text description). */
export function jiraPayload(i: IncidentLike, opts: { projectKey?: string; issueType?: string } = {}) {
  return {
    fields: {
      project: { key: opts.projectKey || 'AI' },
      issuetype: { name: opts.issueType || 'Incident' },
      summary: summary(i),
      priority: { name: PRIORITY[i.severity]?.jira ?? 'Medium' },
      labels: ['sentrai', 'ai-incident', i.incidentCategory.toLowerCase()],
      description: `${i.description}\n\nModel: ${i.modelName} (${i.modelId})\nRegulatory reporting deadline: ${i.reportingDeadline.toISOString()}\nSentRAI incident: ${i.id}`,
    },
  };
}

/** ServiceNow Table API body for the incident table. */
export function serviceNowPayload(i: IncidentLike) {
  const p = PRIORITY[i.severity]?.snow ?? 3;
  return {
    short_description: summary(i),
    description: `${i.description}\n\nModel: ${i.modelName} (${i.modelId})\nRegulatory reporting deadline: ${i.reportingDeadline.toISOString()}`,
    urgency: String(p),
    impact: String(p),
    category: 'AI system',
    correlation_id: i.id,
    correlation_display: 'SentRAI',
  };
}

/** SIEM / SOC event (CEF-like JSON, one event per alert). */
export function siemEvent(event: string, orgId: string, data: { modelId: string; modelName?: string | null; severity?: string | null; ref?: string | null; detail?: string | null }) {
  return {
    vendor: 'SentRAI',
    product: 'AI governance',
    version: '1',
    event_class: event,
    name: event.replace(/_/g, ' ').toLowerCase(),
    severity: data.severity ? PRIORITY[data.severity]?.siem ?? 5 : event === 'DRIFT_ALERT' ? 6 : 5,
    time: new Date().toISOString(),
    tenant: orgId,
    model_id: data.modelId,
    model_name: data.modelName ?? null,
    reference: data.ref ?? null,
    detail: data.detail ?? null,
  };
}

/** HMAC signature for generic and SIEM webhooks (header X-SentRAI-Signature). */
export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** A ticket reference from an ITSM response (Jira `key`, ServiceNow `result.number`). */
export function ticketRef(kind: IntegrationKind, body: any): string | null {
  if (kind === 'JIRA' && typeof body?.key === 'string') return body.key;
  if (kind === 'SERVICENOW' && typeof body?.result?.number === 'string') return body.result.number;
  return null;
}

/* ----------------------------------------------------------- CISA playbook */

export const CISA_PHASES = ['PREPARATION', 'DETECTION_ANALYSIS', 'CONTAINMENT', 'ERADICATION_RECOVERY', 'POST_INCIDENT', 'COORDINATION'] as const;

/** Threat vector (US-CERT federal incident notification guidelines) for each incident category. */
const VECTOR: Record<string, string> = {
  ADVERSARIAL_ATTACK: 'Other: AI adversarial attack (evasion, poisoning, extraction or prompt injection)',
  DATA_PRIVACY_BREACH: 'Improper Usage',
  UNINTENDED_AUTONOMOUS_ACTION: 'Improper Usage',
  SYSTEM_UNAVAILABILITY: 'Attrition',
};

const FUNCTIONAL_IMPACT: Record<string, string> = { P1_CRITICAL: 'High', P2_HIGH: 'Medium', P3_MEDIUM: 'Low', P4_LOW: 'None' };

export function cisaMapping(i: IncidentLike) {
  const security = ['ADVERSARIAL_ATTACK', 'DATA_PRIVACY_BREACH'].includes(i.incidentCategory);
  const manual = (i.governanceExt?.cisaPhases ?? {}) as Record<string, { done: boolean; note?: string; at?: string }>;
  const derived: Record<string, boolean> = {
    PREPARATION: true,
    DETECTION_ANALYSIS: i.status !== 'REPORTED',
    CONTAINMENT: Boolean(i.systemSuspended || i.fallbackActivated) || ['REMEDIATION_IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(i.status),
    ERADICATION_RECOVERY: ['RESOLVED', 'CLOSED'].includes(i.status),
    POST_INCIDENT: i.status === 'CLOSED',
    COORDINATION: Boolean(i.affectedPartiesNotifiedAt) || Boolean(i.governanceExt?.dta),
  };
  return {
    threat_vector: VECTOR[i.incidentCategory] ?? 'Other',
    functional_impact: FUNCTIONAL_IMPACT[i.severity] ?? 'Low',
    information_impact: i.incidentCategory === 'DATA_PRIVACY_BREACH' ? 'Privacy' : 'None',
    cybersecurity_incident: security,
    // Federal agencies report confirmed cyber incidents to CISA within one hour (applies to US federal customers).
    cisa_report_hours: security ? 1 : null,
    phases: CISA_PHASES.map((p) => ({ phase: p, done: manual[p]?.done ?? derived[p], source: manual[p] ? 'RECORDED' : 'DERIVED', note: manual[p]?.note ?? null })),
  };
}

/* ----------------------------------------------------------- closure rule */

export function affectedCount(i: IncidentLike): number {
  return Number(i.affectedConsumers?.count ?? 0) || 0;
}

/** Why a serious incident cannot be resolved or closed yet, or null. */
export function closeBlocker(i: IncidentLike): string | null {
  if (!SERIOUS.includes(i.severity)) return null;
  if (!i.seniorSignOffAt) return 'A P1 or P2 incident needs senior executive sign-off before it is resolved or closed';
  if (affectedCount(i) > 0 && !i.affectedPartiesNotifiedAt && !i.governanceExt?.notice?.notRequiredReason) {
    return 'Record the notice to the affected people (or why none is needed) before resolving or closing';
  }
  return null;
}

/** Facts for CTL-INC-02. */
export function incidentFacts(rows: IncidentLike[]) {
  const serious = rows.filter((r) => SERIOUS.includes(r.severity));
  const done = (r: IncidentLike) => ['RESOLVED', 'CLOSED'].includes(r.status);
  return {
    serious: serious.length,
    closedWithoutSignOff: serious.filter((r) => done(r) && !r.seniorSignOffAt).length,
    openSeriousUnnotified: serious.filter((r) => affectedCount(r) > 0 && !r.affectedPartiesNotifiedAt && !r.governanceExt?.notice?.notRequiredReason).length,
  };
}

/** Webhook URL rules: https only, no credentials, no loopback / private literal hosts (unless explicitly allowed). */
export function webhookUrlProblem(raw: string, allowPrivate = false): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'url must be a valid https URL';
  }
  if (u.protocol !== 'https:') return 'url must use https';
  if (u.username || u.password) return 'put credentials in the secret, not the URL';
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const priv = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|::1?|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|f[cd][0-9a-f]{2}:.*|fe80:.*)$/i;
  if (!allowPrivate && priv.test(h)) return 'url must not point at a private, loopback or link-local address';
  return null;
}
