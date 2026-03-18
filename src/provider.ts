/**
 * LLM Provider - supports both Anthropic and OpenAI-compatible APIs.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  AgentConfig,
  AgentEvent,
  Message,
  Tool,
  AssistantContent,
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
} from "./types.js";

// ── Anthropic Provider ──

function toolsToAnthropicFormat(tools: Tool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

function messagesToAnthropicFormat(
  messages: Message[]
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "user" && typeof msg.content === "string") {
      return { role: "user" as const, content: msg.content };
    }
    if (msg.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "thinking") {
          // Include thinking blocks for extended thinking API
          content.push({
            type: "thinking" as any,
            thinking: block.thinking,
          } as any);
        } else if (block.type === "tool_use") {
          content.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return { role: "assistant" as const, content };
    }
    // ToolResultMessage
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const content: Anthropic.ToolResultBlockParam[] = msg.content.map(
        (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        })
      );
      return { role: "user" as const, content };
    }
    return { role: "user" as const, content: String(msg.content) };
  });
}

async function* streamAnthropic(
  config: AgentConfig,
  messages: Message[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const anthropicMessages = messagesToAnthropicFormat(messages);
  const anthropicTools = toolsToAnthropicFormat(config.tools);

  const streamParams: Anthropic.MessageCreateParamsStreaming = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: [
      {
        type: "text" as const,
        text: config.systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ] as any,
    messages: anthropicMessages,
    stream: true as const,
    tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    ...(config.temperature !== undefined && { temperature: config.temperature }),
  };

  // Add extended thinking if configured
  if (config.thinkingBudget && config.thinkingBudget > 0) {
    (streamParams as any).thinking = {
      type: "enabled",
      budget_tokens: config.thinkingBudget,
    };
    // When thinking is enabled, max_tokens must be larger
    streamParams.max_tokens = Math.max(config.maxTokens, config.thinkingBudget + 4096);
  }

  let inputTokensFromStart = 0;

  try {
    const stream = client.messages.stream(streamParams);

    // Abort handling: when signal fires, abort the stream
    if (signal) {
      signal.addEventListener("abort", () => stream.abort(), { once: true });
    }

    for await (const event of stream) {
      if (signal?.aborted) return;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          yield { type: "tool_use_start", id: block.id, name: block.name };
        } else if ((block as any).type === "thinking") {
          yield { type: "thinking_delta", text: "" };
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text_delta", text: delta.text };
        } else if (delta.type === "input_json_delta") {
          yield { type: "tool_use_input_delta", text: delta.partial_json };
        } else if ((delta as any).type === "thinking_delta") {
          yield {
            type: "thinking_delta",
            text: (delta as any).thinking || "",
          };
        }
      } else if (event.type === "message_delta") {
        const usage = (event as any).usage;
        yield {
          type: "turn_end",
          stopReason: event.delta.stop_reason || "end_turn",
          usage: {
            inputTokens: inputTokensFromStart + (usage?.input_tokens || 0),
            outputTokens: usage?.output_tokens || 0,
          },
        };
      } else if (event.type === "message_start") {
        // Capture input tokens from message_start
        const usage = (event as any).message?.usage;
        if (usage) {
          inputTokensFromStart = usage.input_tokens || 0;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    yield { type: "error", error: formatApiError(err) };
  }
}

// ── OpenAI-Compatible Provider ──

// Use plain objects to avoid SDK type issues across versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;

function toolsToOpenAIFormat(tools: Tool[]): AnyTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function messagesToOpenAIFormat(
  messages: Message[],
  systemPrompt: string
): AnyMessage[] {
  const result: AnyMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const toolCalls: AnyMessage[] = [];
      let textContent = "";

      for (const block of msg.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      const assistantMsg: AnyMessage = {
        role: "assistant",
        content: textContent || null,
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      result.push(assistantMsg);
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      // Tool results
      for (const block of msg.content) {
        result.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.content,
        });
      }
    }
  }

  return result;
}

async function* streamOpenAI(
  config: AgentConfig,
  messages: Message[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  const openaiMessages = messagesToOpenAIFormat(messages, config.systemPrompt);
  const openaiTools = toolsToOpenAIFormat(config.tools);

  try {
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      max_tokens: config.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...(config.temperature !== undefined && { temperature: config.temperature }),
    });

    // Track tool calls being built up
    const toolCallBuilders = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of stream) {
      if (signal?.aborted) return;

      const delta = chunk.choices?.[0]?.delta;
      const finishReason = chunk.choices?.[0]?.finish_reason;

      if (!delta && !finishReason) continue;

      // Text content
      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }

      // Tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;

          if (!toolCallBuilders.has(idx)) {
            // New tool call starting
            toolCallBuilders.set(idx, {
              id: tc.id || `call_${idx}_${Date.now()}`,
              name: tc.function?.name || "",
              arguments: "",
            });
            if (tc.function?.name) {
              yield {
                type: "tool_use_start",
                id: toolCallBuilders.get(idx)!.id,
                name: tc.function.name,
              };
            }
          }

          const builder = toolCallBuilders.get(idx)!;
          if (tc.function?.name && !builder.name) {
            builder.name = tc.function.name;
            yield {
              type: "tool_use_start",
              id: builder.id,
              name: builder.name,
            };
          }
          if (tc.function?.arguments) {
            builder.arguments += tc.function.arguments;
            yield {
              type: "tool_use_input_delta",
              text: tc.function.arguments,
            };
          }
        }
      }

      // Finish
      if (finishReason) {
        const chunkUsage = (chunk as any).usage;
        yield {
          type: "turn_end",
          stopReason:
            finishReason === "tool_calls" ? "tool_use" : finishReason,
          usage: chunkUsage
            ? {
                inputTokens: chunkUsage.prompt_tokens || 0,
                outputTokens: chunkUsage.completion_tokens || 0,
              }
            : undefined,
        };
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    yield { type: "error", error: formatApiError(err) };
  }
}

// ── OpenAI Responses API Provider ──

function toolsToResponsesFormat(tools: Tool[]): AnyTool[] {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Convert our universal message format to Responses API input format.
 * Responses API uses a flat list of items, not role-based messages.
 */
function messagesToResponsesFormat(messages: Message[]): AnyMessage[] {
  const result: AnyMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      // Collect text and tool calls from assistant
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          result.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: block.text }],
          });
        } else if (block.type === "tool_use") {
          result.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      // Tool results → function_call_output
      for (const block of msg.content) {
        result.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: block.content,
        });
      }
    }
  }

  return result;
}

async function* streamResponses(
  config: AgentConfig,
  messages: Message[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  const input = messagesToResponsesFormat(messages);
  const tools = toolsToResponsesFormat(config.tools);

  try {
    const stream = await (client.responses as any).create({
      model: config.model,
      instructions: config.systemPrompt,
      input,
      tools: tools.length > 0 ? tools : undefined,
      max_output_tokens: config.maxTokens,
      stream: true,
    });

    // Track function calls being built
    const fnCallBuilders = new Map<
      string,
      { id: string; name: string; arguments: string }
    >();

    for await (const event of stream) {
      if (signal?.aborted) return;

      const etype = event.type as string;

      // Text deltas
      if (etype === "response.output_text.delta") {
        yield { type: "text_delta", text: (event as any).delta };
      }

      // Function call start
      if (etype === "response.function_call_arguments.start") {
        // Not all providers emit this; handle in delta
      }

      // Function call argument deltas
      if (etype === "response.function_call_arguments.delta") {
        const itemId = (event as any).item_id || "";
        if (!fnCallBuilders.has(itemId)) {
          // We may have missed the start, create builder
          fnCallBuilders.set(itemId, { id: itemId, name: "", arguments: "" });
        }
        const builder = fnCallBuilders.get(itemId)!;
        builder.arguments += (event as any).delta || "";
        yield { type: "tool_use_input_delta", text: (event as any).delta || "" };
      }

      // Output item added (function_call or message)
      if (etype === "response.output_item.added") {
        const item = (event as any).item;
        if (item?.type === "function_call") {
          const callId = item.call_id || item.id || `call_${Date.now()}`;
          const name = item.name || "";
          fnCallBuilders.set(item.id || callId, {
            id: callId,
            name,
            arguments: "",
          });
          if (name) {
            yield { type: "tool_use_start", id: callId, name };
          }
        }
      }

      // Output item done — finalize function call
      if (etype === "response.output_item.done") {
        const item = (event as any).item;
        if (item?.type === "function_call") {
          const callId = item.call_id || item.id;
          const builder = fnCallBuilders.get(item.id);
          if (builder && !builder.name && item.name) {
            builder.name = item.name;
            yield { type: "tool_use_start", id: callId, name: item.name };
          }
          // Ensure we have full arguments
          if (builder && item.arguments) {
            builder.arguments = item.arguments;
          }
        }
      }

      // Response completed
      if (etype === "response.completed") {
        const response = (event as any).response;
        const usage = response?.usage;
        yield {
          type: "turn_end",
          stopReason: response?.status === "completed" ? "end_turn" : "tool_use",
          usage: usage
            ? {
                inputTokens: usage.input_tokens || 0,
                outputTokens: usage.output_tokens || 0,
              }
            : undefined,
        };
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    yield { type: "error", error: formatApiError(err) };
  }
}

// ── Retry Logic ──

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  // Rate limit, server errors, overloaded
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  if (msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
  if (msg.includes("overloaded") || msg.includes("capacity")) return true;
  if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("econnrefused")) return true;
  if (msg.includes("network") || msg.includes("socket hang up")) return true;
  // Check status code on API errors
  if ("status" in error) {
    const status = (error as any).status;
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) return true;
  }
  return false;
}

/**
 * Format a user-friendly error message for common API failures.
 */
function formatApiError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message;
  if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("invalid_api_key")) {
    return "Invalid API key. Run 'yinxi setup' to reconfigure.";
  }
  if (msg.includes("403") || msg.includes("Forbidden")) {
    return "API access denied. Check your API key permissions.";
  }
  if (msg.includes("404") || msg.includes("model_not_found")) {
    return `Model not found. Check that the model name is correct.`;
  }
  if (msg.includes("ECONNREFUSED")) {
    return "Cannot connect to API server. Check your network and base URL.";
  }
  return msg;
}

function getRetryDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  // Add jitter (±25%)
  return delay * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// ── Public API ──

/**
 * Stream a response from the LLM, yielding AgentEvents.
 * Automatically selects the right provider based on config.provider.
 * Retries on transient errors with exponential backoff.
 */
export async function* streamResponse(
  config: AgentConfig,
  messages: Message[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return;

    const events: AgentEvent[] = [];
    let hadError = false;
    let retryableError: unknown = null;

    const innerStream = config.provider === "anthropic"
      ? streamAnthropic(config, messages, signal)
      : config.provider === "responses"
        ? streamResponses(config, messages, signal)
        : streamOpenAI(config, messages, signal);

    try {
      for await (const event of innerStream) {
        if (event.type === "error") {
          // Check if this error is retryable
          const err = new Error(event.error);
          if (attempt < MAX_RETRIES && isRetryableError(err)) {
            hadError = true;
            retryableError = err;
            break;
          }
        }
        yield event;
        events.push(event);
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        hadError = true;
        retryableError = err;
      } else {
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
        return;
      }
    }

    if (!hadError) return;

    // Retry with backoff
    const delay = getRetryDelay(attempt);
    const retryMsg = `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`;
    yield { type: "error", error: `${(retryableError as Error).message}. ${retryMsg}` };
    await sleep(delay, signal);
  }
}

/**
 * Parse streamed events into structured AssistantContent blocks.
 */
export function parseStreamedContent(
  events: AgentEvent[]
): AssistantContent[] {
  const blocks: AssistantContent[] = [];
  let currentText = "";
  let currentThinking = "";
  let currentToolId = "";
  let currentToolName = "";
  let currentToolInput = "";

  for (const event of events) {
    switch (event.type) {
      case "text_delta":
        currentText += event.text;
        break;
      case "thinking_delta":
        currentThinking += event.text;
        break;
      case "tool_use_start":
        // Flush accumulated text
        if (currentText) {
          blocks.push({ type: "text", text: currentText } as TextBlock);
          currentText = "";
        }
        if (currentThinking) {
          blocks.push({
            type: "thinking",
            thinking: currentThinking,
          } as ThinkingBlock);
          currentThinking = "";
        }
        // Flush previous tool if any
        if (currentToolId) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(currentToolInput || "{}");
          } catch {
            /* empty */
          }
          blocks.push({
            type: "tool_use",
            id: currentToolId,
            name: currentToolName,
            input: parsedInput,
          } as ToolUseBlock);
        }
        currentToolId = event.id;
        currentToolName = event.name;
        currentToolInput = "";
        break;
      case "tool_use_input_delta":
        currentToolInput += event.text;
        break;
      case "turn_end":
        // Flush everything
        if (currentThinking) {
          blocks.push({
            type: "thinking",
            thinking: currentThinking,
          } as ThinkingBlock);
          currentThinking = "";
        }
        if (currentText) {
          blocks.push({ type: "text", text: currentText } as TextBlock);
          currentText = "";
        }
        if (currentToolId) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(currentToolInput || "{}");
          } catch {
            /* empty */
          }
          blocks.push({
            type: "tool_use",
            id: currentToolId,
            name: currentToolName,
            input: parsedInput,
          } as ToolUseBlock);
          currentToolId = "";
          currentToolName = "";
          currentToolInput = "";
        }
        break;
      default:
        break;
    }
  }

  // Final flush
  if (currentThinking) {
    blocks.push({
      type: "thinking",
      thinking: currentThinking,
    } as ThinkingBlock);
  }
  if (currentText) {
    blocks.push({ type: "text", text: currentText } as TextBlock);
  }
  if (currentToolId) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(currentToolInput || "{}");
    } catch {
      /* empty */
    }
    blocks.push({
      type: "tool_use",
      id: currentToolId,
      name: currentToolName,
      input: parsedInput,
    } as ToolUseBlock);
  }

  return blocks;
}
