/** Detects agentic AI frameworks in source text. Port of framework_detector.py. */
export function detectAgenticFrameworks(content: string): string[] {
  const frameworks = new Set<string>();

  // Python frameworks
  if (/\bimport\s+langchain|\bfrom\s+langchain/.test(content)) frameworks.add('langchain');
  if (/\bimport\s+crewai|\bfrom\s+crewai/.test(content)) frameworks.add('crewai');
  if (/\bimport\s+autogen|\bfrom\s+autogen/.test(content)) frameworks.add('autogen');
  if (/\bFastMCP\b|\bmodelcontextprotocol\b|\bmcp\b/i.test(content)) frameworks.add('mcp');

  // JS/TS frameworks
  if (/from\s+['"]langchain/.test(content)) frameworks.add('langchain');

  return [...frameworks];
}
