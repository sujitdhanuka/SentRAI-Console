/**
 * Static codebase discovery scanner. Faithful port of
 * src/sentrai/discovery/codebase_scanner.py — a heuristic regex first-pass with
 * an optional tree-sitter AST enhancement. Surfaces AI/ML/LLM candidates and
 * governance gaps for a human reviewer.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join, relative } from 'path';

import { ModelType, RiskLevel } from '../common/enums';
import { detectLanguage } from './language-detector';
import { detectAgenticFrameworks } from './framework-detector';
import { DetectedTool, extractTools } from './tool-detector';
import { detectSecrets } from '../common/secret-patterns';
import { AstScanResult } from './tree-sitter-parser';

export interface AstScanner {
  ready: boolean;
  scanPython(content: string): AstScanResult;
  scanJsTs(content: string, isTypescript: boolean): AstScanResult;
  scanGo(content: string): AstScanResult;
}

export interface SignalMatch {
  category: string;
  pattern: string;
  lineNumber: number;
  snippet: string;
}

export interface DiscoveredCandidate {
  suggestedName: string;
  filePath: string;
  modelTypeGuess: ModelType;
  functionalAreaGuess: string;
  riskHint: RiskLevel;
  confidence: string; // HIGH | MEDIUM | LOW
  domainTags: string[];
  signals: SignalMatch[];
  /** Normalised tool/capability ids the code invokes (Pillar 2 — Control). */
  tools: string[];
  /** Full detections behind `tools` — line + snippet, for gate evidence. */
  toolDetails: DetectedTool[];
  gaps: string[];
  description: string;
  prompts: Array<Record<string, any>>;
  secrets: Array<Record<string, any>>;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.turbo', 'coverage', '.pytest_cache', '.mypy_cache',
  'target', '.idea', '.vscode',
]);

const SCANNABLE_EXTENSIONS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.java', '.rb']);
const MAX_FILE_SIZE_BYTES = 1_500_000;
const MAX_FILES_SCANNED = 5000;

type PatternGroup = { category: string; re: RegExp; weight: number };

const LLM_PATTERNS: PatternGroup[] = [
  { category: 'llm_api_call', re: /\bopenai\.|\banthropic\.|chat\.completions|\.messages\.create\(/i, weight: 3 },
  { category: 'llm_model_string', re: /['"`](gpt-4|gpt-3\.5|claude-|gemini-|llama-|mistral-)[\w.\-]*['"`]/i, weight: 3 },
  { category: 'llm_sdk_import', re: /from\s+['"]openai['"]|from\s+['"]@anthropic-ai|import\s+openai|import\s+anthropic/i, weight: 3 },
];
const ML_PATTERNS: PatternGroup[] = [
  { category: 'ml_library_import', re: /\b(sklearn|tensorflow|torch|xgboost|lightgbm|keras)\b/i, weight: 3 },
  { category: 'ml_inference_call', re: /\.predict\(|\.fit\(|model\.eval\(\)/i, weight: 2 },
];
const AGENT_PATTERNS: PatternGroup[] = [
  { category: 'agent_definition', re: /\b(class|function|const)\s+\w*(Agent|Swarm|Persona)\w*/i, weight: 2 },
  { category: 'agent_keyword', re: /\bSwarm\b|\bmulti-agent\b|\bAI\s+agent\b/i, weight: 1 },
  { category: 'mcp_server', re: /\bmcp\b|modelcontextprotocol|FastMCP/i, weight: 2 },
  { category: 'ai_tool', re: /@tool|\b(class|function|const)\s+\w*(Tool)\w*|langchain\.tools/i, weight: 2 },
];
const SCORING_PATTERNS: PatternGroup[] = [
  { category: 'scoring_logic', re: /\b(riskScore|signalScore|tripleScreen|swingTrader|momentumScore|generateSignal)\b/i, weight: 1 },
  { category: 'decision_function', re: /\b(function|const|def)\s+\w*(Score|Scoring|Risk|Credit|Underwrit|Approv|Decision|Eligib)\w*\s*[=(]/i, weight: 1 },
];
const ALL_PATTERN_GROUPS = [...LLM_PATTERNS, ...ML_PATTERNS, ...AGENT_PATTERNS, ...SCORING_PATTERNS];

const DOMAIN_TAG_PATTERNS: Array<[string, RegExp]> = [
  ['GenAI / LLM', /\bopenai\.|\banthropic\.|chat\.completions|gpt-4|gpt-3\.5|claude-|gemini-|llama-|prompt|\bllm\b/i],
  ['Machine Learning', /\b(sklearn|tensorflow|torch|xgboost|lightgbm|keras|\.predict\(|\.fit\()\b/i],
  ['Quant / Trading', /\bquant|backtest|sharpe|volatility|black.?scholes|monte.?carlo|momentum|swing.?trad|\btechnical[_-]?indicator|\brsi\b|\bmacd\b|bollinger|triple.?screen|option.?pricing|alpha\b|hedge\b/i],
  ['FinTech / Banking', /\bbank|credit|loan|kyc|\baml\b|payment|\bupi\b|underwrit|ledger\b/i],
  ['Fraud / Risk', /\bfraud|anomaly|riskscore|risk[_-]?engine|chargeback/i],
  ['Portfolio / Wealth', /\bportfolio|wealth|asset.?alloc|rebalanc|diversif/i],
  ['Research / NLP', /\bresearch|sentiment|summar|nlp\b|institutional|analyst\b/i],
  ['Agent / Orchestration', /\bagent\b|\bswarm\b|workflow|\brouter\b|persona\b|multi-agent/i],
];

const FUNCTIONAL_AREA_HINTS: Array<[RegExp, string]> = [
  [/credit|underwrit|loan/i, 'credit_underwriting'],
  [/chat|conversation|assistant/i, 'customer_chatbot'],
  [/report|briefing|summar/i, 'report_generation'],
  [/trade|trading|signal|swing|momentum|screen|mcx|fo[_-]?dashboard/i, 'trading_signal_generation'],
  [/fraud|anomaly/i, 'fraud_detection'],
  [/portfolio/i, 'portfolio_analysis'],
  [/research|analyst|persona|institutional/i, 'investment_research'],
  [/swarm|router|workflow|self[_-]?improv/i, 'autonomous_agent_orchestration'],
];

const GAP_KEYWORD_CHECKS: Array<[RegExp, string]> = [
  [/human[_-]?(review|approval|confirm|in[_-]?the[_-]?loop)|requireConfirm/i,
    'No human-in-the-loop or confirmation step detected near this code — verify Sutra 2 (People First) is satisfied.'],
  [/rationale|explain|reasoning|confidence\s*score|justif/i,
    'No explanation/rationale output detected — required for Sutra 6 (Understandable by Design) if this drives a recommendation.'],
  [/riskLevel|risk_level|RiskLevel|LOW.?RISK|HIGH.?RISK/i,
    'No risk classification found in code — assign Low/Medium/High before production use (Sutra 3 / REC 14).'],
  [/bias|fairness|demographic.?parity|disparate/i,
    'No bias/fairness check reference found — required for Sutra 4 (Fairness & Equity) on customer-facing models.'],
  [/drift|monitor|circuit.?breaker|fallback/i,
    'No drift-monitoring or fallback reference found — required for Sutra 7 (Safety & Resilience) on production models.'],
];

const ALWAYS_FLAGGED_GAPS = [
  'No board-approved AI policy reference found in code — required for Sutra 1 (Trust) / REC 14.',
  'No owning team assigned — required for Sutra 5 (Accountability) before this can move out of DESIGN stage.',
];

function* finditer(re: RegExp, s: string): Generator<{ index: number; text: string }> {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    yield { index: m.index, text: m[0] };
    if (m.index === r.lastIndex) r.lastIndex += 1; // avoid zero-width loop
  }
}

function countNewlines(s: string, end: number): number {
  let n = 0;
  for (let i = 0; i < end; i++) if (s[i] === '\n') n += 1;
  return n;
}

function classifyDomain(content: string, relPath: string): string[] {
  const haystack = `${relPath}\n${content}`;
  return DOMAIN_TAG_PATTERNS.filter(([, re]) => re.test(haystack)).map(([tag]) => tag);
}

function guessFunctionalArea(relPath: string): string {
  for (const [re, area] of FUNCTIONAL_AREA_HINTS) if (re.test(relPath)) return area;
  return 'unclassified';
}

function guessName(relPath: string): string {
  const stem = basename(relPath, extname(relPath));
  const words = stem.match(/[A-Z][a-z]*|[a-z]+|\d+/g) ?? [];
  const titled = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return titled || stem;
}

function assessGaps(content: string): string[] {
  const gaps = [...ALWAYS_FLAGGED_GAPS];
  for (const [re, msg] of GAP_KEYWORD_CHECKS) if (!re.test(content)) gaps.push(msg);
  return gaps;
}

function extractDescription(content: string): string {
  // 1. Python docstring
  const doc = content.match(/^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/);
  if (doc) {
    const body = doc[1] || doc[2];
    if (body) {
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length) return lines.join(' ').slice(0, 300);
    }
  }
  // 2. Leading comment block
  const lines = content.split('\n');
  const descLines: string[] = [];
  let inBlock = false;
  for (const raw of lines.slice(0, 30)) {
    const line = raw.trim();
    if (!line) {
      if (descLines.length) break;
      continue;
    }
    if (line.startsWith('/*')) {
      inBlock = true;
      const c = line.slice(2).trim();
      if (c) descLines.push(c);
      if (line.includes('*/')) inBlock = false;
      continue;
    } else if (inBlock) {
      let c: string;
      if (line.includes('*/')) {
        inBlock = false;
        c = line.split('*/')[0].trim();
      } else {
        c = line.trim();
      }
      if (c) descLines.push(c);
      continue;
    }
    if (line.startsWith('//')) descLines.push(line.slice(2).trim());
    else if (line.startsWith('#')) descLines.push(line.slice(1).trim());
    else break;
  }
  if (descLines.length) return descLines.join(' ').slice(0, 300);
  return '';
}

function scanPromptsAndSecurity(content: string): { prompts: any[]; secrets: any[] } {
  const prompts: any[] = [];
  const secrets: any[] = [];

  const promptRe =
    /(?:prompt|template|instruction|system_prompt|user_prompt|system_message)\s*=\s*(?:f?["'`]{3}([\s\S]*?)["'`]{3}|f?["'`]([\s\S]*?)["'`])/gi;
  let m: RegExpExecArray | null;
  while ((m = promptRe.exec(content)) !== null) {
    const val = m[1] || m[2];
    if (val && val.trim().length > 10) {
      const promptText = val.trim();
      const lower = promptText.toLowerCase();
      const hasInjectionRisk =
        (lower.includes('{user') || lower.includes('{input') || lower.includes('{query')) &&
        !content.toLowerCase().includes('sanitize');
      const piiCategories: string[] = [];
      if (/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/.test(promptText)) piiCategories.push('Email Address');
      if (/\b\d{3}-\d{2}-\d{4}\b/.test(promptText)) piiCategories.push('Social Security Number (SSN)');

      prompts.push({
        raw_text: promptText.slice(0, 300) + (promptText.length > 300 ? '...' : ''),
        prompt_type:
          lower.includes('you are a') || m[0].toLowerCase().includes('system') ? 'System Prompt' : 'User Prompt',
        injection_risk: hasInjectionRisk ? 'HIGH' : 'LOW',
        pii_detected: piiCategories,
      });
    }
  }

  // Hardcoded-secret detection now comes from the one canonical library
  // (Pillar 4), shared with the pre-LLM redactor. Findings keep the persisted
  // { type, masked_value, line } shape; severity is available on each finding.
  for (const f of detectSecrets(content)) {
    secrets.push({ type: f.type, masked_value: f.masked_value, line: f.line, severity: f.severity });
  }
  return { prompts, secrets };
}

function iterSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= MAX_FILES_SCANNED) return;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES_SCANNED) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        if (!SCANNABLE_EXTENSIONS.has(extname(e.name))) continue;
        try {
          if (statSync(full).size > MAX_FILE_SIZE_BYTES) continue;
        } catch {
          continue;
        }
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

const FAST_KEYWORDS = [
  'openai', 'anthropic', 'langchain', 'torch', 'sklearn', 'xgboost', 'tensorflow',
  'onnx', 'google', 'gemini', 'genai', 'mcp', 'crewai', 'autogen',
];

export function candidateAsDict(c: DiscoveredCandidate): Record<string, any> {
  return {
    suggested_name: c.suggestedName,
    file_path: c.filePath,
    model_type_guess: c.modelTypeGuess,
    functional_area_guess: c.functionalAreaGuess,
    risk_hint: c.riskHint,
    confidence: c.confidence,
    domain_tags: c.domainTags,
    description: c.description,
    prompts: c.prompts,
    secrets: c.secrets,
    signals: c.signals.map((s) => ({ category: s.category, pattern: s.pattern, line: s.lineNumber, snippet: s.snippet })),
    tools: c.tools,
    tool_details: c.toolDetails.map((t) => ({ id: t.id, label: t.label, line: t.line, snippet: t.snippet })),
    gaps: c.gaps,
  };
}

/**
 * Inverse of candidateAsDict: rebuilds a candidate from the dict persisted in
 * `projects.lastScanResult`, so an import can run from the stored scan when
 * the extracted workspace no longer exists on disk (redeploys wipe it).
 */
export function candidateFromDict(d: Record<string, any>): DiscoveredCandidate {
  return {
    suggestedName: d.suggested_name,
    filePath: d.file_path,
    modelTypeGuess: d.model_type_guess,
    functionalAreaGuess: d.functional_area_guess,
    riskHint: d.risk_hint,
    confidence: d.confidence,
    domainTags: d.domain_tags ?? [],
    description: d.description ?? '',
    prompts: d.prompts ?? [],
    secrets: d.secrets ?? [],
    signals: (d.signals ?? []).map((s: Record<string, any>) => ({
      category: s.category, pattern: s.pattern, lineNumber: s.line, snippet: s.snippet,
    })),
    tools: d.tools ?? [],
    toolDetails: (d.tool_details ?? []).map((t: Record<string, any>) => ({
      id: t.id, label: t.label ?? t.id, category: 'named_tool' as const, line: t.line ?? 1, snippet: t.snippet ?? '',
    })),
    gaps: d.gaps ?? [],
  };
}

/**
 * Scans `root` for files matching AI/ML/LLM signal patterns and returns one
 * candidate per matching file. `ast` is optional; when unavailable, only the
 * regex layer runs.
 */
export function scanDirectory(root: string, ast?: AstScanner): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];

  for (const filePath of iterSourceFiles(root)) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const matches: SignalMatch[] = [];
    let weight = 0;
    let hasLlm = false;
    let hasMl = false;
    let hasAgent = false;
    let astGaps: string[] = [];

    const lang = detectLanguage(filePath);
    const frameworks = detectAgenticFrameworks(content);
    if (frameworks.length) {
      hasAgent = true;
      weight += frameworks.length * 5;
    }

    const lower = content.toLowerCase();
    const needsAst = FAST_KEYWORDS.some((kw) => lower.includes(kw));
    if (needsAst && ast && ast.ready) {
      let astResult: AstScanResult | null = null;
      if (lang === 'python') astResult = ast.scanPython(content);
      else if (lang === 'javascript' || lang === 'typescript') astResult = ast.scanJsTs(content, lang === 'typescript');
      else if (lang === 'go') astResult = ast.scanGo(content);

      if (astResult) {
        astGaps = astResult.gaps;
        // Library imports still contribute a weight boost.
        for (const libGroup of [
          { libs: ['openai', 'anthropic', 'cohere', 'mistralai', 'groq', 'litellm', 'go-openai', 'anthropic-go'], set: () => (hasLlm = true) },
          { libs: ['torch', 'sklearn', 'xgboost', 'lightgbm', 'catboost', 'keras', 'tensorflow', 'onnxruntime', 'transformers', 'joblib'], set: () => (hasMl = true) },
          { libs: ['langchain', 'langgraph', 'llama_index', 'autogen', 'crewai', 'langchain-go'], set: () => (hasAgent = true) },
        ]) {
          if (astResult.libs.some((l) => libGroup.libs.includes(l))) { libGroup.set(); weight += 5; }
        }
        // Structural AST signals: resolved SDK calls + model-usage patterns the
        // regex layer cannot see. These become first-class candidate signals.
        for (const s of astResult.signals) {
          matches.push({ category: `ast_${s.category}`, pattern: s.evidence, lineNumber: s.line, snippet: s.evidence });
          weight += 4;
          if (s.category === 'llm_sdk') hasLlm = true;
          else if (s.category === 'agent_sdk') hasAgent = true;
          else hasMl = true; // ml_sdk | model_load | inference_call
        }
      }
    }

    for (const { category, re, weight: baseWeight } of ALL_PATTERN_GROUPS) {
      for (const { index, text } of finditer(re, content)) {
        const lineNo = countNewlines(content, index) + 1;
        const snippet = lineNo - 1 < lines.length ? lines[lineNo - 1].trim().slice(0, 140) : '';
        matches.push({ category, pattern: text, lineNumber: lineNo, snippet });
        weight += baseWeight;
        if (category.startsWith('llm_')) hasLlm = true;
        if (category.startsWith('ml_')) hasMl = true;
        if (category.startsWith('agent_')) hasAgent = true;
      }
    }

    if (matches.length === 0 && astGaps.length === 0) continue;

    const relPath = relative(root, filePath);

    const hasMcp = matches.some((m) => m.category === 'mcp_server');
    const hasTool = matches.some((m) => m.category === 'ai_tool');

    let modelType: ModelType;
    if (hasMcp) modelType = ModelType.MCP_SERVER;
    else if (hasAgent) modelType = ModelType.AGENT;
    else if (hasTool) modelType = ModelType.TOOL;
    else if (hasLlm) modelType = ModelType.GENERATIVE_AI;
    else if (hasMl) modelType = ModelType.MACHINE_LEARNING;
    else modelType = ModelType.RULES_BASED;

    const functionalArea = guessFunctionalArea(relPath);

    let riskHint: RiskLevel;
    if (
      ['credit_underwriting', 'fraud_detection', 'trading_signal_generation'].includes(functionalArea) &&
      (hasLlm || hasAgent)
    ) {
      riskHint = RiskLevel.HIGH;
    } else if (hasLlm || hasMl || functionalArea === 'customer_chatbot') {
      riskHint = RiskLevel.MEDIUM;
    } else {
      riskHint = RiskLevel.LOW;
    }

    const confidence = weight >= 5 ? 'HIGH' : weight >= 2 ? 'MEDIUM' : 'LOW';
    const { prompts, secrets } = scanPromptsAndSecurity(content);
    const toolDetails = extractTools(content);

    candidates.push({
      suggestedName: guessName(relPath),
      filePath: relPath,
      modelTypeGuess: modelType,
      functionalAreaGuess: functionalArea,
      riskHint,
      confidence,
      domainTags: classifyDomain(content, relPath),
      signals: matches.slice(0, 10),
      tools: toolDetails.map((t) => t.id),
      toolDetails,
      gaps: [...assessGaps(content), ...astGaps],
      description: extractDescription(content),
      prompts,
      secrets,
    });
  }

  const riskOrder: Record<string, number> = { [RiskLevel.HIGH]: 0, [RiskLevel.MEDIUM]: 1, [RiskLevel.LOW]: 2 };
  const confidenceOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  candidates.sort(
    (a, b) => riskOrder[a.riskHint] - riskOrder[b.riskHint] || confidenceOrder[a.confidence] - confidenceOrder[b.confidence],
  );
  return candidates;
}
