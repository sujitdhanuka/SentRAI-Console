import { detectedToolIds, extractTools } from './tool-detector';
import { authorizeTools } from '../domain/tool-authorization';

describe('tool-detector', () => {
  it('detects capability primitives across languages', () => {
    const py = 'import subprocess, requests\nsubprocess.run(cmd, shell=True)\nrequests.post(url)\n';
    const ids = detectedToolIds(py);
    expect(ids).toContain('capability:shell');
    expect(ids).toContain('capability:network');
  });

  it('detects named agent tools from decorators and registrations', () => {
    const src = '@tool\ndef transfer_funds(amount):\n    return 1\n\nserver.tool("lookup_customer")\n';
    const tools = extractTools(src).map((t) => t.id);
    expect(tools).toContain('tool:transfer_funds');
    expect(tools).toContain('tool:lookup_customer');
  });

  it('detects filesystem, database and dynamic-exec capabilities', () => {
    const src = 'cursor.execute("DELETE FROM t")\nfs.writeFileSync(p, x)\neval(userInput)\n';
    const ids = detectedToolIds(src);
    expect(ids).toContain('capability:database');
    expect(ids).toContain('capability:filesystem');
    expect(ids).toContain('capability:code_exec');
  });

  it('returns nothing for a plain file with no capabilities', () => {
    expect(detectedToolIds('const x = 1 + 2;\nconsole.log(x);\n')).toEqual([]);
  });
});

describe('authorizeTools', () => {
  it('flags a detected tool outside the permitted set', () => {
    const a = authorizeTools(['capability:network'], ['capability:network', 'capability:shell']);
    expect(a.unauthorized).toEqual(['capability:shell']);
    expect(a.compliant).toBe(false);
  });

  it('is compliant when every detected tool is permitted', () => {
    const a = authorizeTools(['capability:network', 'capability:shell'], ['capability:shell']);
    expect(a.unauthorized).toEqual([]);
    expect(a.compliant).toBe(true);
  });

  it('marks undeclared when tools are used but none are permitted', () => {
    const a = authorizeTools([], ['capability:shell']);
    expect(a.undeclared).toBe(true);
    expect(a.compliant).toBe(false);
  });
});
