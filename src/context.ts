/**
 * Context window management.
 * Estimates token usage and truncates conversation history to stay within limits.
 */

import type { Message, AssistantContent } from "./types.js";

// Model context window sizes (in tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
  // Anthropic Claude 4
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  // Anthropic Claude 3.5
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  // Anthropic Claude 3
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  // DeepSeek
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
};

const DEFAULT_CONTEXT_LIMIT = 128_000;
// Reserve tokens for the response
const RESPONSE_RESERVE = 16_384;
// When we hit this ratio of the context window, start truncating
const TRUNCATION_THRESHOLD = 0.85;

/**
 * Estimate token count for a string.
 * Rough heuristic: ~4 chars per token for English, ~2 chars per token for CJK.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK characters
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const nonCjkLength = text.length - cjkCount;
  return Math.ceil(nonCjkLength / 4 + cjkCount / 2);
}

/**
 * Estimate tokens for a single content block.
 */
function estimateContentTokens(content: AssistantContent): number {
  switch (content.type) {
    case "text":
      return estimateTokens(content.text);
    case "thinking":
      return estimateTokens(content.thinking);
    case "tool_use":
      return estimateTokens(content.name) + estimateTokens(JSON.stringify(content.input)) + 10;
    default:
      return 0;
  }
}

/**
 * Estimate tokens for a message.
 */
export function estimateMessageTokens(msg: Message): number {
  const overhead = 4; // role + formatting tokens

  if (msg.role === "user" && typeof msg.content === "string") {
    return overhead + estimateTokens(msg.content);
  }

  if (msg.role === "assistant") {
    let total = overhead;
    for (const block of msg.content) {
      total += estimateContentTokens(block);
    }
    return total;
  }

  // ToolResultMessage
  if (msg.role === "user" && Array.isArray(msg.content)) {
    let total = overhead;
    for (const block of msg.content) {
      total += estimateTokens(block.content) + 10;
    }
    return total;
  }

  return overhead;
}

/**
 * Get context window limit for a model.
 */
export function getContextLimit(model: string): number {
  // Check exact match first
  if (MODEL_CONTEXT_LIMITS[model]) {
    return MODEL_CONTEXT_LIMITS[model];
  }
  // Check prefix match (e.g., "claude-3-5-sonnet" matches "claude-3-5-sonnet-20241022")
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return limit;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * Calculate total tokens for system prompt + messages.
 */
export function calculateTotalTokens(
  systemPromptTokens: number,
  messages: Message[]
): number {
  let total = systemPromptTokens;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/**
 * Truncate messages to fit within context window.
 * Strategy: keep the first message (initial context) and remove oldest messages from the middle.
 * Tool result pairs (tool_use + tool_result) are removed together.
 *
 * Returns a new array (does not mutate input).
 */
export function truncateMessages(
  messages: Message[],
  systemPromptTokens: number,
  model: string
): Message[] {
  const limit = getContextLimit(model);
  const maxTokens = Math.floor(limit * TRUNCATION_THRESHOLD) - RESPONSE_RESERVE;

  let totalTokens = calculateTotalTokens(systemPromptTokens, messages);

  if (totalTokens <= maxTokens) {
    return messages;
  }

  const result = [...messages];

  // Keep at least the first user message and the last few messages
  const keepFirst = 1;
  const keepLast = 6; // Keep recent context

  while (totalTokens > maxTokens && result.length > keepFirst + keepLast) {
    // Remove from position after first message
    const removed = result.splice(keepFirst, 1)[0];
    totalTokens -= estimateMessageTokens(removed);
  }

  // If still over limit after removing middle messages, truncate long tool results
  if (totalTokens > maxTokens) {
    for (let i = 0; i < result.length; i++) {
      const msg = result[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.content.length > 2000) {
            const saved = estimateTokens(block.content) - estimateTokens("[truncated]");
            block.content = block.content.substring(0, 500) + "\n... [truncated] ...\n" + block.content.substring(block.content.length - 500);
            totalTokens -= saved;
            if (totalTokens <= maxTokens) break;
          }
        }
        if (totalTokens <= maxTokens) break;
      }
    }
  }

  // Add a system note about truncation if messages were removed
  if (result.length < messages.length) {
    const removedCount = messages.length - result.length;
    // Insert a note after the first message
    result.splice(keepFirst, 0, {
      role: "user" as const,
      content: `[System: ${removedCount} earlier messages were removed to fit context window. Recent context is preserved.]`,
    });
  }

  return result;
}
