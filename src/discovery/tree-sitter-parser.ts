import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import Parser from 'web-tree-sitter';

/** A structural finding derived from the AST (not a text/regex match). */
export interface AstSignal {
  category: 'llm_sdk' | 'ml_sdk' | 'agent_sdk' | 'model_load' | 'inference_call';
  evidence: string;
  nodeType: string;
  line: number;
}

export interface AstScanResult {
  libs: string[];
  gaps: string[];
  signals: AstSignal[];
}

const nodeRequire = createRequire(__filename);

/** Known AI SDKs keyed by top-level module → signal kind + human label. */
const MODULE_KIND: Record<string, { kind: AstSignal['category']; label: string }> = {
  openai: { kind: 'llm_sdk', label: 'OpenAI SDK' },
  anthropic: { kind: 'llm_sdk', label: 'Anthropic SDK' },
  cohere: { kind: 'llm_sdk', label: 'Cohere SDK' },
  mistralai: { kind: 'llm_sdk', label: 'Mistral SDK' },
  groq: { kind: 'llm_sdk', label: 'Groq SDK' },
  litellm: { kind: 'llm_sdk', label: 'LiteLLM' },
  transformers: { kind: 'ml_sdk', label: 'HuggingFace Transformers' },
  torch: { kind: 'ml_sdk', label: 'PyTorch' },
  tensorflow: { kind: 'ml_sdk', label: 'TensorFlow' },
  sklearn: { kind: 'ml_sdk', label: 'scikit-learn' },
  xgboost: { kind: 'ml_sdk', label: 'XGBoost' },
  lightgbm: { kind: 'ml_sdk', label: 'LightGBM' },
  catboost: { kind: 'ml_sdk', label: 'CatBoost' },
  keras: { kind: 'ml_sdk', label: 'Keras' },
  onnxruntime: { kind: 'ml_sdk', label: 'ONNX Runtime' },
  joblib: { kind: 'ml_sdk', label: 'joblib' },
  langchain: { kind: 'agent_sdk', label: 'LangChain' },
  langgraph: { kind: 'agent_sdk', label: 'LangGraph' },
  llama_index: { kind: 'agent_sdk', label: 'LlamaIndex' },
  autogen: { kind: 'agent_sdk', label: 'AutoGen' },
  crewai: { kind: 'agent_sdk', label: 'CrewAI' },
};

/** Method names that structurally indicate model *usage*, even with no import. */
const MODEL_USE_METHODS: Record<string, { category: AstSignal['category']; label: string }> = {
  from_pretrained: { category: 'model_load', label: 'Pretrained model load (from_pretrained)' },
  load_model: { category: 'model_load', label: 'Model artifact load (load_model)' },
  InferenceSession: { category: 'model_load', label: 'ONNX inference session' },
  loadLayersModel: { category: 'model_load', label: 'TensorFlow.js model load' },
  pipeline: { category: 'llm_sdk', label: 'Transformers pipeline' },
};

/** JS/TS class names that, when constructed, indicate an AI client. */
const JS_AI_CLASSES: Record<string, AstSignal['category']> = {
  OpenAI: 'llm_sdk',
  Anthropic: 'llm_sdk',
  CohereClient: 'llm_sdk',
  ChatOpenAI: 'agent_sdk',
  InferenceSession: 'model_load',
};

const baseModule = (dotted: string) => dotted.split('.')[0];
const leftmostId = (expr: string) => expr.split(/[.\s([]/)[0].trim();

interface Cap {
  text: string;
  type: string;
  line: number;
}

/**
 * Tree-sitter (WASM) semantic scanning for Python/JS/TS/Go. Beyond extracting
 * imports, it resolves aliases and client variables so renamed/obfuscated calls
 * are still attributed to their SDK, and detects model *usage* patterns
 * (from_pretrained, InferenceSession, artifact loads) that carry no import — a
 * data-flow-lite layer the regex pass cannot see. Degrades to an empty result
 * (regex-only) if the WASM runtime or grammars fail to load.
 */
@Injectable()
export class TreeSitterService implements OnModuleInit {
  private readonly logger = new Logger(TreeSitterService.name);
  ready = false;

  private langs: Record<string, any> = {};
  private parsers: Record<string, any> = {};

  async onModuleInit(): Promise<void> {
    try {
      await Parser.init();
      const wasmDir = dirname(nodeRequire.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm'));
      const load = async (name: string) => Parser.Language.load(join(wasmDir, `tree-sitter-${name}.wasm`));

      const specs: Array<[string, string]> = [
        ['python', 'python'],
        ['javascript', 'javascript'],
        ['typescript', 'typescript'],
        ['go', 'go'],
      ];
      for (const [key, wasm] of specs) {
        const lang = await load(wasm);
        const parser = new Parser();
        parser.setLanguage(lang);
        this.langs[key] = lang;
        this.parsers[key] = parser;
      }
      this.ready = true;
      this.logger.log('Tree-sitter grammars loaded (python, javascript, typescript, go)');
    } catch (e) {
      this.ready = false;
      this.logger.warn(`Failed to load tree-sitter grammars: ${String(e)}. Discovery runs regex-only.`);
    }
  }

  /** Run a query against an already-parsed tree; matches keep per-capture grouping. */
  private queryTree(language: any, tree: any, query: string): Array<Record<string, Cap>> {
    let q;
    try {
      q = language.query(query);
    } catch {
      return [];
    }
    const out: Array<Record<string, Cap>> = [];
    for (const match of q.matches(tree.rootNode)) {
      const row: Record<string, Cap> = {};
      for (const c of match.captures) {
        row[c.name] = { text: c.node.text, type: c.node.type, line: (c.node.startPosition?.row ?? 0) + 1 };
      }
      out.push(row);
    }
    return out;
  }

  scanPython(content: string): AstScanResult {
    const libs = new Set<string>();
    const gaps: string[] = [];
    const signals: AstSignal[] = [];
    if (!this.ready) return { libs: [], gaps, signals };

    try {
      const tree = this.parsers['python'].parse(content);
      const language = this.langs['python'];
      const q = (s: string) => this.queryTree(language, tree, s);

      // ── Symbol tables from imports (alias-aware) ─────────────────────────
      const aliasToModule = new Map<string, string>(); // bare name / module alias → module
      const nameToModule = new Map<string, string>(); // imported symbol / its alias → module

      for (const m of q('(import_statement name: (dotted_name) @mod)')) {
        const mod = baseModule(m.mod.text);
        aliasToModule.set(mod, mod);
        libs.add(mod);
      }
      for (const m of q('(import_statement name: (aliased_import name: (dotted_name) @mod alias: (identifier) @alias))')) {
        const mod = baseModule(m.mod.text);
        aliasToModule.set(m.alias.text, mod); // import openai as oai  → oai → openai
        libs.add(mod);
      }
      for (const m of q('(import_from_statement module_name: (dotted_name) @mod name: (dotted_name) @name)')) {
        const mod = baseModule(m.mod.text);
        nameToModule.set(m.name.text, mod); // from openai import OpenAI → OpenAI → openai
        libs.add(mod);
      }
      for (const m of q(
        '(import_from_statement module_name: (dotted_name) @mod name: (aliased_import name: (dotted_name) @name alias: (identifier) @alias))',
      )) {
        const mod = baseModule(m.mod.text);
        nameToModule.set(m.alias.text, mod); // from openai import OpenAI as Foo → Foo → openai
        libs.add(mod);
      }

      // ── Client variables: `client = OpenAI(...)` / `c = openai.OpenAI(...)` ─
      const varToModule = new Map<string, string>();
      for (const m of q('(assignment left: (identifier) @var right: (call function: (identifier) @ctor))')) {
        const mod = nameToModule.get(m.ctor.text) ?? aliasToModule.get(m.ctor.text);
        if (mod && MODULE_KIND[mod]) varToModule.set(m.var.text, mod);
      }
      for (const m of q(
        '(assignment left: (identifier) @var right: (call function: (attribute object: (identifier) @obj)))',
      )) {
        const mod = aliasToModule.get(m.obj.text);
        if (mod && MODULE_KIND[mod]) varToModule.set(m.var.text, mod);
      }

      const resolve = (id: string): string | undefined =>
        varToModule.get(id) ?? aliasToModule.get(id) ?? nameToModule.get(id);
      const seen = new Set<string>();
      const emit = (s: AstSignal) => {
        const key = `${s.category}:${s.line}:${s.evidence}`;
        if (seen.has(key)) return;
        seen.add(key);
        signals.push(s);
      };

      // ── Attribute calls: resolve receiver, detect model-usage methods ─────
      for (const m of q('(call function: (attribute object: (_) @obj attribute: (identifier) @method))')) {
        const baseId = leftmostId(m.obj.text);
        const method = m.method.text;
        const line = m.method.line;
        const mod = resolve(baseId);

        if (mod && MODULE_KIND[mod]) {
          const k = MODULE_KIND[mod];
          const via = baseId === mod ? mod : `'${baseId}' → ${mod}`;
          emit({ category: k.kind, evidence: `${k.label} call (${via}.${method}())`, nodeType: 'call', line });
          libs.add(mod);
          if (method === 'load' && k.kind === 'ml_sdk') {
            emit({ category: 'model_load', evidence: `Model artifact load: ${mod}.load()`, nodeType: 'call', line });
          }
          if ((method === 'predict' || method === 'fit') && k.kind === 'ml_sdk') {
            emit({ category: 'inference_call', evidence: `ML ${method}() on ${mod} model`, nodeType: 'call', line });
          }
        }
        if (MODEL_USE_METHODS[method]) {
          const u = MODEL_USE_METHODS[method];
          emit({ category: u.category, evidence: `${u.label}: ${baseId}.${method}()`, nodeType: 'call', line });
        }
      }

      // ── Bare-identifier calls resolving to an imported AI constructor ──────
      for (const m of q('(call function: (identifier) @fname)')) {
        const fname = m.fname.text;
        const mod = nameToModule.get(fname) ?? aliasToModule.get(fname);
        if (mod && MODULE_KIND[mod]) {
          const k = MODULE_KIND[mod];
          emit({ category: k.kind, evidence: `${k.label} constructor ${fname}() (${mod})`, nodeType: 'call', line: m.fname.line });
          libs.add(mod);
        } else if (MODEL_USE_METHODS[fname]) {
          const u = MODEL_USE_METHODS[fname];
          emit({ category: u.category, evidence: `${u.label}: ${fname}()`, nodeType: 'call', line: m.fname.line });
        }
      }

      // ── Hardcoded credential literals ─────────────────────────────────────
      for (const m of q('(keyword_argument name: (identifier) @kw value: (string) @val)')) {
        const key = (m.kw.text || '').toLowerCase();
        if (key === 'api_key' || key === 'apikey' || key === 'token' || key === 'secret') {
          gaps.push(`Vulnerability: Hardcoded ${m.kw.text} string literal passed at line ${m.kw.line}.`);
        }
      }
    } catch (e) {
      this.logger.debug(`python AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps, signals };
  }

  scanJsTs(content: string, isTypescript: boolean): AstScanResult {
    const lang = isTypescript ? 'typescript' : 'javascript';
    const libs = new Set<string>();
    const gaps: string[] = [];
    const signals: AstSignal[] = [];
    if (!this.ready) return { libs: [], gaps, signals };

    const addLib = (raw: string) => {
      const val = raw.replace(/^['"]|['"]$/g, '');
      if (!val || val === 'require') return;
      const b = val.startsWith('@') ? val.split('/').slice(-1)[0] : val.split('/')[0];
      libs.add(b);
    };

    try {
      const tree = this.parsers[lang].parse(content);
      const language = this.langs[lang];
      const q = (s: string) => this.queryTree(language, tree, s);
      const emit = (s: AstSignal) => signals.push(s);

      for (const c of q('(import_statement source: (string) @src)')) addLib(c.src.text);
      const reqCaps = q('(call_expression function: (identifier) @fn arguments: (arguments (string) @arg))');
      for (const c of reqCaps) if (c.fn?.text === 'require' && c.arg) addLib(c.arg.text);

      // new OpenAI(...) / new InferenceSession(...) — client construction.
      for (const m of q('(new_expression constructor: (identifier) @ctor)')) {
        const kind = JS_AI_CLASSES[m.ctor.text];
        if (kind) emit({ category: kind, evidence: `AI client constructed: new ${m.ctor.text}()`, nodeType: 'new_expression', line: m.ctor.line });
      }

      // member calls to model-usage methods: X.from_pretrained / X.pipeline / X.loadLayersModel
      for (const m of q('(call_expression function: (member_expression property: (property_identifier) @method))')) {
        const u = MODEL_USE_METHODS[m.method.text];
        if (u) emit({ category: u.category, evidence: `${u.label}: .${m.method.text}()`, nodeType: 'call_expression', line: m.method.line });
      }

      // Hardcoded apiKey in a constructor options object.
      for (const c of q(
        '(new_expression arguments: (arguments (object (pair key: [(property_identifier) (string)] @prop value: (string) @val))))',
      )) {
        if (c.prop && /apikey|api_key|token|secret/i.test(c.prop.text) && !/process\.env/.test(c.val?.text ?? '')) {
          gaps.push(`Vulnerability: Hardcoded ${c.prop.text.replace(/['"]/g, '')} passed in constructor at line ${c.prop.line}.`);
        }
      }
    } catch (e) {
      this.logger.debug(`js/ts AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps, signals };
  }

  scanGo(content: string): AstScanResult {
    const libs = new Set<string>();
    const gaps: string[] = [];
    const signals: AstSignal[] = [];
    if (!this.ready) return { libs: [], gaps, signals };
    try {
      const tree = this.parsers['go'].parse(content);
      const language = this.langs['go'];
      for (const c of this.queryTree(language, tree, '(import_spec path: (interpreted_string_literal) @import_path)')) {
        const val = c.import_path.text.replace(/"/g, '');
        if (val) libs.add(val.split('/').slice(-1)[0]);
      }
    } catch (e) {
      this.logger.debug(`go AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps, signals };
  }
}
