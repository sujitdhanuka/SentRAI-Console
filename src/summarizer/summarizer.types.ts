/**
 * Contracts for the model-description summariser. The service turns what static
 * discovery already knows about a model (type, area, signals, its raw docstring,
 * and — for the AI provider — a secret-masked code snippet) into a concise,
 * plain-language *governance* summary an auditor can act on.
 */

/** Everything a provider may use to write the summary. Assembled by the caller
 *  from the persisted model; `snippet` is only populated for the AI provider. */
export interface SummarizationContext {
  name: string;
  modelType: string;
  functionalArea: string;
  existingDescription: string;
  signals: string[];
  domainTags: string[];
  humanOversightRequired: boolean;
  hasHardcodedSecret: boolean;
  /** Secret-masked source excerpt. Never populated for the heuristic provider. */
  snippet?: string | null;
}

/** Provenance of a stored description — surfaced in the UI so an AI/auto draft
 *  is never mistaken for a human-confirmed fact. */
export type SummarySource = 'static' | 'heuristic' | 'ai' | 'human';

export interface SummaryResult {
  text: string;
  source: SummarySource;
  /** The model that produced it, e.g. 'claude-sonnet-5' — null for non-AI sources. */
  model: string | null;
  /** Provider-reported token accounting (AI sources only). */
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number;
}

export interface Summarizer {
  readonly source: SummarySource;
  readonly model: string | null;
  generate(ctx: SummarizationContext): Promise<SummaryResult>;
}
