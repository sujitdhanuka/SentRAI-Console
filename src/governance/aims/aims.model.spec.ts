/** E1.6 AIMS record rules and ORG controls. */
import { flagSet } from '../../common/feature-flags';
import { getControl } from '../controls/control-library';
import { checkContent, missingRec14, REC14_SECTIONS } from './aims.model';

const run = (id: string, org: Record<string, any>, opts: Record<string, any> = {}) =>
  getControl(id)!.evaluate({ entry: {} as any, ctx: { org }, params: { values: {}, sources: {} }, flags: flagSet(true), opts, now: new Date('2026-11-18') });

describe('AIMS record content', () => {
  it('requires the fields each type evidences', () => {
    expect(checkContent('SCOPE', { boundaries: 'x' })).toEqual(['content.ai_systems is required']);
    expect(checkContent('POLICY', { sections: {} }).length).toBe(4);
    expect(checkContent('NOPE', {})).toEqual(['unknown record type NOPE']);
  });
  it('audit programme auditors must be independent (ISO 9.2)', () => {
    const p = checkContent('AUDIT_PROGRAMME', { period: '2027', audits: [{ area: 'a', planned_date: '2027-01-01', auditor: 'me', auditor_independent: false }] });
    expect(p.join()).toMatch(/cannot audit their own work/);
  });
  it('a management review cannot be dated in the future (review L4)', () => {
    expect(checkContent('MGMT_REVIEW', { review_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) }).join()).toMatch(/future/);
    expect(checkContent('MGMT_REVIEW', { review_date: new Date().toISOString().slice(0, 10) })).toEqual([]);
  });
  it('lists missing RBI Rec 14 policy sections', () => {
    expect(missingRec14({ sections: { accountability: 'x' } })).toEqual(REC14_SECTIONS.filter((s) => s !== 'accountability'));
  });
});

describe('ORG controls', () => {
  it('internal audit: a programme with a non-independent auditor fails with its own key (review M6)', () => {
    const mixed = run('CTL-ORG-AUDIT', { auditProgramme: { planned: 3, independent: 2 } });
    expect(mixed).toMatchObject({ passed: false, key: 'not_independent' });
    expect(mixed.facts).toMatchObject({ planned: 3, not_independent: 1 });
    expect(run('CTL-ORG-AUDIT', { auditProgramme: { planned: 2, independent: 2 } })).toMatchObject({ passed: true, key: 'pass' });
    expect(run('CTL-ORG-AUDIT', { auditProgramme: { planned: 0, independent: 0 } })).toMatchObject({ passed: false, key: 'missing' });
  });
  it('a record control fails when missing or past review', () => {
    expect(run('CTL-ORG-SCOPE', { records: { SCOPE: { approved: 0, overdue: 0 } } }).key).toBe('missing');
    expect(run('CTL-ORG-SCOPE', { records: { SCOPE: { approved: 1, overdue: 1 } } }).key).toBe('review_overdue');
    expect(run('CTL-ORG-SCOPE', { records: { SCOPE: { approved: 1, overdue: 0 } } }).passed).toBe(true);
  });
  it('people-side items set as customer responsibility are reported, never silently passed', () => {
    const r = run('CTL-ORG-AWARENESS', { peopleItems: { awareness: { mode: 'CUSTOMER', owner: 'HR' } }, records: { AWARENESS: { approved: 3 } } });
    expect(r).toMatchObject({ passed: false, notAssessed: true, key: 'customer' });
  });
  it('management review must be within 12 months; policy needs Rec 14 sections only when asked', () => {
    expect(run('CTL-ORG-MGMT-REVIEW', { lastMgmtReviewAt: '2025-06-01' }).key).toBe('stale');
    expect(run('CTL-ORG-MGMT-REVIEW', { lastMgmtReviewAt: '2026-06-01' }).passed).toBe(true);
    const policy = { approvedAt: '2026-01-01', approvedBy: 'ciso', overdue: false, missingRec14: ['liability'] };
    expect(run('CTL-ORG-POLICY', { policy }).passed).toBe(true);
    expect(run('CTL-ORG-POLICY', { policy }, { rec14: true }).key).toBe('rec14_missing');
  });
  it('corrective actions: overdue fails; register off is NOT ASSESSED', () => {
    expect(run('CTL-ORG-CA', { correctiveActions: { open: 2, overdue: 1, closed: 0 } }).passed).toBe(false);
    expect(run('CTL-ORG-CA', {}).notAssessed).toBe(true);
  });
});
