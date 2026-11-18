/**
 * Regenerates test/fixtures/compliance-golden.json from the validators.
 * Run: npx ts-node test/fixtures/generate-golden.ts
 * The committed file is the E0.1 baseline taken before the Phase 0 label fixes;
 * only regenerate it on purpose, and explain every pass/fail change in the PR.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { validateEuAiAct, validateIso42001, validateNistRmf } from '../../src/compliance/frameworks.validator';
import { validateSutrasCompliance } from '../../src/compliance/sutras.validator';
import { COMPLIANCE_FIXTURES } from './compliance-fixtures';
import { flagSet } from '../../src/common/feature-flags';

// Pinned: the baseline is the flags-off output, whatever the shell environment says.
const OFF = flagSet(false);

const out = COMPLIANCE_FIXTURES.map(({ id, entry, ctx: base }) => {
  const ctx = { ...base, flags: OFF };
  const fw = (r: ReturnType<typeof validateNistRmf>) =>
    r.checks.map((c) => ({ code: c.controlCode, passed: c.passed, mandatory: c.mandatory }));
  return {
    id,
    sutras: validateSutrasCompliance(entry, { flags: OFF }).checks.map((c) => ({ code: c.sutra, passed: c.passed, mandatory: c.mandatory })),
    nist: fw(validateNistRmf(entry, ctx)),
    eu: fw(validateEuAiAct(entry, ctx)),
    iso: fw(validateIso42001(entry, ctx)),
  };
});
writeFileSync(join(__dirname, 'compliance-golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} fixtures`);
