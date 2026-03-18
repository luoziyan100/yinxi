/**
 * Cost estimation based on model pricing.
 * Prices are per million tokens (input / output).
 */

import type { TokenUsage } from "./types.js";

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "o3": { inputPer1M: 10.0, outputPer1M: 40.0 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Anthropic
  "claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4.0 },
  "claude-3-opus": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25 },
  // DeepSeek
  "deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
};

/**
 * Find pricing for a model (supports prefix matching).
 */
function findPricing(model: string): ModelPricing | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return null;
}

/**
 * Estimate cost for given token usage and model.
 */
export function estimateCost(usage: TokenUsage, model: string): number | null {
  const pricing = findPricing(model);
  if (!pricing) return null;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputPer1M
  );
}

/**
 * Format cost as a readable string.
 */
export function formatCost(cost: number | null): string {
  if (cost === null) return "unknown";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
