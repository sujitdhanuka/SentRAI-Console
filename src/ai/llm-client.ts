/**
 * Minimal chat-completion client for both wire protocols, used by the
 * provider connection test and the org-configured summarizer adapters.
 * No SDK dependency — Node 18+ fetch with an explicit timeout.
 *
 *  - 'openai-compat': POST {base}/chat/completions  (OpenAI, Gemini's OpenAI
 *    endpoint, Ollama /v1, OpenRouter, Together.ai, HF router, Groq, vLLM…)
 *  - 'anthropic':     POST {base}/v1/messages
 */

export interface ChatCompleteOptions {
  adapter: string; // 'openai-compat' | 'anthropic'
  baseUrl: string;
  model: string;
  apiKey: string | null;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatCompleteResult {
  text: string;
  /** Token accounting when the provider reports it (both protocols usually do). */
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export async function chatComplete(opts: ChatCompleteOptions): Promise<ChatCompleteResult> {
  const base = opts.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  const started = Date.now();
  try {
    if (opts.adapter === 'anthropic') {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 400,
          messages: [{ role: 'user', content: opts.prompt }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const data: any = await res.json();
      const text = (data?.content ?? [])
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();
      if (!text) throw new Error('Provider returned no text');
      return {
        text,
        tokensIn: data?.usage?.input_tokens ?? null,
        tokensOut: data?.usage?.output_tokens ?? null,
        latencyMs: Date.now() - started,
      };
    }

    // openai-compat
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 400,
        messages: [{ role: 'user', content: opts.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data: any = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('Provider returned no text');
    return {
      text,
      tokensIn: data?.usage?.prompt_tokens ?? null,
      tokensOut: data?.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
