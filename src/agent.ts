/**
 * Agent loop - the core conversation engine.
 *
 * Orchestrates: user input → LLM streaming → tool execution → loop back
 * Includes context window management and token tracking.
 */

import { streamResponse, parseStreamedContent } from "./provider.js";
import {
  truncateMessages,
  estimateTokens,
  calculateTotalTokens,
} from "./context.js";
import { needsCompaction, compactMessages } from "./compaction.js";
import { appendMessage, appendMessages, appendCompaction } from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type {
  AgentConfig,
  AgentEvent,
  Message,
  AssistantMessage,
  ToolResultMessage,
  ToolResultBlock,
  ToolUseBlock,
  Tool,
  TokenUsage,
} from "./types.js";

export type EventListener = (event: AgentEvent) => void;

export class Agent {
  private config: AgentConfig;
  private messages: Message[] = [];
  private tools: Map<string, Tool>;
  private listeners: EventListener[] = [];
  private abortController: AbortController | null = null;
  private systemPromptTokens: number;
  private sessionId: string | null = null;

  // Cumulative token usage for the session
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  // Track files modified during session
  private modifiedFiles = new Set<string>();

  constructor(config: AgentConfig) {
    this.config = config;
    this.tools = new Map(config.tools.map((t) => [t.name, t]));
    this.systemPromptTokens = estimateTokens(config.systemPrompt);
  }

  /**
   * Attach a session ID for persistence. Messages will be saved to disk.
   */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Load messages from a previous session.
   */
  loadMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  /**
   * Subscribe to agent events for real-time UI updates.
   */
  subscribe(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Get conversation history.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Clear conversation history.
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Get cumulative token usage for this session.
   */
  getUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  /**
   * Get list of files modified during this session.
   */
  getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  /**
   * Abort the current operation.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Send a user message and run the agent loop until complete.
   */
  async prompt(userMessage: string): Promise<void> {
    // Refresh system prompt (updates git info, date, etc.)
    if (this.config.cwd) {
      try {
        this.config.systemPrompt = await buildSystemPrompt(this.config.cwd);
        this.systemPromptTokens = estimateTokens(this.config.systemPrompt);
      } catch {
        // Keep existing system prompt on error
      }
    }

    this.promptCount++;
    const userMsg: Message = { role: "user", content: userMessage };
    this.messages.push(userMsg);

    // Persist user message
    if (this.sessionId) {
      appendMessage(this.sessionId, userMsg).catch(() => {});
    }

    // LLM-based compaction if context is getting full
    if (needsCompaction(this.messages, this.systemPromptTokens, this.config.model)) {
      this.emit({ type: "status", message: "Compacting conversation history..." });
      const beforeCount = this.messages.length;
      this.messages = await compactMessages(
        this.config,
        this.messages,
        this.systemPromptTokens
      );
      const afterCount = this.messages.length;
      this.emit({ type: "status", message: `Compaction complete (${beforeCount} → ${afterCount} messages).` });
      if (this.sessionId) {
        appendCompaction(this.sessionId, "auto", beforeCount - afterCount).catch(() => {});
      }
    }

    // Hard truncation as safety net
    this.messages = truncateMessages(
      this.messages,
      this.systemPromptTokens,
      this.config.model
    );

    this.abortController = new AbortController();
    this.overflowRecoveryAttempted = false;
    try {
      await this.runLoop();
    } finally {
      this.abortController = null;
    }
  }

  // Track if we've already attempted overflow recovery to avoid infinite loops
  private overflowRecoveryAttempted = false;
  // Track prompt count for periodic checks
  private promptCount = 0;

  // Maximum tool turns per prompt to prevent infinite loops
  private static readonly MAX_LOOP_ITERATIONS = 100;

  /**
   * Main agent loop:
   * 1. Stream LLM response
   * 2. If tool calls → execute them, add results, loop back to 1
   * 3. If no tool calls (end_turn) → done
   * 4. On context overflow → compact and retry (once)
   */
  private async runLoop(): Promise<void> {
    let iterations = 0;
    while (iterations++ < Agent.MAX_LOOP_ITERATIONS) {
      if (this.abortController?.signal.aborted) {
        return;
      }

      const events: AgentEvent[] = [];
      let overflowError = false;

      for await (const event of streamResponse(
        this.config,
        this.messages,
        this.abortController?.signal
      )) {
        if (this.abortController?.signal.aborted) {
          return;
        }

        // Detect context overflow errors
        if (event.type === "error") {
          const errMsg = event.error.toLowerCase();
          if (
            !this.overflowRecoveryAttempted &&
            (errMsg.includes("context length") ||
             errMsg.includes("context window") ||
             errMsg.includes("maximum context") ||
             errMsg.includes("token limit") ||
             errMsg.includes("too many tokens") ||
             errMsg.includes("request too large") ||
             errMsg.includes("prompt is too long") ||
             errMsg.includes("exceeds the model"))
          ) {
            overflowError = true;
            break;
          }
          this.emit(event);
          return;
        }

        events.push(event);
        this.emit(event);

        // Track token usage from turn_end events
        if (event.type === "turn_end" && event.usage) {
          this.totalUsage.inputTokens += event.usage.inputTokens;
          this.totalUsage.outputTokens += event.usage.outputTokens;
        }
      }

      // Handle overflow: compact and retry
      if (overflowError) {
        this.overflowRecoveryAttempted = true;
        this.emit({ type: "status", message: "Context overflow detected. Compacting and retrying..." });
        this.messages = await compactMessages(
          this.config,
          this.messages,
          this.systemPromptTokens
        );
        this.messages = truncateMessages(
          this.messages,
          this.systemPromptTokens,
          this.config.model
        );
        continue; // Retry the loop with compacted context
      }

      const contentBlocks = parseStreamedContent(events);

      // Guard: if stream produced no content, don't add empty assistant message
      if (contentBlocks.length === 0) {
        return;
      }

      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: contentBlocks,
      };
      this.messages.push(assistantMessage);

      // Persist assistant message
      if (this.sessionId) {
        appendMessage(this.sessionId, assistantMessage).catch(() => {});
      }

      const toolUses = contentBlocks.filter(
        (b): b is ToolUseBlock => b.type === "tool_use"
      );

      if (toolUses.length === 0) {
        return;
      }

      // Execute tools - parallel when multiple, sequential for single
      const toolResults: ToolResultBlock[] = [];

      const executeOne = async (toolUse: ToolUseBlock): Promise<ToolResultBlock> => {
        const tool = this.tools.get(toolUse.name);

        if (!tool) {
          const result = {
            content: `Unknown tool: ${toolUse.name}`,
            isError: true,
          };
          this.emit({ type: "tool_result", id: toolUse.id, name: toolUse.name, result });
          return {
            type: "tool_result" as const,
            tool_use_id: toolUse.id,
            content: `Error: Unknown tool "${toolUse.name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
            is_error: true,
          };
        }

        let result;
        try {
          result = await tool.execute(toolUse.input, this.abortController?.signal);
        } catch (err) {
          result = {
            content: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }

        // Track file modifications
        if (!result.isError && (toolUse.name === "Write" || toolUse.name === "Edit")) {
          const filePath = toolUse.input.file_path as string;
          if (filePath) this.modifiedFiles.add(filePath);
        }

        this.emit({ type: "tool_result", id: toolUse.id, name: toolUse.name, result });
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.isError,
        };
      };

      if (this.abortController?.signal.aborted) return;

      if (toolUses.length === 1) {
        // Single tool: run directly
        toolResults.push(await executeOne(toolUses[0]));
      } else {
        // Multiple tools: run in parallel
        const results = await Promise.all(toolUses.map(executeOne));
        toolResults.push(...results);
      }

      // Truncate oversized tool results before adding to context
      for (const result of toolResults) {
        if (result.content.length > 50_000) {
          const lines = result.content.split("\n");
          const halfLines = Math.floor(lines.length / 2);
          const keepFront = lines.slice(0, Math.min(200, halfLines)).join("\n");
          const keepBack = lines.slice(-Math.min(100, halfLines)).join("\n");
          result.content = `${keepFront}\n\n... [${lines.length - 300} lines truncated] ...\n\n${keepBack}`;
        }
      }

      const toolResultMessage: ToolResultMessage = {
        role: "user",
        content: toolResults,
      };
      this.messages.push(toolResultMessage);

      // Persist tool results
      if (this.sessionId) {
        appendMessage(this.sessionId, toolResultMessage).catch(() => {});
      }

      // Truncate after adding tool results (they can be large)
      this.messages = truncateMessages(
        this.messages,
        this.systemPromptTokens,
        this.config.model
      );
    }

    // Safety: if we hit the max loop limit
    this.emit({
      type: "error",
      error: `Agent reached maximum tool iterations (${Agent.MAX_LOOP_ITERATIONS}). Stopping to prevent infinite loop.`,
    });
  }
}
