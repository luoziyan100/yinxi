/**
 * Agent tool - spawn a sub-agent for complex, isolated tasks.
 *
 * The sub-agent gets its own context window, tools, and can work independently.
 * This prevents large research tasks from polluting the main conversation context.
 *
 * Inspired by Claude Code's Agent tool and the sub-agent pattern.
 */

import { Agent } from "../agent.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { createAllTools } from "./index.js";
import type { Tool, ToolResult, AgentConfig } from "../types.js";

export function createAgentTool(cwd: string, parentConfig: AgentConfig): Tool {
  return {
    name: "Agent",
    description:
      "Spawn a sub-agent to handle a complex task independently. The sub-agent gets its own context window and tools.\n\n" +
      "Usage:\n" +
      "- Use for research tasks that may require reading many files.\n" +
      "- Use for tasks that would consume too much context in the main conversation.\n" +
      "- Use for independent sub-tasks that can run in isolation.\n" +
      "- The sub-agent returns a summary of its findings/results.\n\n" +
      "When NOT to use:\n" +
      "- If you need to read a specific file, use Read directly.\n" +
      "- If you are searching for a specific class/function, use Glob or Grep directly.\n" +
      "- If the task is simple and directed (2-3 tool calls), do it yourself.\n\n" +
      "Provide clear, detailed task descriptions so the sub-agent can work autonomously.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "A detailed description of the task for the sub-agent. " +
            "Be specific about what you want it to find, do, or investigate.",
        },
      },
      required: ["task"],
    },

    async execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
      const task = params.task as string;

      if (signal?.aborted) {
        return { content: "Sub-agent aborted.", isError: true };
      }

      try {
        const systemPrompt = await buildSystemPrompt(cwd);
        const tools = createAllTools(cwd);

        // Sub-agent config: same provider, smaller max tokens, no sub-agent tool (prevent recursion)
        const subConfig: AgentConfig = {
          provider: parentConfig.provider,
          model: parentConfig.model,
          maxTokens: parentConfig.maxTokens,
          systemPrompt: systemPrompt + "\n\n# Sub-agent Mode\nYou are running as a sub-agent. Complete the task and provide a clear, concise summary of your findings and actions. Do NOT spawn further sub-agents.",
          tools: tools, // No Agent tool - prevent infinite recursion
          apiKey: parentConfig.apiKey,
          baseUrl: parentConfig.baseUrl,
          cwd,
        };

        const subAgent = new Agent(subConfig);

        // Collect text output from the sub-agent
        let resultText = "";
        subAgent.subscribe((event) => {
          if (event.type === "text_delta") {
            resultText += event.text;
          }
        });

        // Run the sub-agent with a timeout (5 minutes)
        const SUB_AGENT_TIMEOUT = 300_000;
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Sub-agent timed out after 5 minutes")), SUB_AGENT_TIMEOUT)
        );
        await Promise.race([subAgent.prompt(task), timeoutPromise]);

        if (!resultText.trim()) {
          return { content: "Sub-agent completed but produced no text output." };
        }

        // Truncate if too long
        if (resultText.length > 10_000) {
          resultText = resultText.substring(0, 10_000) + "\n\n... [sub-agent output truncated]";
        }

        return { content: resultText };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Sub-agent error: ${message}`, isError: true };
      }
    },
  };
}
