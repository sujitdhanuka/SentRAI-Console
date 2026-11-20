import { aggregateObserved, canonicalModel, cleanEntries, isConfirmedCall, llmModelsStatus, LlmModelsAttestation, sameModel } from './llm-models';

const att = (entries: LlmModelsAttestation['entries']): LlmModelsAttestation => ({ entries, confirmed_by: 'owner@example.com', confirmed_at: '2026-11-20T00:00:00.000Z' });

describe('model id matching', () => {
  it('ignores vendor prefix, dated snapshots and variant suffixes', () => {
    expect(canonicalModel('openai/gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(canonicalModel('meta-llama/llama-3.1-8b-instruct:free')).toBe('llama-3.1-8b-instruct');
    expect(canonicalModel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet');
    expect(sameModel('openai/gpt-4o', 'gpt-4o-2024-08-06')).toBe(true);
    expect(sameModel('openai/gpt-4o', 'openai/gpt-4o-mini')).toBe(false);
  });
});

describe('isConfirmedCall', () => {
  const confirmed = att([
    { task: 'summary', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' },
    { task: 'chat', provider: 'OpenRouter', model: 'openai/gpt-4o' },
  ]);

  it('is null until models are confirmed', () => {
    expect(isConfirmedCall(null, { model: 'openai/gpt-4o' })).toBeNull();
  });

  it('checks the served model against the list for that task', () => {
    expect(isConfirmedCall(confirmed, { task: 'summary', model: 'moonshotai/kimi-k2' })).toBe(true);
    expect(isConfirmedCall(confirmed, { task: 'summary', model: 'openai/gpt-4o' })).toBe(false);
    expect(isConfirmedCall(confirmed, { task: 'chat', model: 'openai/gpt-4o', response_model: 'openai/gpt-4o-2024-08-06' })).toBe(true);
  });

  it('flags a gateway fallback to a model outside the list', () => {
    expect(isConfirmedCall(confirmed, { task: 'chat', model: 'openai/gpt-4o', response_model: 'mistralai/mistral-large' })).toBe(false);
  });

  it('uses the whole list when the call names no known task', () => {
    expect(isConfirmedCall(confirmed, { model: 'openai/gpt-4o' })).toBe(true);
    expect(isConfirmedCall(confirmed, { task: 'translate', model: 'moonshotai/kimi-k2' })).toBe(true);
  });

  it('accepts anything for a task confirmed as openrouter/auto', () => {
    expect(isConfirmedCall(att([{ task: 'chat', provider: 'OpenRouter', model: 'openrouter/auto' }]), { task: 'chat', model: 'openrouter/auto', response_model: 'anthropic/claude-sonnet-4' })).toBe(true);
  });
});

describe('aggregateObserved and status', () => {
  const ev = (llm: Record<string, string>, at: string) => ({ detail: { llm }, occurredAt: new Date(at) });
  const events = [
    ev({ task: 'summary', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' }, '2026-11-19T10:00:00Z'),
    ev({ task: 'summary', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' }, '2026-11-19T11:00:00Z'),
    ev({ task: 'chat', provider: 'OpenRouter', model: 'openai/gpt-4o', response_model: 'mistralai/mistral-large' }, '2026-11-19T12:00:00Z'),
  ];

  it('groups calls by task and served model', () => {
    const rows = aggregateObserved(events, att([{ task: 'summary', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' }]));
    expect(rows).toHaveLength(2);
    const summary = rows.find((r) => r.task === 'summary')!;
    expect(summary).toMatchObject({ calls: 2, confirmed: true, first_seen: '2026-11-19T10:00:00.000Z', last_seen: '2026-11-19T11:00:00.000Z' });
    const chat = rows.find((r) => r.task === 'chat')!;
    expect(chat).toMatchObject({ model: 'mistralai/mistral-large', requested_models: ['openai/gpt-4o'], confirmed: false });
  });

  it('derives the record status', () => {
    const a = att([{ task: 'summary', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' }]);
    expect(llmModelsStatus(false, null, [])).toBe('not_applicable');
    expect(llmModelsStatus(true, null, [])).toBe('unconfirmed');
    expect(llmModelsStatus(true, a, aggregateObserved(events.slice(0, 2), a))).toBe('confirmed');
    expect(llmModelsStatus(true, a, aggregateObserved(events, a))).toBe('mismatch');
  });
});

describe('cleanEntries', () => {
  it('drops empty rows, defaults the task and de-duplicates', () => {
    expect(cleanEntries([
      { task: '', provider: 'OpenRouter', model: 'openai/gpt-4o' },
      { task: 'default', provider: 'OpenRouter', model: 'gpt-4o' },
      { task: 'chat', provider: '', model: '  ' },
    ])).toEqual([{ task: 'default', provider: 'OpenRouter', model: 'openai/gpt-4o' }]);
  });
});
