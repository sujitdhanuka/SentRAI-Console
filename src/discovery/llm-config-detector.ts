/**
 * LLM configuration detector. The codebase scanner finds *that* an app calls an
 * LLM; this pass finds *which* model it calls, or, when the model is chosen at
 * runtime (a settings table edited from the app's own UI, an env var, a seed
 * row), *where* that choice is stored, so an owner can confirm the real models
 * and runtime telemetry can check them.
 *
 * Pure and filesystem-only: it never connects to the scanned app's database.
 * It reads schema/migration/ORM files, seeds, config and env templates as text.
 * Real `.env` files are never read (they hold secrets).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join, relative } from 'path';

export type LlmFindingKind = 'provider_endpoint' | 'model_literal' | 'db_column' | 'settings_key' | 'env_var';

export interface LlmConfigFinding {
  kind: LlmFindingKind;
  file: string;
  line: number;
  snippet: string;
  /** Provider the evidence points at (OpenRouter, OpenAI, …). */
  provider?: string;
  /** A concrete model id (a literal, a default, a seed value). */
  model?: string;
  /** Where the model is stored: `table.column`, a settings key or an env var. */
  location?: string;
  /** Other columns of the same table that look like a task dimension. */
  keyed_by?: string[];
  /** For literals: a schema/env default, a seed row, or plain code. */
  role?: 'default' | 'seed' | 'code';
  /** A generic key/value settings table (kept only when model settings keys exist). */
  kv?: boolean;
}

export interface LlmConfigSummary {
  scanned_at: string;
  providers: string[];
  /** True when any model choice is stored outside the code (DB, settings, env). */
  runtime_configured: boolean;
  /** True when the app looks like it picks different models for different tasks. */
  per_task: boolean;
  /** Distinct concrete model ids seen as literals, defaults or seeds. */
  candidate_models: Array<{ model: string; provider?: string; roles: string[]; count: number }>;
  /** Where the runtime choice is stored, deduplicated. */
  storage: Array<{ kind: 'db_column' | 'settings_key' | 'env_var'; location: string; keyed_by?: string[]; file: string; line: number }>;
  findings: LlmConfigFinding[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.turbo',
  'coverage', '.pytest_cache', '.mypy_cache', 'target', '.idea', '.vscode', 'vendor', '.worktrees',
]);
const CODE_EXT = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.java', '.rb', '.php', '.cs', '.kt']);
const CONFIG_EXT = new Set(['.sql', '.prisma', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.properties']);
/** Env templates only. A real `.env` holds secrets and is never read. */
const ENV_TEMPLATES = /^\.env\.(example|sample|template|dist|defaults)$|^(example|sample)\.env$/i;
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock', 'tsconfig.json']);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 5000;
const MAX_FINDINGS_PER_FILE = 40;
const MAX_FINDINGS = 400;

/** Host fragments of well-known LLM APIs and gateways. */
const PROVIDER_ENDPOINTS: Array<[RegExp, string]> = [
  [/openrouter\.ai/i, 'OpenRouter'],
  [/openai\.azure\.com|\.cognitiveservices\.azure\.com/i, 'Azure OpenAI'],
  [/api\.openai\.com/i, 'OpenAI'],
  [/api\.anthropic\.com/i, 'Anthropic'],
  [/bedrock-runtime|bedrock\.[a-z0-9-]+\.amazonaws\.com/i, 'AWS Bedrock'],
  [/generativelanguage\.googleapis\.com/i, 'Google Gemini'],
  [/aiplatform\.googleapis\.com/i, 'Google Vertex AI'],
  [/api\.groq\.com/i, 'Groq'],
  [/api\.together\.(xyz|ai)/i, 'Together AI'],
  [/api\.mistral\.ai/i, 'Mistral'],
  [/api\.deepseek\.com/i, 'DeepSeek'],
  [/api\.fireworks\.ai/i, 'Fireworks'],
  [/api\.cohere\.(ai|com)/i, 'Cohere'],
  [/api\.perplexity\.ai/i, 'Perplexity'],
  [/api\.x\.ai/i, 'xAI'],
  [/api\.moonshot\.(ai|cn)/i, 'Moonshot'],
  [/router\.huggingface\.co|api-inference\.huggingface\.co/i, 'Hugging Face'],
  [/localhost:11434|127\.0\.0\.1:11434|\bollama\b/i, 'Ollama'],
  [/@openrouter\/ai-sdk-provider|createOpenRouter|OPENROUTER_API_KEY/, 'OpenRouter'],
  [/litellm/i, 'LiteLLM'],
];

/** OpenRouter-style `vendor/model` slugs. */
const SLUG_VENDORS =
  'openai|anthropic|google|meta-llama|mistralai|deepseek|qwen|moonshotai|x-ai|cohere|nousresearch|microsoft|amazon|perplexity|z-ai|minimax|nvidia|01-ai|ai21|inflection|liquid|thudm|openrouter';
const SLUG_RE = new RegExp(`^(?:${SLUG_VENDORS})\\/[a-z0-9][\\w.:\\-]*$`, 'i');
const BARE_MODEL_RE =
  /^(?:gpt-[34][\w.\-]*|gpt-[5-9][\w.\-]*|gpt-oss[\w.\-]*|chatgpt-[\w.\-]+|o[134](?:-mini|-pro|-preview)?(?:-\d{4}-\d{2}-\d{2})?|claude-[\w.\-]+|gemini-[\w.\-]+|gemma[\d.]+[\w.:\-]*|gemma-[\w.\-]+|llama-?\d[\w.:\-]*|llama3[\w.:\-]*|mistral-[\w.\-]+|mixtral-[\w.\-]+|codestral[\w.\-]*|qwen[\d.]+[\w.:\-]*|qwen-[\w.\-]+|deepseek-[\w.\-]+|kimi-[\w.\-]+|command-r[\w.\-+]*|text-embedding-[\w\-]+|grok-[\w.\-]+|phi-?\d[\w.:\-]*)$/i;

const SLUG_PROVIDER: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'meta-llama': 'Meta', mistralai: 'Mistral',
  deepseek: 'DeepSeek', qwen: 'Qwen', moonshotai: 'Moonshot', 'x-ai': 'xAI', cohere: 'Cohere', openrouter: 'OpenRouter',
};

/** A column / field name that holds a model id. */
const MODEL_COL_RE =
  /^(?:(?:llm|ai|chat|completion|embedding|embed|summary|summari[sz]er|default|fallback|primary|secondary|selected|preferred|active|current|openrouter|openai|vision|reasoning|agent|base|router)_?)?model(?:_?(?:name|id|slug|key|identifier))?$|^(?:llm|ai)_?(?:engine|model_?config)$/i;
const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** Tables whose bare `model` column is plausibly an LLM id rather than a foreign key or a product model. */
const LLM_TABLE_HINT = /llm|gpt|openai|openrouter|provider|prompt|agent|setting|config|completion|chat|assistant|bot|usage|inference|generation|ai_?task|task_?model/i;
/**
 * camelCase-friendly (llmModel, defaultModelName). A bare `model_id`/`modelId`
 * is almost always a foreign key and never counts; a bare `model`/`model_name`
 * counts only in a table whose name suggests LLM configuration.
 */
function isModelColumn(name: string, table: string | null, hasModelDefault: boolean): boolean {
  const n = snake(name);
  if (!MODEL_COL_RE.test(n)) return false;
  if (/^model_?id$/.test(n)) return false;
  if (/^model(?:_?(?:name|slug|key|identifier))?$/.test(n)) return hasModelDefault || (table != null && LLM_TABLE_HINT.test(table));
  return true;
}
/** Columns that make a model table per-task. */
const TASK_COL_RE = /^(?:task|task_?(?:name|type|key)|purpose|use_?case|feature|agent(?:_?name)?|role|step|stage|job|workflow|capability|scope|context)$/i;
const isTaskColumn = (name: string): boolean => TASK_COL_RE.test(snake(name));
/** A settings key naming a model: `llm.model`, `summary_model`, `ai:default-model`. */
const SETTINGS_KEY_RE = /^[a-z][\w]*(?:[._:\-][\w]+)*$/i;
const ENV_MODEL_RE = /^[A-Z][A-Z0-9_]*MODEL[A-Z0-9_]*$/;

function isModelId(s: string): boolean {
  if (s.length < 3 || s.length > 120 || /\s/.test(s)) return false;
  return SLUG_RE.test(s) || BARE_MODEL_RE.test(s);
}

function providerOfModel(model: string): string | undefined {
  const slash = model.indexOf('/');
  if (slash > 0) return SLUG_PROVIDER[model.slice(0, slash).toLowerCase()];
  const m = model.toLowerCase();
  if (/^(gpt|o[134]|chatgpt|text-embedding)/.test(m)) return 'OpenAI';
  if (m.startsWith('claude')) return 'Anthropic';
  if (/^(gemini|gemma)/.test(m)) return 'Google';
  if (/^(mistral|mixtral|codestral)/.test(m)) return 'Mistral';
  if (m.startsWith('llama')) return 'Meta';
  if (m.startsWith('deepseek')) return 'DeepSeek';
  if (m.startsWith('qwen')) return 'Qwen';
  if (m.startsWith('kimi')) return 'Moonshot';
  if (m.startsWith('grok')) return 'xAI';
  if (m.startsWith('command')) return 'Cohere';
  return undefined;
}

/** Words that, right before `model`, make a key an LLM setting ('llm.model', 'summary_model'). */
const SETTING_PREFIXES = new Set([
  'llm', 'ai', 'chat', 'default', 'summary', 'summarizer', 'summarization', 'completion', 'embedding', 'embed', 'fallback',
  'primary', 'secondary', 'vision', 'reasoning', 'agent', 'openrouter', 'openai', 'anthropic', 'gemini', 'router', 'selected',
  'preferred', 'active', 'current', 'task', 'assistant', 'bot', 'gpt', 'translation', 'classification', 'extraction', 'rag',
]);

function isSettingsKey(s: string): boolean {
  if (s.length < 5 || s.length > 64 || !SETTINGS_KEY_RE.test(s)) return false;
  // Needs a '.', '_' or ':' separator, or camelCase. Hyphen-only strings are CSS classes and DOM ids.
  if (!/[._:]/.test(s) && !/[a-z][A-Z]/.test(s)) return false;
  if (/^[A-Z0-9_]+$/.test(s)) return false; // env-var shaped: handled as env_var
  const parts = s.split(/[._:\-]|(?<=[a-z])(?=[A-Z])/).map((p) => p.toLowerCase());
  const last = parts[parts.length - 1];
  const idx = parts.lastIndexOf('model');
  if (idx < 0) return false;
  // 'model' must be the last part, or followed only by name/id ('llm.model.name').
  if (!(idx === parts.length - 1 || (idx === parts.length - 2 && ['name', 'id', 'slug'].includes(last)))) return false;
  return SETTING_PREFIXES.has(parts[idx - 1] ?? '') || ['llm', 'ai', 'openrouter'].includes(parts[0]);
}

interface TableContext { name: string; columns: string[]; modelFindings: LlmConfigFinding[] }

const TABLE_DECLS: RegExp[] = [
  /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"\[]?(?:\w+[`"\]]?\.[`"\[]?)?(\w+)/i,
  /alter\s+table\s+[`"\[]?(?:\w+[`"\]]?\.[`"\[]?)?(\w+)/i,
  /^\s*model\s+(\w+)\s*\{/, // prisma
  /@Entity\(\s*(?:\{\s*name\s*:\s*)?['"`](\w+)['"`]/, // typeorm with name
  /__tablename__\s*=\s*['"](\w+)['"]/, // sqlalchemy
  /(?:createTable|table)\(\s*['"](\w+)['"]/, // knex
  /(?:pgTable|mysqlTable|sqliteTable)\(\s*['"](\w+)['"]/, // drizzle
  /\.define\(\s*['"](\w+)['"]/, // sequelize
  /^\s*class\s+(\w+)\s*\(\s*(?:models\.Model|Base|db\.Model|SQLModel)/, // django / sqlalchemy / sqlmodel
];
const ENTITY_CLASS = /^\s*export\s+class\s+(\w+)/;

/** Column declarations across SQL, Prisma, TypeORM, SQLAlchemy, Django, knex, Drizzle and Mongoose. */
function columnOnLine(line: string, ext: string, state: { afterColumnDecorator: boolean; isSchemaFile: boolean }): string | null {
  let m: RegExpMatchArray | null;
  if (ext === '.sql' || /create\s+table|alter\s+table/i.test(line)) {
    m = line.match(/add\s+(?:column\s+)?[`"\[]?(\w+)[`"\]]?\s+(?:varchar|nvarchar|char|text|string|character varying|enum|json)/i);
    if (m) return m[1];
  }
  if (ext === '.sql') {
    m = line.match(/^\s*[`"\[]?([A-Za-z_]\w*)[`"\]]?\s+(?:varchar|nvarchar|char|text|string|character varying|enum|json|jsonb)\b/i);
    if (m && !/^(?:create|alter|primary|foreign|constraint|unique|index|key)$/i.test(m[1])) return m[1];
    return null;
  }
  if (ext === '.prisma') {
    m = line.match(/^\s*(\w+)\s+(?:String|Json)\??(?:\s|$)/);
    return m ? m[1] : null;
  }
  const inlineDecorated = /@(?:Column|Prop|Field)\b/.test(line);
  if (state.afterColumnDecorator || inlineDecorated) {
    const bare = inlineDecorated ? line.replace(/@\w+\((?:[^()]|\([^()]*\))*\)\s*/g, '') : line;
    m = bare.match(/^\s*(?:public\s+|readonly\s+|declare\s+)*(\w+)[!?]?\s*:\s*(?:string|String|Record|object|any)/);
    if (m) return m[1];
  }
  m = line.match(/\.(?:string|text|varchar|enu|enum|json|jsonb)\(\s*['"](\w+)['"]/); // knex
  if (m) return m[1];
  m = line.match(/^\s*(\w+)\s*(?::\s*Mapped\[[^\]]*\])?\s*=\s*(?:db\.|sa\.|sqlalchemy\.)?(?:Column|mapped_column|Field)\(/); // sqlalchemy / sqlmodel
  if (m) return m[1];
  m = line.match(/^\s*(\w+)\s*=\s*models\.(?:CharField|TextField|SlugField|JSONField)/); // django
  if (m) return m[1];
  if (state.isSchemaFile) {
    m = line.match(/^\s*(\w+)\s*:\s*(?:varchar|text|json|jsonb)\(/); // drizzle
    if (m) return m[1];
    m = line.match(/^\s*(\w+)\s*:\s*(?:String\b|\{\s*type\s*:\s*(?:String|DataTypes\.(?:STRING|TEXT)))/); // mongoose / sequelize
    if (m) return m[1];
  }
  return null;
}

function* stringLiterals(line: string): Generator<string> {
  const re = /(['"`])((?:(?!\1)[^\\\n]|\\.){1,160})\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) yield m[2];
}

function iterFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_FILES) return;
    let entries: import('fs').Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
        continue;
      }
      if (!e.isFile() || SKIP_FILES.has(e.name) || /\.min\.js$/.test(e.name)) continue;
      const ext = extname(e.name).toLowerCase();
      if (!(CODE_EXT.has(ext) || CONFIG_EXT.has(ext) || ENV_TEMPLATES.test(e.name))) continue;
      try { if (statSync(full).size > MAX_FILE_BYTES) continue; } catch { continue; }
      out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Scan one file's text. Exported for tests. */
export function detectInFile(relPath: string, content: string): LlmConfigFinding[] {
  const name = basename(relPath);
  const ext = ENV_TEMPLATES.test(name) ? '.env' : extname(relPath).toLowerCase();
  const isSeed = /seed|fixture|init[_-]?data/i.test(relPath) || /^\s*insert\s+into/im.test(content);
  const isSchemaFile = /new\s+(?:mongoose\.)?Schema\(|pgTable\(|mysqlTable\(|sqliteTable\(|sequelize\.define\(|DataTypes\./.test(content);
  const lines = content.split('\n');
  const out: LlmConfigFinding[] = [];
  const seen = new Set<string>();
  const push = (f: LlmConfigFinding) => {
    const key = `${f.kind}|${f.line}|${f.location ?? ''}|${f.model ?? ''}|${f.provider ?? ''}`;
    if (seen.has(key) || out.length >= MAX_FINDINGS_PER_FILE) return;
    seen.add(key);
    out.push(f);
  };

  let table: TableContext | null = null;
  const tables: TableContext[] = [];
  let entityPending = false;
  const state = { afterColumnDecorator: false, isSchemaFile };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.length > 400 ? raw.slice(0, 400) : raw;
    const snippet = line.trim().slice(0, 160);
    const lineNo = i + 1;
    if (!line.trim()) continue;
    const commentOnly = /^\s*(?:\/\/|#(?!\s*include)|--|\*|\/\*)/.test(line) && ext !== '.env' && ext !== '.sql';

    // ── Providers ───────────────────────────────────────────────────────────
    for (const [re, provider] of PROVIDER_ENDPOINTS) {
      if (re.test(line) && !commentOnly) { push({ kind: 'provider_endpoint', file: relPath, line: lineNo, snippet, provider }); break; }
    }

    // ── Env templates: KEY=value ────────────────────────────────────────────
    if (ext === '.env') {
      const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*["']?([^"'#\s]*)/);
      if (m && ENV_MODEL_RE.test(m[1])) {
        const value = m[2];
        push({ kind: 'env_var', file: relPath, line: lineNo, snippet, location: m[1], ...(isModelId(value) ? { model: value, provider: providerOfModel(value), role: 'default' as const } : {}) });
      }
      continue;
    }

    // ── Table / entity context ──────────────────────────────────────────────
    for (const re of TABLE_DECLS) {
      const m = line.match(re);
      if (m) {
        table = { name: m[1], columns: [], modelFindings: [] };
        tables.push(table);
        break;
      }
    }
    if (/@Entity\(/.test(line)) entityPending = true;
    const cls = line.match(ENTITY_CLASS);
    if (cls && entityPending) {
      // TypeORM entity with no explicit name: the class name stands in.
      if (!table || !/@Entity\(\s*(?:\{\s*name|['"`])/.test(lines.slice(Math.max(0, i - 3), i).join('\n'))) {
        table = { name: cls[1], columns: [], modelFindings: [] };
        tables.push(table);
      }
      entityPending = false;
    }

    // ── Columns ─────────────────────────────────────────────────────────────
    if (!commentOnly) {
      const col = columnOnLine(line, ext, state);
      if (col) {
        if (table) table.columns.push(col);
        const def = line.match(/default\s*[:(=]?\s*\(?\s*['"`]([^'"`]+)['"`]/i);
        const defModel = def && isModelId(def[1]) ? def[1] : null;
        if (isModelColumn(col, table?.name ?? null, defModel != null)) {
          const f: LlmConfigFinding = { kind: 'db_column', file: relPath, line: lineNo, snippet, location: table ? `${table.name}.${col}` : col };
          if (defModel) { f.model = defModel; f.provider = providerOfModel(defModel); f.role = 'default'; }
          if (table) table.modelFindings.push(f);
          push(f);
        }
      }
    }
    state.afterColumnDecorator = /@(?:Column|Prop|Field)\b/.test(line) ? true : state.afterColumnDecorator && /^\s*(?:@|\/\/|\*|\/\*)|^\s*$/.test(line);

    if (commentOnly) continue;

    // ── Env reads in code ───────────────────────────────────────────────────
    const envRe = /(?:process\.env\.|process\.env\[\s*['"]|os\.environ(?:\.get)?\(?\s*\[?\s*['"]|os\.getenv\(\s*['"]|getenv\(\s*['"]|env\(\s*['"]|ENV\[\s*['"]|import\.meta\.env\.)([A-Z][A-Z0-9_]*)/g;
    let em: RegExpExecArray | null;
    while ((em = envRe.exec(line)) !== null) {
      if (ENV_MODEL_RE.test(em[1])) push({ kind: 'env_var', file: relPath, line: lineNo, snippet, location: em[1] });
    }

    // ── String literals: model ids and settings keys ─────────────────────────
    const keyOnLine = line.match(/["']?(\w*[mM]odel\w*)["']?\s*[:=]/)?.[1];
    for (const s of stringLiterals(line)) {
      if (isModelId(s)) {
        push({
          kind: 'model_literal', file: relPath, line: lineNo, snippet, model: s, provider: providerOfModel(s),
          role: /\?\?|\|\||\bor\b|default|fallback|getenv|environ|process\.env/i.test(line) ? 'default' : isSeed ? 'seed' : 'code',
          ...(keyOnLine ? { location: keyOnLine } : {}),
        });
      } else if (isSettingsKey(s)) {
        push({ kind: 'settings_key', file: relPath, line: lineNo, snippet, location: s });
      } else if (ENV_MODEL_RE.test(s) && /env|getenv|environ|config/i.test(line)) {
        push({ kind: 'env_var', file: relPath, line: lineNo, snippet, location: s });
      }
    }
  }

  // A key/value settings table (Setting { key, value }) is where UI-edited
  // model settings usually live. Kept only if a model settings key exists
  // somewhere in the project (see summarize).
  for (const t of tables) {
    const keyCol = t.columns.find((c) => /^(?:key|name|setting_?key|config_?key)$/i.test(snake(c)));
    const valCol = t.columns.find((c) => /^(?:value|setting_?value|config_?value|val)$/i.test(snake(c)));
    if (keyCol && valCol && /setting|config|preference|option|param|kv/i.test(t.name)) {
      const line = Math.max(1, lines.findIndex((l) => new RegExp(`\\b${t.name}\\b`).test(l)) + 1);
      push({ kind: 'db_column', file: relPath, line, snippet: (lines[line - 1] ?? '').trim().slice(0, 160), location: `${t.name}.${valCol}`, keyed_by: [keyCol], kv: true });
    }
  }

  // A model table with a task column picks a model per task.
  for (const t of tables) {
    const taskCols = t.columns.filter(isTaskColumn);
    if (taskCols.length) for (const f of t.modelFindings) f.keyed_by = taskCols;
    // Several model columns in one table (summary_model, chat_model) is per-task too.
    if (!taskCols.length && t.modelFindings.length > 1) for (const f of t.modelFindings) f.keyed_by = t.modelFindings.filter((o) => o !== f).map((o) => o.location!.split('.').pop()!);
  }
  return out;
}

/** Fold per-file findings into the project-level picture. Exported for tests. */
export function summarize(allFindings: LlmConfigFinding[]): LlmConfigSummary {
  const settingsKeys = allFindings.filter((f) => f.kind === 'settings_key').map((f) => f.location!);
  const findings = allFindings
    .filter((f) => !f.kv || settingsKeys.length > 0)
    .map((f) => (f.kv ? { ...f, kv: undefined, keyed_by: [`${f.keyed_by?.[0] ?? 'key'} in (${[...new Set(settingsKeys)].slice(0, 6).join(', ')})`] } : f));
  const providers = new Set<string>();
  const models = new Map<string, { model: string; provider?: string; roles: Set<string>; count: number }>();
  const storage = new Map<string, LlmConfigSummary['storage'][number]>();
  for (const f of findings) {
    if (f.kind === 'provider_endpoint' && f.provider) providers.add(f.provider);
    if (f.model) {
      const m = models.get(f.model) ?? { model: f.model, provider: f.provider, roles: new Set<string>(), count: 0 };
      m.count += 1;
      if (f.role) m.roles.add(f.role);
      models.set(f.model, m);
    }
    if ((f.kind === 'db_column' || f.kind === 'settings_key' || f.kind === 'env_var') && f.location) {
      const key = `${f.kind}:${f.location}`;
      if (!storage.has(key)) storage.set(key, { kind: f.kind, location: f.location, ...(f.keyed_by?.length ? { keyed_by: f.keyed_by } : {}), file: f.file, line: f.line });
    }
  }
  const storageList = [...storage.values()];
  const dbOrSettings = storageList.filter((s) => s.kind !== 'env_var');
  return {
    scanned_at: new Date().toISOString(),
    providers: [...providers].sort(),
    runtime_configured: storageList.length > 0,
    per_task: storageList.some((s) => (s.keyed_by?.length ?? 0) > 0) || dbOrSettings.length > 1 || models.size > 1,
    candidate_models: [...models.values()]
      .map((m) => ({ model: m.model, ...(m.provider ? { provider: m.provider } : {}), roles: [...m.roles].sort(), count: m.count }))
      .sort((a, b) => b.count - a.count),
    storage: storageList,
    findings: findings.slice(0, MAX_FINDINGS),
  };
}

/** Walk `root` and return where its LLM models are named or stored. */
export function detectLlmConfig(root: string): LlmConfigSummary {
  const findings: LlmConfigFinding[] = [];
  for (const full of iterFiles(root)) {
    let content: string;
    try { content = readFileSync(full, 'utf-8'); } catch { continue; }
    if (content.includes('\u0000')) continue; // binary
    findings.push(...detectInFile(relative(root, full), content));
  }
  return summarize(findings);
}

/** What an inventory record keeps: the project summary narrowed to its files. */
export type LlmRecordConfig = LlmConfigSummary & { record_files: string[] };

/** The slice of a project summary that concerns one inventory record's files. */
export function llmConfigForRecord(summary: LlmConfigSummary | null | undefined, files: string[]): LlmRecordConfig | null {
  if (!summary) return null;
  const mine = new Set(files);
  // Runtime storage (schema, settings, env) is project-wide: any LLM call in the
  // project may read it. Literals and endpoints are kept only for this record's files.
  const findings = summary.findings.filter((f) => mine.has(f.file) || f.kind === 'db_column' || f.kind === 'settings_key' || f.kind === 'env_var' || f.role === 'seed' || f.role === 'default');
  return { ...summarize(findings), providers: summary.providers, scanned_at: summary.scanned_at, record_files: files };
}

/** True when a discovered candidate calls an LLM (and so has underlying models to confirm). */
export function isLlmCandidate(c: { modelTypeGuess?: string; signals?: Array<{ category: string }> }): boolean {
  if (c.signals?.some((s) => s.category.startsWith('llm_') || s.category === 'ast_llm_sdk')) return true;
  // Agents almost always run on an LLM, even when the call sits in a shared helper file.
  return c.modelTypeGuess === 'GENERATIVE_AI' || c.modelTypeGuess === 'AGENT';
}
