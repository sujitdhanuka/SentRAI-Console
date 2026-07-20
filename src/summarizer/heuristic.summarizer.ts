import { SummarizationContext, Summarizer, SummaryResult } from './summarizer.types';

/**
 * Local, network-free summariser (the shipped default and the permanent fallback
 * for when the AI provider is disabled or errors). It doesn't invent facts — it
 * reframes the scanner's structured signals + the raw docstring into plain,
 * governance-oriented language, stripping code jargon. Deterministic, so tests
 * and audits are reproducible.
 */

const TYPE_LABELS: Record<string, string> = {
  MACHINE_LEARNING: 'a machine-learning model',
  DEEP_LEARNING: 'a deep-learning model',
  NLP: 'a natural-language model',
  GENERATIVE_AI: 'a generative-AI / LLM component',
  RULES_BASED: 'a rules-based decision component',
  HYBRID: 'a hybrid AI component',
  AGENT: 'an autonomous agent',
  TOOL: 'an AI tool',
  MCP_SERVER: 'an MCP tool server',
};

const SIGNAL_LABELS: Record<string, string> = {
  decision_function: 'scoring/decision logic',
  inference_call: 'live model inference',
  model_load: 'loading a trained model',
  ml_sdk: 'an ML framework',
  llm_api: 'an LLM API',
  agent_sdk: 'an agent framework',
  agent_keyword: 'agentic orchestration',
  mcp_server: 'an MCP server',
  ai_tool: 'tool-calling',
};

function humanizeArea(area: string): string {
  const a = (area || '').trim();
  if (!a || a === 'unspecified') return 'an unspecified business function';
  return a.replace(/[_-]+/g, ' ');
}

function humanizeSignals(signals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of signals) {
    const label = SIGNAL_LABELS[s] || s.replace(/[_-]+/g, ' ');
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

/** Turn a raw docstring/comment into one clean sentence: drop code markup, RST
 *  backticks, type noise, collapse whitespace, keep the first sentence. */
function cleanPurpose(desc: string): string {
  if (!desc) return '';
  let s = desc
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // ``code`` spans
    .replace(/\bdict\[[^\]]*\]/gi, '') // dict[code, Series] noise
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
  const firstSentence = s.split(/(?<=[.!?])\s/)[0] || s;
  return firstSentence.slice(0, 220).trim();
}

export class HeuristicSummarizer implements Summarizer {
  readonly source = 'heuristic' as const;
  readonly model = null;

  async generate(ctx: SummarizationContext): Promise<SummaryResult> {
    const parts: string[] = [];
    const typeLabel = TYPE_LABELS[ctx.modelType] || 'an AI/automation component';
    parts.push(`${ctx.name} is ${typeLabel} supporting ${humanizeArea(ctx.functionalArea)}.`);

    const purpose = cleanPurpose(ctx.existingDescription);
    if (purpose) parts.push(/[.!?]$/.test(purpose) ? purpose : `${purpose}.`);

    const signals = humanizeSignals(ctx.signals);
    if (signals.length) parts.push(`Static analysis detected ${signals.join(', ')}.`);

    if (ctx.domainTags?.length) parts.push(`Domain: ${ctx.domainTags.slice(0, 3).join(', ')}.`);

    parts.push(
      ctx.humanOversightRequired
        ? 'A human-in-the-loop review is expected before its outputs are acted on.'
        : 'No human-in-the-loop review is enforced — confirm this is acceptable for its risk.',
    );

    if (ctx.hasHardcodedSecret) {
      parts.push('⚠ A hardcoded secret was found in its source and must be remediated before production.');
    }

    parts.push('(Auto-generated summary — review and confirm before governance sign-off.)');
    return { text: parts.join(' '), source: this.source, model: this.model };
  }
}
