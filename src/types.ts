/**
 * Core type definitions for the Yinxi agent.
 */

// ── Tool System ──

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface ToolSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolSchema;
  execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

// ── Messages ──

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
}

export type AssistantContent = TextBlock | ThinkingBlock | ToolUseBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultMessage {
  role: "user";
  content: ToolResultBlock[];
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ── Agent Events (for streaming UI) ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input_delta"; text: string }
  | { type: "tool_result"; id: string; name: string; result: ToolResult }
  | { type: "turn_end"; stopReason: string; usage?: TokenUsage }
  | { type: "error"; error: string }
  | { type: "status"; message: string };

// ── Agent Config ──

export type Provider = "anthropic" | "openai" | "responses";

export interface AgentConfig {
  provider: Provider;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  tools: Tool[];
  apiKey?: string;
  baseUrl?: string;
  thinkingBudget?: number;
  temperature?: number;
  cwd?: string;
}
