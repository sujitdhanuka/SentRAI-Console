/**
 * Static tool/capability detector (Roadmap Pillar 2 — Control).
 *
 * An agent's "tools" are what it can actually *do* in the world — call an API,
 * run a shell command, write a file, execute SQL, move money. This scans source
 * text for two kinds of tool:
 *   1. Named agent tools — LangChain `@tool` / `Tool(name=…)`, MCP `@server.tool`
 *      / `.tool("name")`, structured tools — the explicit tool surface.
 *   2. Capability primitives — the underlying powers that matter for control:
 *      shell exec, network egress, filesystem writes, database execute, cloud
 *      SDKs, email, payments, dynamic code exec.
 *
 * Every finding is normalised to a stable id (`capability:shell`,
 * `tool:transfer_funds`) so a declared *permitted* set and a *detected* set can
 * be compared directly by the tool-authorization check. Deliberately static and
 * language-agnostic (regex over Python/JS/TS/Go) — it runs in the discovery
 * scan and again in the CI gate, no runtime instrumentation required.
 */

export type ToolCategory =
  | 'shell'
  | 'network'
  | 'filesystem'
  | 'database'
  | 'cloud'
  | 'email'
  | 'payments'
  | 'code_exec'
  | 'named_tool';

export interface DetectedTool {
  /** Stable identifier, e.g. `capability:shell` or `tool:transfer_funds`. */
  id: string;
  label: string;
  category: ToolCategory;
  line: number;
  snippet: string;
}

interface CapabilitySpec {
  id: string;
  label: string;
  category: ToolCategory;
  re: RegExp;
}

/**
 * Capability primitives. Order matters only for readability — each is matched
 * independently. Patterns are intentionally broad but anchored on the concrete
 * call/API so a mere mention in a comment rarely trips them.
 */
const CAPABILITIES: CapabilitySpec[] = [
  {
    id: 'capability:shell', label: 'Shell / process execution', category: 'shell',
    re: /\bsubprocess\.(run|call|Popen|check_output|check_call)\b|\bos\.system\s*\(|\bos\.popen\s*\(|\bchild_process\b|\bexecSync\s*\(|\bexecFile(Sync)?\s*\(|\bspawn(Sync)?\s*\(|\bos\/exec\b|\bexec\.Command\s*\(/,
  },
  {
    id: 'capability:network', label: 'Network / HTTP egress', category: 'network',
    re: /\brequests\.(get|post|put|delete|patch|head)\s*\(|\bhttpx\.(get|post|put|delete|Client)\b|\burllib\.request\b|\baiohttp\.|\bfetch\s*\(|\baxios\.(get|post|put|delete|create)\b|\bhttp\.(get|request)\s*\(|\bnet\/http\b|\bwebsocket/i,
  },
  {
    id: 'capability:filesystem', label: 'Filesystem write / delete', category: 'filesystem',
    re: /\bopen\s*\([^)]*,\s*['"][waxr]?\+?[wax]b?['"]|\bfs\.(writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmdir|rmSync|mkdir|createWriteStream)\b|\bshutil\.(rmtree|move|copy|copytree)\b|\bos\.(remove|unlink|rmdir|removedirs|makedirs)\b|\bpathlib\b[^\n]*\.write_text|\bioutil\.WriteFile\b|\bos\.(Create|Remove|Mkdir)\b/,
  },
  {
    id: 'capability:database', label: 'Database query / write', category: 'database',
    re: /\bcursor\.execute\s*\(|\bconn(ection)?\.execute\s*\(|\bsession\.(query|execute|add|delete)\b|\bdb\.(query|execute|run)\s*\(|\bknex\s*\(|\bprisma\.\w+\.(create|update|delete|findMany)\b|\bsequelize\b|\bpsycopg2\b|\bsqlalchemy\b|\bpymongo\b|\bcollection\.(insert|update|delete)/i,
  },
  {
    id: 'capability:cloud', label: 'Cloud SDK', category: 'cloud',
    re: /\bboto3\.(client|resource)\s*\(|\bbotocore\b|\bgoogle\.cloud\b|\bfrom\s+azure\b|\bimport\s+azure\b|@aws-sdk\/|\baws-sdk\b/,
  },
  {
    id: 'capability:email', label: 'Email / outbound messaging', category: 'email',
    re: /\bsmtplib\b|\bsend_email\s*\(|\bsendmail\s*\(|\bsendgrid\b|\bnodemailer\b|\bses\.send_email\b|\btwilio\b|\bslack_sdk\b|\bWebClient\s*\(/i,
  },
  {
    id: 'capability:payments', label: 'Payments / funds movement', category: 'payments',
    re: /\bstripe\.(Charge|PaymentIntent|Transfer|Payout|checkout)\b|\bstripe\b|\brazorpay\b|\bpaypalrestsdk\b|\bpaypal\b|\bbraintree\b|\bplaid\b/i,
  },
  {
    id: 'capability:code_exec', label: 'Dynamic code execution', category: 'code_exec',
    re: /(?<![.\w])eval\s*\(|(?<![.\w])exec\s*\(|\b__import__\s*\(|\bnew\s+Function\s*\(|\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader)/,
  },
];

/** Named-tool patterns. Each capture group 1 is the tool name. */
const NAMED_TOOL_PATTERNS: RegExp[] = [
  // Python decorators: @tool / @mcp.tool() / @server.tool(...) above a def.
  /@(?:\w+\.)?tool\s*(?:\([^)]*\))?\s*(?:\r?\n\s*)+(?:async\s+)?def\s+(\w+)/g,
  // `.tool("name")` / `.register_tool("name")` / `add_tool("name")` registrations.
  /\.(?:register_tool|add_tool|tool)\s*\(\s*['"]([\w.\-]+)['"]/g,
  // LangChain Tool(name="x") / StructuredTool(name="x").
  /\b(?:Structured)?Tool\s*(?:\.from_function)?\s*\(\s*(?:[^)]*?\bname\s*=\s*)?['"]([\w.\-]+)['"]/g,
  // OpenAI/JSON function schema: "function": {... "name": "x" ...} or bare {"name":"x","description"...}
  /['"]name['"]\s*:\s*['"]([\w.\-]{2,60})['"]\s*,\s*['"]description['"]/g,
];

const MAX_TOOLS = 40;

const lineOf = (content: string, index: number): number => {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
};

const trimSnippet = (content: string, line: number): string => {
  const lines = content.split('\n');
  return (lines[line - 1] ?? '').trim().slice(0, 160);
};

/**
 * Extract every distinct tool/capability a source file exercises. Deduped by id
 * (first occurrence wins for line/snippet), capped so a pathological file can't
 * blow up the payload.
 */
export function extractTools(content: string): DetectedTool[] {
  if (!content) return [];
  const found = new Map<string, DetectedTool>();

  for (const cap of CAPABILITIES) {
    const re = new RegExp(cap.re.source, cap.re.flags.includes('g') ? cap.re.flags : cap.re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (!found.has(cap.id)) {
        const line = lineOf(content, m.index);
        found.set(cap.id, { id: cap.id, label: cap.label, category: cap.category, line, snippet: trimSnippet(content, line) });
      }
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
      if (found.size >= MAX_TOOLS) break;
    }
  }

  for (const pat of NAMED_TOOL_PATTERNS) {
    let m: RegExpExecArray | null;
    const re = new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g');
    while ((m = re.exec(content)) !== null) {
      const name = (m[1] || '').trim();
      if (name && !RESERVED_NAMES.has(name.toLowerCase())) {
        const id = `tool:${name}`;
        if (!found.has(id)) {
          const line = lineOf(content, m.index);
          found.set(id, { id, label: name, category: 'named_tool', line, snippet: trimSnippet(content, line) });
        }
      }
      if (m.index === re.lastIndex) re.lastIndex++;
      if (found.size >= MAX_TOOLS) break;
    }
  }

  return [...found.values()].slice(0, MAX_TOOLS);
}

/** Names that the JSON-schema pattern picks up but aren't real tools. */
const RESERVED_NAMES = new Set(['function', 'object', 'string', 'number', 'array', 'boolean', 'type', 'properties']);

/** Just the normalised ids (what gets persisted and compared). */
export function detectedToolIds(content: string): string[] {
  return extractTools(content).map((t) => t.id);
}

/** Human label for a normalised id, for the UI/CI messages. */
export function toolLabel(id: string): string {
  if (id.startsWith('tool:')) return id.slice(5);
  const cap = CAPABILITIES.find((c) => c.id === id);
  return cap ? cap.label : id;
}
