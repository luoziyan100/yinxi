/**
 * Benchmark harness — sets up isolated workspaces and runs cases.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { Agent } from "../src/agent.js";
import { createAllTools } from "../src/tools/index.js";
import { loadConfig } from "../src/config.js";
import type { AgentConfig, AgentEvent } from "../src/types.js";
import type { BenchmarkCase, CaseResult } from "./types.js";

const BENCHMARK_SYSTEM_PROMPT = `You are a coding assistant being evaluated on a benchmark.
You have access to tools: Read, Write, Edit, Bash, Glob, Grep.
Complete the task precisely. Do not ask questions — just do it.
Working directory: {{CWD}}`;

/**
 * Create an isolated temporary workspace for a test case.
 */
async function createWorkspace(testCase: BenchmarkCase): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `yinxi-bench-${testCase.id}-`));

  // Minimal package.json so npx tsx can resolve imports in verification scripts
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ type: "module" }),
    "utf-8"
  );

  for (const [filePath, content] of Object.entries(testCase.setup)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  return dir;
}

/**
 * Clean up a workspace.
 */
async function cleanWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Run a single benchmark case. Returns the result.
 */
export async function runCase(
  testCase: BenchmarkCase,
  agentConfig: Pick<AgentConfig, "provider" | "model" | "apiKey" | "baseUrl">,
  options?: { verbose?: boolean }
): Promise<CaseResult> {
  const workspace = await createWorkspace(testCase);
  const startTime = Date.now();
  let toolCalls = 0;

  try {
    const systemPrompt = BENCHMARK_SYSTEM_PROMPT.replace("{{CWD}}", workspace);
    const tools = createAllTools(workspace);

    const config: AgentConfig = {
      ...agentConfig,
      maxTokens: 8192,
      systemPrompt,
      tools,
      // Intentionally omit cwd: Agent.prompt() regenerates systemPrompt when
      // cwd is set, which would overwrite our benchmark-specific prompt.
      // Tools already have the workspace path baked in via createAllTools().
    };

    const agent = new Agent(config);

    // Count tool calls
    agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_use_start") {
        toolCalls++;
      }
      if (options?.verbose) {
        if (event.type === "tool_use_start") {
          process.stdout.write(`    [tool] ${event.name}\n`);
        } else if (event.type === "error") {
          process.stdout.write(`    [error] ${event.error}\n`);
        }
      }
    });

    // Run with timeout
    const timeoutMs = testCase.timeoutMs || 120_000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        agent.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs)
    );

    await Promise.race([agent.prompt(testCase.prompt), timeoutPromise]);

    const elapsed = Date.now() - startTime;
    const usage = agent.getUsage();

    // Verify result
    const verification = await testCase.verify(workspace);

    return {
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      difficulty: testCase.difficulty,
      pass: verification.pass,
      reason: verification.reason,
      elapsedMs: elapsed,
      tokens: { input: usage.inputTokens, output: usage.outputTokens },
      toolCalls,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return {
      id: testCase.id,
      name: testCase.name,
      category: testCase.category,
      difficulty: testCase.difficulty,
      pass: false,
      reason: "Agent error",
      elapsedMs: elapsed,
      tokens: { input: 0, output: 0 },
      toolCalls,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await cleanWorkspace(workspace);
  }
}

/**
 * Load agent config from ~/.yinxi/config.json.
 */
export async function loadAgentConfig(): Promise<Pick<AgentConfig, "provider" | "model" | "apiKey" | "baseUrl">> {
  const config = await loadConfig();
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.api_key,
    baseUrl: config.base_url,
  };
}
