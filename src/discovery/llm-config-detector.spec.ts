import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { detectInFile, detectLlmConfig, isLlmCandidate, llmConfigForRecord } from './llm-config-detector';

/** A small app that talks to OpenRouter and keeps its models in the database. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'llmcfg-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const APP = {
  'src/llm.ts': [
    "import OpenAI from 'openai';",
    "const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY });",
    'export async function run(task: string, prompt: string) {',
    "  const row = await db.query('SELECT model FROM ai_task_models WHERE task = ?', [task]);",
    "  const model = row?.model ?? process.env.DEFAULT_LLM_MODEL ?? 'openai/gpt-4o-mini';",
    "  const summary = await getSetting('llm.summary_model');",
    "  return client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }] });",
    '}',
  ].join('\n'),
  'migrations/001_init.sql': [
    'CREATE TABLE ai_task_models (',
    '  id INTEGER PRIMARY KEY,',
    '  task VARCHAR(50) NOT NULL,',
    "  model VARCHAR(200) NOT NULL DEFAULT 'anthropic/claude-3.5-sonnet',",
    '  temperature REAL',
    ');',
    "INSERT INTO ai_task_models (task, model) VALUES ('summary', 'moonshotai/kimi-k2'), ('chat', 'openai/gpt-4o');",
  ].join('\n'),
  'prisma/schema.prisma': 'model AppSettings {\n  id        Int    @id\n  chatModel String @default("google/gemini-2.5-flash")\n  theme     String\n}\n',
  'src/db/agent-config.entity.ts': "@Entity('agent_config')\nexport class AgentConfig {\n  @Column() agentName!: string;\n  @Column({ nullable: true })\n  llmModel!: string;\n}\n",
  '.env.example': 'OPENROUTER_API_KEY=\nDEFAULT_LLM_MODEL=openai/gpt-4o-mini\n',
  // A real .env holds secrets: it must never be read.
  '.env': 'SECRET_MODEL=openai/gpt-should-not-be-read\n',
};

describe('detectLlmConfig', () => {
  let root: string;
  beforeAll(() => { root = fixture(APP); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('names the provider behind an OpenAI-compatible client', () => {
    expect(detectLlmConfig(root).providers).toEqual(['OpenRouter']);
  });

  it('finds where the model is stored at runtime, and that it is per task', () => {
    const r = detectLlmConfig(root);
    const where = Object.fromEntries(r.storage.map((s) => [s.location, s]));
    expect(where['ai_task_models.model']).toMatchObject({ kind: 'db_column', keyed_by: ['task'], file: 'migrations/001_init.sql', line: 4 });
    expect(where['AppSettings.chatModel']).toMatchObject({ kind: 'db_column' });
    expect(where['agent_config.llmModel']).toMatchObject({ kind: 'db_column', keyed_by: ['agentName'] });
    expect(where['llm.summary_model']).toMatchObject({ kind: 'settings_key' });
    expect(where.DEFAULT_LLM_MODEL).toMatchObject({ kind: 'env_var' });
    expect(r.runtime_configured).toBe(true);
    expect(r.per_task).toBe(true);
  });

  it('lists concrete model ids from defaults and seed rows', () => {
    const models = Object.fromEntries(detectLlmConfig(root).candidate_models.map((m) => [m.model, m]));
    expect(models['anthropic/claude-3.5-sonnet'].roles).toContain('default');
    expect(models['moonshotai/kimi-k2']).toMatchObject({ provider: 'Moonshot', roles: ['seed'] });
    expect(models['openai/gpt-4o-mini'].roles).toContain('default');
    expect(models['google/gemini-2.5-flash']).toBeDefined();
  });

  it('never reads a real .env file', () => {
    const r = detectLlmConfig(root);
    expect(r.findings.some((f) => f.file === '.env')).toBe(false);
    expect(r.candidate_models.some((m) => m.model.includes('should-not-be-read'))).toBe(false);
  });

  it('keeps project-wide storage but only this record\'s literals', () => {
    const r = detectLlmConfig(root);
    const rec = llmConfigForRecord(r, ['src/other.ts'])!;
    expect(rec.storage.map((s) => s.location)).toContain('ai_task_models.model');
    expect(rec.findings.some((f) => f.kind === 'provider_endpoint')).toBe(false);
    expect(rec.providers).toEqual(['OpenRouter']);
    expect(rec.record_files).toEqual(['src/other.ts']);
  });
});

describe('detectInFile false positives', () => {
  it('ignores foreign keys and product models', () => {
    const f = detectInFile('src/entities/incident.entity.ts', [
      "@Entity({ name: 'ai_incidents' })",
      'export class Incident {',
      "  @Column('varchar') modelId!: string;",
      "  @Column('varchar') modelName!: string;",
      '}',
      "@Entity('cars')",
      'export class Car {',
      "  @Column('varchar') model!: string;",
      '}',
    ].join('\n'));
    expect(f.filter((x) => x.kind === 'db_column')).toEqual([]);
  });

  it('ignores DOM ids and route params that contain "model"', () => {
    const f = detectInFile('public/app.js', "document.getElementById('btn-new-model'); router.get('/:model_id'); const k = 'per-model';");
    expect(f.filter((x) => x.kind === 'settings_key')).toEqual([]);
  });

  it('accepts a bare model column in an LLM settings table', () => {
    const f = detectInFile('src/ai-provider-config.entity.ts', "@Entity({ name: 'ai_provider_configs' })\nexport class C {\n  @Column('varchar', { length: 200 })\n  model!: string;\n}\n");
    expect(f.find((x) => x.kind === 'db_column')?.location).toBe('ai_provider_configs.model');
  });

  it('reads Django and SQLAlchemy model fields', () => {
    const dj = detectInFile('app/models.py', "class AssistantConfig(models.Model):\n    purpose = models.CharField(max_length=40)\n    llm_model = models.CharField(max_length=120, default='gpt-4o')\n");
    expect(dj.find((x) => x.kind === 'db_column')).toMatchObject({ location: 'AssistantConfig.llm_model', keyed_by: ['purpose'], model: 'gpt-4o' });
    const sa = detectInFile('app/db.py', "class Setting(Base):\n    __tablename__ = 'llm_settings'\n    default_model = Column(String(120))\n");
    expect(sa.find((x) => x.kind === 'db_column')?.location).toBe('llm_settings.default_model');
  });
});

describe('isLlmCandidate', () => {
  it('is true for LLM signals or generative types', () => {
    expect(isLlmCandidate({ signals: [{ category: 'llm_api_call' }] })).toBe(true);
    expect(isLlmCandidate({ signals: [{ category: 'ast_llm_sdk' }] })).toBe(true);
    expect(isLlmCandidate({ modelTypeGuess: 'GENERATIVE_AI', signals: [] })).toBe(true);
    expect(isLlmCandidate({ modelTypeGuess: 'MACHINE_LEARNING', signals: [{ category: 'ml_library_import' }] })).toBe(false);
  });
});
