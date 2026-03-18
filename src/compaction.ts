/**
 * Context compaction - uses LLM to summarize old messages instead of removing them.
 *
 * Strategy:
 * 1. When context nears the limit, split messages into "old" and "recent"
 * 2. Send old messages to LLM for summarization
 * 3. Replace old messages with a compact summary message
 * 4. Preserve recent context for continuity
 */

import { streamResponse } from "./provider.js";
import type { AgentConfig, Message, AssistantContent } from "./types.js";
import { estimateMessageTokens, estimateTokens, getContextLimit } from "./context.js";

const COMPACTION_THRESHOLD = 0.80; // Start compaction at 80% of context
const KEEP_RECENT_TOKENS = 30_000; // Keep ~30k tokens of recent context
const RESPONSE_RESERVE = 16_384;

const SUMMARIZATION_PROMPT = `Summarize the following conversation between a user and an AI coding agent into a structured summary. The agent must be able to continue its work with ONLY this summary and the recent messages.

Use EXACTLY these five sections:

## Task Overview
What is the user trying to accomplish? What was the original request?

## Current State
What has been done so far? List every file that was read, created, modified, or deleted — include full paths. What does the code look like NOW after all changes?

## Important Discoveries
Key decisions and WHY they were made. Errors encountered (resolved and pending). Any user corrections, preferences, or constraints stated. Technical findings that informed the approach.

## Next Steps
What still needs to be done? What was the agent working on when this summary was generated?

## Context to Preserve
Exact file paths, variable names, function signatures, error messages, or other specific details that would be expensive to re-derive. Include code snippets only when they capture critical state.

Be concise but COMPLETE on file paths, decisions, and technical details.`;

/**
 * Check if compaction is needed.
 */
export function needsCompaction(
  messages: Message[],
  systemPromptTokens: number,
  model: string
): boolean {
  const limit = getContextLimit(model);
  const maxTokens = Math.floor(limit * COMPACTION_THRESHOLD) - RESPONSE_RESERVE;

  let total = systemPromptTokens;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }

  return total > maxTokens;
}

/**
 * Find the split point: keep recent messages, summarize old ones.
 */
function findSplitPoint(messages: Message[]): number {
  let recentTokens = 0;

  // Walk backward from end to find how many recent messages to keep
  for (let i = messages.length - 1; i >= 0; i--) {
    recentTokens += estimateMessageTokens(messages[i]);
    if (recentTokens > KEEP_RECENT_TOKENS) {
      // Keep from i+1 onward
      return Math.max(1, i + 1); // Always keep at least the first message
    }
  }

  // Everything fits in recent - keep at least first message for summary
  return Math.max(1, Math.floor(messages.length / 2));
}

/**
 * Serialize messages for the summarization prompt.
 */
function serializeForSummary(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      parts.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          // Summarize based on tool type for better context preservation
          const input = block.input;
          if (block.name === "Read" || block.name === "Write" || block.name === "Edit") {
            textParts.push(`[Tool: ${block.name}(${input.file_path || "?"})]`);
          } else if (block.name === "Bash") {
            const cmd = String(input.command || "").substring(0, 100);
            textParts.push(`[Tool: Bash(${cmd})]`);
          } else if (block.name === "Grep") {
            textParts.push(`[Tool: Grep(${input.pattern || "?"} in ${input.path || "cwd"})]`);
          } else {
            const inputStr = JSON.stringify(input);
            const summary = inputStr.length > 150 ? inputStr.substring(0, 150) + "..." : inputStr;
            textParts.push(`[Tool: ${block.name}(${summary})]`);
          }
        }
      }
      if (textParts.length > 0) {
        parts.push(`Assistant: ${textParts.join("\n")}`);
      }
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const preview = block.content.length > 300
          ? block.content.substring(0, 300) + "..."
          : block.content;
        parts.push(`[Tool result${block.is_error ? " (error)" : ""}: ${preview}]`);
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Compact messages by summarizing old ones via LLM.
 * Falls back to simple truncation if LLM call fails.
 */
export async function compactMessages(
  config: AgentConfig,
  messages: Message[],
  systemPromptTokens: number
): Promise<Message[]> {
  const splitPoint = findSplitPoint(messages);

  if (splitPoint <= 1) {
    // Nothing to compact - fall back to simple truncation
    return simpleTruncate(messages, systemPromptTokens, config.model);
  }

  const oldMessages = messages.slice(0, splitPoint);
  const recentMessages = messages.slice(splitPoint);

  // Try LLM-based summarization
  try {
    const serialized = serializeForSummary(oldMessages);

    // Use a minimal config for summarization (no tools needed)
    const summaryConfig: AgentConfig = {
      ...config,
      systemPrompt: SUMMARIZATION_PROMPT,
      tools: [],
      maxTokens: 4096,
    };

    const summaryMessages: Message[] = [
      { role: "user", content: serialized },
    ];

    let summary = "";
    for await (const event of streamResponse(summaryConfig, summaryMessages)) {
      if (event.type === "text_delta") {
        summary += event.text;
      }
      if (event.type === "error") {
        throw new Error(event.error);
      }
    }

    if (summary.length < 50) {
      // Summary too short, probably failed
      throw new Error("Summary too short");
    }

    // Build compacted message array
    const compacted: Message[] = [
      {
        role: "user",
        content: `[Conversation summary - earlier messages were compacted to save context space]\n\n${summary}\n\n[End of summary. Recent conversation continues below.]`,
      },
      ...recentMessages,
    ];

    return compacted;
  } catch {
    // LLM summarization failed, fall back to simple truncation
    return simpleTruncate(messages, systemPromptTokens, config.model);
  }
}

/**
 * Simple truncation fallback - remove oldest messages from the middle.
 */
function simpleTruncate(
  messages: Message[],
  systemPromptTokens: number,
  model: string
): Message[] {
  const limit = getContextLimit(model);
  const maxTokens = Math.floor(limit * COMPACTION_THRESHOLD) - RESPONSE_RESERVE;

  let totalTokens = systemPromptTokens;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  const result = [...messages];
  const keepFirst = 1;
  const keepLast = 6;

  while (totalTokens > maxTokens && result.length > keepFirst + keepLast) {
    const removed = result.splice(keepFirst, 1)[0];
    totalTokens -= estimateMessageTokens(removed);
  }

  if (result.length < messages.length) {
    const removedCount = messages.length - result.length;
    result.splice(keepFirst, 0, {
      role: "user" as const,
      content: `[System: ${removedCount} earlier messages were removed to fit context window. Recent context is preserved.]`,
    });
  }

  return result;
}
