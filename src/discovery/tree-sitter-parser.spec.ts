import { TreeSitterService } from './tree-sitter-parser';

/**
 * Proves the deepened AST layer adds coverage the regex pass cannot: aliased /
 * renamed SDK clients (obfuscation resilience) and model-usage patterns that
 * carry no recognizable import (data-flow-lite).
 */
describe('TreeSitterService — deep AST', () => {
  let svc: TreeSitterService;

  beforeAll(async () => {
    svc = new TreeSitterService();
    await svc.onModuleInit();
  }, 30000);

  it('loads the WASM grammars', () => {
    expect(svc.ready).toBe(true);
  });

  it('resolves an aliased OpenAI client through a renamed variable', () => {
    const code = [
      'import openai as oai',
      'client = oai.OpenAI(api_key="sk-hardcoded-123456")',
      'resp = client.chat.completions.create(model="gpt-4", messages=[])',
    ].join('\n');
    const { signals, gaps } = svc.scanPython(code);
    // The call on the renamed `client` variable is attributed back to openai.
    expect(signals.some((s) => s.category === 'llm_sdk' && /openai/i.test(s.evidence))).toBe(true);
    // Hardcoded credential is flagged structurally.
    expect(gaps.some((g) => /hardcoded/i.test(g))).toBe(true);
  });

  it('detects HuggingFace from_pretrained that the regex table misses', () => {
    const code = ['from transformers import AutoModel', 'model = AutoModel.from_pretrained("bert-base")'].join('\n');
    const { signals } = svc.scanPython(code);
    expect(signals.some((s) => s.category === 'model_load' && /from_pretrained/i.test(s.evidence))).toBe(true);
  });

  it('detects an ONNX InferenceSession with no ML keyword import', () => {
    const code = ['import onnxruntime as ort', 'sess = ort.InferenceSession("model.onnx")'].join('\n');
    const { signals } = svc.scanPython(code);
    expect(signals.some((s) => s.category === 'model_load' && /onnx|InferenceSession/i.test(s.evidence))).toBe(true);
  });

  it('attributes a from-import renamed constructor (from openai import OpenAI as Foo)', () => {
    const code = ['from openai import OpenAI as Foo', 'c = Foo()', 'c.chat.completions.create(model="gpt-4")'].join('\n');
    const { signals } = svc.scanPython(code);
    expect(signals.some((s) => s.category === 'llm_sdk')).toBe(true);
  });

  it('stays quiet on non-AI code (no false positives)', () => {
    const code = ['import os', 'def add(a, b):', '    return a + b'].join('\n');
    const { signals } = svc.scanPython(code);
    expect(signals.length).toBe(0);
  });

  it('returns empty when the runtime is not ready (regex-only fallback)', () => {
    const cold = new TreeSitterService();
    const res = cold.scanPython('import openai\nopenai.chat.completions.create()');
    expect(res.signals).toEqual([]);
    expect(res.libs).toEqual([]);
  });
});
