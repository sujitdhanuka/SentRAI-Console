/**
 * Base types for compliance framework plugins. Port of
 * src/sentrai/compliance/frameworks/base_plugin.py.
 */

export enum ControlSeverity {
  BLOCKING = 'BLOCKING',
  MAJOR = 'MAJOR',
  MINOR = 'MINOR',
}

export interface ControlResult {
  controlId: string;
  controlName: string;
  passed: boolean;
  severity: ControlSeverity;
  message: string;
  evidenceRequired: string[];
  remediation: string;
}

export interface PluginComplianceReport {
  frameworkId: string;
  frameworkName: string;
  frameworkVersion: string;
  assetId: string;
  overallPass: boolean;
  score: number; // 0.0 – 1.0
  blockingGaps: ControlResult[];
  majorGaps: ControlResult[];
  minorGaps: ControlResult[];
  passedControls: ControlResult[];
}

export interface ComplianceFrameworkPlugin {
  frameworkId: string;
  frameworkName: string;
  frameworkVersion: string;
  evaluate(asset: Record<string, any>): PluginComplianceReport;
}

export function control(
  controlId: string,
  controlName: string,
  passed: boolean,
  severity: ControlSeverity,
  message: string,
  remediation = '',
): ControlResult {
  return { controlId, controlName, passed, severity, message, evidenceRequired: [], remediation };
}

export function totalControls(r: PluginComplianceReport): number {
  return r.blockingGaps.length + r.majorGaps.length + r.minorGaps.length + r.passedControls.length;
}

export function pluginSummary(r: PluginComplianceReport): Record<string, any> {
  return {
    framework_id: r.frameworkId,
    framework_name: r.frameworkName,
    overall_pass: r.overallPass,
    score: Math.round(r.score * 1000) / 1000,
    blocking_gaps: r.blockingGaps.length,
    major_gaps: r.majorGaps.length,
    minor_gaps: r.minorGaps.length,
    passed_controls: r.passedControls.length,
    total_controls: totalControls(r),
  };
}

/** Partitions a control-result list into a report by severity of the failures. */
export function buildReport(
  meta: { frameworkId: string; frameworkName: string; frameworkVersion: string; assetId: string },
  results: ControlResult[],
): PluginComplianceReport {
  const blocking = results.filter((r) => !r.passed && r.severity === ControlSeverity.BLOCKING);
  const major = results.filter((r) => !r.passed && r.severity === ControlSeverity.MAJOR);
  const minor = results.filter((r) => !r.passed && r.severity === ControlSeverity.MINOR);
  const passed = results.filter((r) => r.passed);
  const score = results.length ? passed.length / results.length : 0.0;
  return {
    ...meta,
    overallPass: blocking.length === 0,
    score,
    blockingGaps: blocking,
    majorGaps: major,
    minorGaps: minor,
    passedControls: passed,
  };
}
