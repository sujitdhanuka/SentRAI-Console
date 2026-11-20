import { changeControl, ControlAssessment, ControlStateError, controlViews, frameworkHeading, registryIdForV1Label } from './controls';
import { frameworkApplicability, SEED_FRAMEWORKS } from './registry/registry';

const at = new Date('2026-11-20T10:00:00Z');
const key = { framework_id: 'nist-ai-rmf-1.0', framework_revision: 1, control_id: 'MEASURE-2' };
const ev = (type = 'DOCUMENT') => [{ ref: 'doc://x', type, added_by: 'a@x.test', added_at: at.toISOString() }];
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ControlStateError).code;
  }
  return null;
};

describe('control assessments', () => {
  it('moves only on a named person, with justification or evidence where needed', () => {
    expect(code(() => changeControl(null, key, { status: 'IMPLEMENTED', evidence_refs: ev() }, 'system:scan', at))).toBe('HUMAN_REQUIRED');
    expect(code(() => changeControl(null, key, { status: 'COMPLIANT' }, 'a@x.test', at))).toBe('BAD_STATUS');
    expect(code(() => changeControl(null, key, { status: 'NOT_APPLICABLE', justification: 'no' }, 'a@x.test', at))).toBe('JUSTIFICATION_REQUIRED');
    expect(code(() => changeControl(null, key, { status: 'GAP_IDENTIFIED' }, 'a@x.test', at))).toBe('JUSTIFICATION_REQUIRED');
    expect(code(() => changeControl(null, key, { status: 'IMPLEMENTED' }, 'a@x.test', at))).toBe('EVIDENCE_REQUIRED');
    const na = changeControl(null, key, { status: 'NOT_APPLICABLE', justification: 'Not deployed to people; offline batch only.' }, 'a@x.test', at);
    expect(na).toMatchObject({ status: 'NOT_APPLICABLE', assessed_by: 'a@x.test', framework_revision: 1 });
  });

  it('needs a different person to verify, and verified evidence before an effectiveness test', () => {
    const impl = changeControl(null, key, { status: 'IMPLEMENTED', evidence_refs: ev() }, 'a@x.test', at);
    expect(impl.implemented_by).toBe('a@x.test');
    expect(code(() => changeControl(impl, key, { status: 'EFFECTIVENESS_TESTED', evidence_refs: ev('TEST_REPORT') }, 'b@x.test', at))).toBe('NOT_VERIFIED');
    expect(code(() => changeControl(impl, key, { status: 'EVIDENCE_VERIFIED' }, 'a@x.test', at))).toBe('SAME_PERSON');
    expect(code(() => changeControl(null, key, { status: 'EVIDENCE_VERIFIED', evidence_refs: ev() }, 'b@x.test', at))).toBe('NOT_IMPLEMENTED');
    const ver = changeControl(impl, key, { status: 'EVIDENCE_VERIFIED' }, 'b@x.test', at);
    expect(ver).toMatchObject({ status: 'EVIDENCE_VERIFIED', verified_by: 'b@x.test', implemented_by: 'a@x.test' });
    expect(code(() => changeControl(ver, key, { status: 'EFFECTIVENESS_TESTED' }, 'b@x.test', at))).toBe('TEST_EVIDENCE_REQUIRED');
    const tested = changeControl(ver, key, { status: 'EFFECTIVENESS_TESTED', evidence_refs: [...ev(), ...ev('TEST_REPORT')] }, 'c@x.test', at);
    expect(tested.status).toBe('EFFECTIVENESS_TESTED');
    // Re-implementing clears the verification.
    expect(changeControl(tested, key, { status: 'IMPLEMENTED' }, 'c@x.test', at).verified_by).toBeNull();
  });

  it('shows APPLICABLE, never more, until a person assesses it, however many linked fields are filled', () => {
    const [nist] = frameworkApplicability(SEED_FRAMEWORKS.filter((f) => f.framework_id === 'nist-ai-rmf-1.0'), {
      recordType: 'AI_MODEL', facts: {}, adopted: new Set(['nist-ai-rmf-1.0']), at,
    });
    const filled = new Set(nist.controls.flatMap((c) => c.linked_field_ids));
    const views = controlViews(nist, [], filled);
    expect(views.length).toBe(nist.controls.length);
    expect(views.every((v) => v.status === 'APPLICABLE')).toBe(true);
    expect(views.some((v) => v.linked_fields_filled > 0)).toBe(true);

    const a: ControlAssessment = { ...changeControl(null, key, { status: 'GAP_IDENTIFIED', justification: 'No evaluation plan exists yet.' }, 'a@x.test', at), framework_revision: 0 };
    const withA = controlViews(nist, [a], filled).find((v) => v.control_id === 'MEASURE-2')!;
    expect(withA).toMatchObject({ status: 'GAP_IDENTIFIED', stale_revision: true });
  });

  it('labels ISO/IEC 42001 as organisational and never uses compliant or certified', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, { recordType: 'AI_MODEL', facts: {}, adopted: new Set(['iso-42001-2023', 'nist-ai-rmf-1.0']), at });
    const iso = rows.find((f) => f.framework_id === 'iso-42001-2023')!;
    expect(frameworkHeading(iso)).toMatch(/evidence supporting Annex A controls .*cannot show conformity/);
    expect(rows.map(frameworkHeading).join(' ')).not.toMatch(/\bcompliant\b|certif/i);
  });

  it('maps v1 framework labels to registry entries', () => {
    expect(registryIdForV1Label('ISO/IEC 42001')).toBe('iso-42001-2023');
    expect(registryIdForV1Label('ISO 42001')).toBe('iso-42001-2023');
    expect(registryIdForV1Label('NIST AI RMF')).toBe('nist-ai-rmf-1.0');
    expect(registryIdForV1Label('RBI FREE-AI')).toBeNull();
  });
});
