import { ModelType, RiskLevel } from '../common/enums';
import { DiscoveredCandidate } from './codebase-scanner';
import { locationOfCandidate, sourceLocationsOf, upsertLocation } from './source-locations';

const cand = (over: Partial<DiscoveredCandidate> = {}): DiscoveredCandidate => ({
  suggestedName: 'fraud_model',
  filePath: 'src/fraud.py',
  modelTypeGuess: ModelType.MACHINE_LEARNING,
  functionalAreaGuess: 'fraud_detection',
  riskHint: RiskLevel.MEDIUM,
  confidence: 'HIGH',
  domainTags: [],
  signals: [],
  tools: [],
  toolDetails: [],
  gaps: [],
  description: '',
  prompts: [],
  secrets: [],
  ...over,
});

describe('source locations', () => {
  it('collects unique sorted lines from signals, tools and secrets', () => {
    const loc = locationOfCandidate(cand({
      signals: [
        { category: 'ml_framework', pattern: 'sklearn', lineNumber: 12, snippet: '' },
        { category: 'ast_llm_sdk', pattern: 'x', lineNumber: 3, snippet: '' },
        { category: 'decision_function', pattern: 'y', lineNumber: 12, snippet: '' },
      ],
      toolDetails: [{ id: 'tool:x', label: 'x', category: 'named_tool', line: 40, snippet: '' }],
      secrets: [{ type: 'api_key', masked_value: 'sk-***', line: 7 }],
    }));
    expect(loc).toEqual({ file: 'src/fraud.py', lines: [3, 7, 12, 40] });
  });

  it('upserts a file in place without disturbing the others', () => {
    const start = [{ file: 'a.py', lines: [1] }, { file: 'b.py', lines: [2] }];
    expect(upsertLocation(start, { file: 'a.py', lines: [5, 6] })).toEqual([
      { file: 'a.py', lines: [5, 6] },
      { file: 'b.py', lines: [2] },
    ]);
    expect(upsertLocation(start, { file: 'c.py', lines: [9] })).toHaveLength(3);
    expect(upsertLocation(null, { file: 'c.py', lines: [9] })).toEqual([{ file: 'c.py', lines: [9] }]);
  });

  it('lists legacy files without lines', () => {
    expect(sourceLocationsOf({ sourceRefs: ['a.py', 'b.py'], sourceLocations: [{ file: 'b.py', lines: [4] }] })).toEqual([
      { file: 'a.py', lines: [] },
      { file: 'b.py', lines: [4] },
    ]);
    expect(sourceLocationsOf({ sourceRef: 'a.py' })).toEqual([{ file: 'a.py', lines: [] }]);
    expect(sourceLocationsOf({})).toEqual([]);
  });
});
