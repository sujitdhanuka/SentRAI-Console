import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import Parser from 'web-tree-sitter';

export interface AstScanResult {
  libs: string[];
  gaps: string[];
}

const nodeRequire = createRequire(__filename);

/**
 * Tree-sitter (WASM) semantic scanning for Python/JS/TS/Go. Port of
 * tree_sitter_parser.py. If the WASM runtime or grammars fail to load (e.g. a
 * restricted host), every scan degrades to an empty result — the regex layer in
 * the codebase scanner still runs, matching Python's HAS_TREE_SITTER fallback.
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

  private captures(lang: string, query: string, content: string): Array<{ name: string; type: string; text: string }> {
    const parser = this.parsers[lang];
    const language = this.langs[lang];
    const tree = parser.parse(content);
    const q = language.query(query);
    const out: Array<{ name: string; type: string; text: string }> = [];
    for (const match of q.matches(tree.rootNode)) {
      for (const c of match.captures) {
        out.push({ name: c.name, type: c.node.type, text: c.node.text });
      }
    }
    return out;
  }

  scanPython(content: string): AstScanResult {
    const libs = new Set<string>();
    const gaps: string[] = [];
    if (!this.ready) return { libs: [], gaps };

    try {
      for (const c of this.captures(
        'python',
        '(import_statement name: (dotted_name) @import) (import_from_statement module_name: (dotted_name) @import_from)',
        content,
      )) {
        libs.add(c.text.split('.')[0]);
      }
      for (const c of this.captures(
        'python',
        '(call function: [(identifier) @func_name (attribute attribute: (identifier) @func_name)] arguments: (argument_list (keyword_argument) @kw_arg))',
        content,
      )) {
        if (c.type === 'identifier') {
          if (['OpenAI', 'ChatOpenAI', 'Anthropic', 'GenerativeModel', 'pipeline'].includes(c.text)) {
            libs.add('generative_api_call');
          }
        } else if (c.type === 'keyword_argument') {
          if (c.text.includes('api_key') && (c.text.includes("'") || c.text.includes('"'))) {
            gaps.push('Vulnerability: Hardcoded api_key string literal passed in function call.');
          }
        }
      }
    } catch (e) {
      this.logger.debug(`python AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps };
  }

  scanJsTs(content: string, isTypescript: boolean): AstScanResult {
    const lang = isTypescript ? 'typescript' : 'javascript';
    const libs = new Set<string>();
    const gaps: string[] = [];
    if (!this.ready) return { libs: [], gaps };

    const addLib = (raw: string) => {
      const val = raw.replace(/^['"]|['"]$/g, '');
      if (!val || val === 'require') return;
      const base = val.startsWith('@') ? val.split('/').slice(-1)[0] : val.split('/')[0];
      libs.add(base);
    };

    try {
      for (const c of this.captures('javascript' === lang ? 'javascript' : 'typescript',
        '(import_statement source: (string) @import_source)', content)) {
        addLib(c.text);
      }
      // require('x')
      const reqCaps = this.captures(lang,
        '(call_expression function: (identifier) @fn arguments: (arguments (string) @arg))', content);
      for (let i = 0; i < reqCaps.length; i++) {
        if (reqCaps[i].name === 'fn' && reqCaps[i].text === 'require') {
          const arg = reqCaps[i + 1];
          if (arg && arg.name === 'arg') addLib(arg.text);
        }
      }
      // Hardcoded apiKey in constructor options object
      for (const c of this.captures(lang,
        '(new_expression constructor: (identifier) @constructor arguments: (arguments (object (pair key: [(property_identifier) @prop_name (string) @prop_name] value: (string) @prop_value))))',
        content)) {
        if (c.text.includes('apiKey') && !c.text.includes('process.env')) {
          gaps.push('Vulnerability: Hardcoded apiKey string literal passed in constructor call.');
        }
      }
    } catch (e) {
      this.logger.debug(`js/ts AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps };
  }

  scanGo(content: string): AstScanResult {
    const libs = new Set<string>();
    const gaps: string[] = [];
    if (!this.ready) return { libs: [], gaps };
    try {
      for (const c of this.captures('go', '(import_spec path: (interpreted_string_literal) @import_path)', content)) {
        const val = c.text.replace(/"/g, '');
        if (val) libs.add(val.split('/').slice(-1)[0]);
      }
    } catch (e) {
      this.logger.debug(`go AST scan failed: ${String(e)}`);
    }
    return { libs: [...libs], gaps };
  }
}
