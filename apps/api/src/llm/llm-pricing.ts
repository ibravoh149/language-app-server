/**
 * Estimated USD per million tokens, by model, for the admin cost view (D26).
 * Override or extend with LLM_PRICES_JSON='{"model":{"input":0.15,"output":0.6}}'.
 * Unknown models and local Ollama cost 0.
 */
const DEFAULT_PRICES: Record<string, { input: number; output: number }> = {
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
};

function loadPrices() {
  try {
    return { ...DEFAULT_PRICES, ...(process.env.LLM_PRICES_JSON ? JSON.parse(process.env.LLM_PRICES_JSON) : {}) };
  } catch {
    return DEFAULT_PRICES;
  }
}

const PRICES = loadPrices();

export function estimateCostUsd(provider: string | null, model: string | null, promptTokens: number | null, completionTokens: number | null) {
  if (!model || provider === 'ollama') return 0;
  const price = PRICES[model];
  if (!price) return 0;
  return ((promptTokens ?? 0) * price.input + (completionTokens ?? 0) * price.output) / 1_000_000;
}
