#!/usr/bin/env node

/**
 * Yinxi - An AI coding agent for the terminal.
 *
 * Entry point: parses arguments, initializes agent, runs interactive loop.
 */

import * as readline from "readline";
import chalk from "chalk";
import { Agent } from "./agent.js";
import { createAllTools, createAllToolsWithAgent } from "./tools/index.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { renderEvent, printBanner, printPrompt, configureRenderer } from "./ui/terminal.js";
import { loadConfig, setupWizard, switchProvider, listProviders, applyEnvOverrides, CONFIG_FILE } from "./config.js";
import {
  createSession,
  loadSession,
  listSessions,
  findRecentSession,
  cleanupSessions,
} from "./session.js";
import { compactMessages, needsCompaction } from "./compaction.js";
import { undoLast, undoStackSize } from "./undo.js";
import { estimateTokens } from "./context.js";
import { estimateCost, formatCost } from "./cost.js";
import type { Provider } from "./types.js";

// ── Configuration ──

const MAX_TOKENS = 16384;

function parseArgs(): {
  provider?: Provider;
  model?: string;
  cwd: string;
  prompt?: string;
  apiKey?: string;
  baseUrl?: string;
  thinkingBudget?: number;
  setup?: boolean;
  continue?: boolean;
  sessionId?: string;
  showThinking?: boolean;
  quiet?: boolean;
} {
  const args = process.argv.slice(2);
  let provider: Provider | undefined;
  let model: string | undefined;
  let cwd = process.cwd();
  let prompt: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let thinkingBudget: number | undefined;
  let setup = false;
  let continueSession = false;
  let sessionId: string | undefined;
  let showThinking = false;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "setup":
        setup = true;
        break;
      case "--provider":
        provider = args[++i] as Provider;
        break;
      case "--model":
      case "-m":
        model = args[++i];
        break;
      case "--cwd":
      case "-d":
        cwd = args[++i];
        break;
      case "--prompt":
      case "-p":
        prompt = args[++i];
        break;
      case "--api-key":
      case "-k":
        apiKey = args[++i];
        break;
      case "--base-url":
      case "-b":
        baseUrl = args[++i];
        break;
      case "--thinking":
      case "-t":
        thinkingBudget = parseInt(args[++i], 10);
        break;
      case "--continue":
      case "-c":
        continueSession = true;
        break;
      case "--session":
        sessionId = args[++i];
        break;
      case "--show-thinking":
        showThinking = true;
        break;
      case "--quiet":
      case "-q":
        quiet = true;
        break;
      case "--version":
      case "-v":
        console.log("yinxi 0.1.0");
        process.exit(0);
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        // Treat remaining as prompt
        if (!args[i].startsWith("-")) {
          prompt = args.slice(i).join(" ");
          i = args.length;
        }
        break;
    }
  }

  return { provider, model, cwd, prompt, apiKey, baseUrl, thinkingBudget, setup, continue: continueSession, sessionId, showThinking, quiet };
}

function printHelp(): void {
  console.log(`
Yinxi - AI Coding Agent for the Terminal

Usage:
  yinxi [options] [prompt]
  yinxi setup                        # First-time API config

Options:
  --provider <type>        API provider: "responses", "openai", or "anthropic" (default: responses)
  -m, --model <model>      Model to use (default: gpt-4.1)
  -b, --base-url <url>     API base URL (for OpenAI-compatible APIs)
  -d, --cwd <dir>          Working directory (default: current directory)
  -p, --prompt <text>      One-shot prompt (non-interactive)
  -k, --api-key <key>      API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY)
  -t, --thinking <tokens>  Enable extended thinking with token budget
  -c, --continue           Continue the most recent session for this directory
  --session <id>           Resume a specific session by ID
  --show-thinking          Show model's reasoning/thinking output
  -q, --quiet              Quiet mode (only show text output, no tool details)
  -v, --version            Show version
  -h, --help               Show this help message

Environment Variables:
  OPENAI_API_KEY           API key for OpenAI-compatible providers
  OPENAI_BASE_URL          Base URL for OpenAI-compatible providers
  ANTHROPIC_API_KEY        API key for Anthropic
  YINXI_MODEL              Default model to use
  YINXI_PROVIDER           Default provider (openai, responses, anthropic)

Examples:
  yinxi                                          # Interactive mode
  yinxi "fix the bug in main.ts"                 # One-shot mode
  yinxi -m gpt-4.1 -b https://api.example.com   # Custom endpoint
  yinxi --provider anthropic -m claude-sonnet-4-20250514
  echo "explain this code" | yinxi               # Pipe mode
  yinxi -c                                       # Resume last session
`);
}

// ── Main ──

async function main(): Promise<void> {
  const cliArgs = parseArgs();

  // Handle "yinxi setup"
  if (cliArgs.setup) {
    await setupWizard();
    return;
  }

  // Load config: config file → env vars → CLI flags (CLI wins)
  const config = await loadConfig();
  let apiKey = cliArgs.apiKey || config.api_key;
  let baseUrl = cliArgs.baseUrl || config.base_url;
  let model = cliArgs.model || config.model;
  let provider = cliArgs.provider || config.provider;

  // No API key? Run setup wizard
  if (!apiKey) {
    console.log("\n  No API key found. Let's set up Yinxi.\n");
    const newConfig = await setupWizard();
    apiKey = newConfig.api_key;
    baseUrl = newConfig.base_url;
    model = cliArgs.model || newConfig.model;
    provider = cliArgs.provider || newConfig.provider;
  }

  const systemPrompt = await buildSystemPrompt(cliArgs.cwd);

  // Build config first (tools need it for sub-agent creation)
  const baseConfig: import("./types.js").AgentConfig = {
    provider,
    model,
    maxTokens: MAX_TOKENS,
    systemPrompt,
    tools: [], // Will be set below
    apiKey,
    baseUrl,
    thinkingBudget: cliArgs.thinkingBudget,
    cwd: cliArgs.cwd,
  };

  // Top-level agent gets Agent tool; sub-agents created by Agent tool get only basic tools
  const tools = createAllToolsWithAgent(cliArgs.cwd, baseConfig);
  baseConfig.tools = tools;

  const agent = new Agent(baseConfig);

  // Session handling: resume or create new
  let resumedMessages = 0;
  if (cliArgs.sessionId) {
    // Resume specific session
    try {
      const session = await loadSession(cliArgs.sessionId);
      agent.loadMessages(session.messages);
      agent.setSessionId(cliArgs.sessionId);
      resumedMessages = session.messages.length;
    } catch {
      console.error(`  Could not load session: ${cliArgs.sessionId}`);
    }
  } else if (cliArgs.continue) {
    // Continue most recent session for this cwd
    const recentId = await findRecentSession(cliArgs.cwd);
    if (recentId) {
      try {
        const session = await loadSession(recentId);
        agent.loadMessages(session.messages);
        agent.setSessionId(recentId);
        resumedMessages = session.messages.length;
      } catch {
        // Start fresh
      }
    }
  }

  // Clean up old sessions (fire and forget)
  cleanupSessions(50).catch(() => {});

  // Create new session if we don't have one
  if (!agent.getSessionId()) {
    try {
      const sessionId = await createSession(cliArgs.cwd, model);
      agent.setSessionId(sessionId);
    } catch {
      // Session persistence is optional - continue without it
    }
  }

  // Configure renderer
  configureRenderer({
    showThinking: cliArgs.showThinking,
    quiet: cliArgs.quiet,
  });

  // Subscribe to events for real-time rendering
  agent.subscribe(renderEvent);

  // Pipe mode: if stdin is not a TTY, read all input as prompt
  if (!process.stdin.isTTY && !cliArgs.prompt) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();
    if (pipedInput) {
      await agent.prompt(pipedInput);
      console.log();
      return;
    }
  }

  // One-shot mode
  if (cliArgs.prompt) {
    await agent.prompt(cliArgs.prompt);
    console.log();
    return;
  }

  // Interactive mode
  runInteractive(agent, model, cliArgs.cwd, resumedMessages);
}

function runInteractive(agent: Agent, model: string, cwd: string, resumedMessages: number = 0): void {
  const sessionStartTime = Date.now();
  printBanner(model, cwd);
  if (resumedMessages > 0) {
    console.log(chalk.dim(`  Resumed session with ${resumedMessages} messages.\n`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let isRunning = false;

  const showExitSummary = () => {
    const usage = agent.getUsage();
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      const cost = estimateCost(usage, model);
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const total = (usage.inputTokens + usage.outputTokens).toLocaleString();
      const modified = agent.getModifiedFiles();
      const parts = [`${total} tokens`, `~${formatCost(cost)}`, `${mins}m ${secs}s`];
      if (modified.length > 0) {
        parts.push(`${modified.length} file${modified.length > 1 ? "s" : ""} modified`);
      }
      console.log(chalk.dim(`\n  ${parts.join(" · ")}`));
    }
    console.log(chalk.dim("\n  Goodbye!\n"));
  };

  // Ctrl+C handling: interrupt current operation, or exit if idle
  process.on("SIGINT", () => {
    if (isRunning) {
      agent.abort();
      console.log("\n\n  Interrupted.");
      isRunning = false;
      askQuestion();
    } else {
      showExitSummary();
      process.exit(0);
    }
  });

  rl.on("close", () => {
    showExitSummary();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    showExitSummary();
    process.exit(0);
  });

  // Multi-line input: if the first line ends with \, collect lines until a blank line
  const readInput = (): Promise<string> => {
    return new Promise((resolve) => {
      printPrompt();
      rl.once("line", (firstLine: string) => {
        if (!firstLine.endsWith("\\")) {
          resolve(firstLine.trim());
          return;
        }
        // Multi-line mode: collect until blank line
        const lines = [firstLine.slice(0, -1)]; // Remove trailing backslash
        process.stdout.write(chalk.dim("  … "));
        const collectLine = (line: string) => {
          if (line.trim() === "") {
            resolve(lines.join("\n").trim());
            return;
          }
          if (line.endsWith("\\")) {
            lines.push(line.slice(0, -1));
          } else {
            lines.push(line);
          }
          process.stdout.write(chalk.dim("  … "));
          rl.once("line", collectLine);
        };
        rl.once("line", collectLine);
      });
    });
  };

  const askQuestion = (): void => {
    readInput().then(async (trimmed: string) => {
      if (!trimmed) {
        askQuestion();
        return;
      }

      if (
        trimmed.toLowerCase() === "exit" ||
        trimmed.toLowerCase() === "quit"
      ) {
        showExitSummary();
        process.exit(0);
      }

      if (trimmed === "/help") {
        const helpItems = [
          ["/clear", "Clear the screen"],
          ["/reset", "Reset conversation history"],
          ["/compact", "Summarize old messages to free context"],
          ["/undo", "Undo last file modification"],
          ["/diff", "Show git diff summary"],
          ["/commit", "Quick git commit (/commit <msg>)"],
          ["/history", "Show message history"],
          ["/model", "Show or switch model (/model <name>)"],
          ["/usage", "Show token usage and cost"],
          ["/files", "Show files modified this session"],
          ["/sessions", "List saved sessions"],
          ["/provider", "List or switch provider (/provider <name>)"],
          ["/config", "Show all providers and config"],
          ["/help", "Show this help"],
          ["exit", "Quit Yinxi"],
        ];
        console.log();
        console.log(`  ${chalk.bold("Commands")}`);
        console.log(chalk.dim("  " + "─".repeat(44)));
        for (const [cmd, desc] of helpItems) {
          console.log(`  ${chalk.cyan(cmd.padEnd(14))} ${chalk.dim(desc)}`);
        }
        console.log(chalk.dim("  " + "─".repeat(44)));
        console.log(`  ${chalk.cyan("Ctrl+C".padEnd(14))} ${chalk.dim("Interrupt / exit")}`);
        console.log(`  ${chalk.cyan("\\".padEnd(14))} ${chalk.dim("Multi-line input (end line with \\)")}`)
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === "/clear") {
        console.clear();
        printBanner(model, cwd);
        askQuestion();
        return;
      }

      if (trimmed === "/history") {
        const messages = agent.getMessages();
        let totalTokens = 0;
        for (const msg of messages) {
          if (msg.role === "user" && typeof msg.content === "string") {
            totalTokens += estimateTokens(msg.content);
          } else if (msg.role === "assistant") {
            for (const b of msg.content) {
              if ((b as any).text) totalTokens += estimateTokens((b as any).text);
            }
          }
        }
        console.log(`\n  Conversation: ${messages.length} messages (~${totalTokens.toLocaleString()} tokens)\n`);
        // Show last 10 messages with previews
        const recent = messages.slice(-10);
        for (const msg of recent) {
          if (msg.role === "user" && typeof msg.content === "string") {
            const preview = msg.content.length > 80 ? msg.content.substring(0, 80) + "..." : msg.content;
            console.log(chalk.dim("    ") + chalk.green("user") + chalk.dim(": ") + preview);
          } else if (msg.role === "assistant") {
            const textBlocks = msg.content.filter((b: any) => b.type === "text");
            const toolBlocks = msg.content.filter((b: any) => b.type === "tool_use");
            let preview = "";
            if (textBlocks.length > 0) {
              const text = (textBlocks[0] as any).text;
              preview = text.length > 80 ? text.substring(0, 80) + "..." : text;
            }
            if (toolBlocks.length > 0) {
              const toolNames = toolBlocks.map((b: any) => b.name).join(", ");
              preview += preview ? chalk.dim(` [${toolNames}]`) : chalk.dim(`[${toolNames}]`);
            }
            console.log(chalk.dim("    ") + chalk.cyan("assistant") + chalk.dim(": ") + preview);
          } else if (msg.role === "user" && Array.isArray(msg.content)) {
            console.log(chalk.dim("    ") + chalk.yellow("tool_result") + chalk.dim(`: ${msg.content.length} result(s)`));
          }
        }
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === "/reset") {
        agent.clearMessages();
        console.log("\n  Conversation reset.\n");
        askQuestion();
        return;
      }

      if (trimmed === "/model" || trimmed.startsWith("/model ")) {
        // Helper: detect provider from model name
        const detectProvider = (m: string): "anthropic" | "responses" => m.startsWith("claude") ? "anthropic" : "responses";

        // Helper: apply model switch to agent
        const applyModelSwitch = (newModel: string) => {
          model = newModel;
          agent.updateConfig({ model: newModel, provider: detectProvider(newModel) });
        };

        const newModel = trimmed.replace("/model", "").trim();
        if (newModel) {
          applyModelSwitch(newModel);
          console.log(`\n  ${chalk.green("●")} Model → ${chalk.cyan(model)}\n`);
        } else {
          // Interactive model selection
          const providers = await listProviders();
          const activeProvider = providers.find(p => p.active);

          const models = [
            ["gpt-4.1", "OpenAI GPT-4.1"],
            ["gpt-4.1-mini", "OpenAI GPT-4.1 Mini"],
            ["gpt-4.1-nano", "OpenAI GPT-4.1 Nano"],
            ["o4-mini", "OpenAI o4-mini (reasoning)"],
            ["claude-sonnet-4-20250514", "Anthropic Sonnet 4"],
            ["claude-opus-4-6", "Anthropic Opus 4.6"],
            ["deepseek-chat", "DeepSeek V3"],
            ["deepseek-reasoner", "DeepSeek R1"],
          ];

          console.log();
          console.log(`  ${chalk.bold("Current:")} ${chalk.cyan(model)} ${chalk.dim("on")} ${chalk.cyan(activeProvider?.name || "unknown")}`);
          console.log();

          // Provider section
          if (providers.length > 1) {
            console.log(`  ${chalk.bold("Providers")}`);
            console.log(chalk.dim("  " + "─".repeat(44)));
            providers.forEach((p, i) => {
              const marker = p.active ? chalk.green("●") : chalk.dim("○");
              const key = chalk.bold.white(`p${i + 1}`);
              console.log(`  ${key} ${marker} ${chalk.cyan(p.name.padEnd(14))} ${chalk.dim(p.config.base_url || "(default)")}`);
            });
            console.log();
          }

          // Model section
          console.log(`  ${chalk.bold("Models")}`);
          console.log(chalk.dim("  " + "─".repeat(44)));
          models.forEach(([id, desc], i) => {
            const current = id === model ? chalk.green(" ←") : "";
            const key = chalk.bold.white(`${i + 1}`);
            console.log(`  ${key.padStart(3)}  ${chalk.cyan(id.padEnd(28))} ${chalk.dim(desc)}${current}`);
          });
          console.log();
          console.log(chalk.dim("  Enter number, p1/p2 for provider, or model name:"));

          // Wait for interactive input
          const choice = await new Promise<string>((resolve) => {
            process.stdout.write(chalk.bold.magenta("  ❯ "));
            rl.once("line", (line: string) => resolve(line.trim()));
          });

          if (!choice) {
            // Empty = cancel
          } else if (choice.match(/^p\d+$/i)) {
            // Provider switch: p1, p2, etc.
            const idx = parseInt(choice.slice(1), 10) - 1;
            if (idx >= 0 && idx < providers.length) {
              const target = providers[idx];
              const newConfig = await switchProvider(target.name);
              if (newConfig) {
                model = newConfig.model;
                agent.updateConfig({ model: newConfig.model, provider: newConfig.provider, apiKey: newConfig.api_key, baseUrl: newConfig.base_url });
                console.log(`\n  ${chalk.green("●")} Provider → ${chalk.cyan(target.name)}, Model → ${chalk.cyan(model)}\n`);
              }
            } else {
              console.log(chalk.dim(`\n  Invalid choice.\n`));
            }
          } else if (choice.match(/^\d+$/)) {
            // Model number: 1-8
            const idx = parseInt(choice, 10) - 1;
            if (idx >= 0 && idx < models.length) {
              applyModelSwitch(models[idx][0]);
              console.log(`\n  ${chalk.green("●")} Model → ${chalk.cyan(model)}\n`);
            } else {
              console.log(chalk.dim(`\n  Invalid choice.\n`));
            }
          } else {
            // Free text = model name
            applyModelSwitch(choice);
            console.log(`\n  ${chalk.green("●")} Model → ${chalk.cyan(model)}\n`);
          }
        }
        askQuestion();
        return;
      }

      if (trimmed === "/usage") {
        const usage = agent.getUsage();
        const cost = estimateCost(usage, model);
        const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const total = usage.inputTokens + usage.outputTokens;
        console.log();
        console.log(`  ${chalk.bold("Session Usage")}`);
        console.log(chalk.dim("  " + "─".repeat(36)));
        console.log(`  ${chalk.dim("Input")}    ${usage.inputTokens.toLocaleString().padStart(12)} tokens`);
        console.log(`  ${chalk.dim("Output")}   ${usage.outputTokens.toLocaleString().padStart(12)} tokens`);
        console.log(chalk.dim("  " + "─".repeat(36)));
        console.log(`  ${chalk.dim("Total")}    ${total.toLocaleString().padStart(12)} tokens`);
        console.log(`  ${chalk.dim("Cost")}     ${("~" + formatCost(cost)).padStart(13)}`);
        console.log(`  ${chalk.dim("Duration")} ${(mins + "m " + secs + "s").padStart(13)}`);
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === "/compact") {
        const messages = agent.getMessages();
        if (messages.length < 4) {
          console.log("\n  Not enough messages to compact.\n");
        } else {
          console.log(chalk.dim("\n  Compacting conversation..."));
          try {
            // Access agent internals for compaction
            const config = (agent as any).config;
            const sysTokens = estimateTokens(config.systemPrompt);
            const compacted = await compactMessages(config, messages, sysTokens);
            agent.clearMessages();
            (agent as any).messages = compacted;
            console.log(chalk.green(`  ✓ Compacted ${messages.length} → ${compacted.length} messages.\n`));
          } catch (err) {
            console.log(chalk.red(`  ✗ Compaction failed: ${err}\n`));
          }
        }
        askQuestion();
        return;
      }

      if (trimmed.startsWith("/commit")) {
        const commitMsg = trimmed.replace("/commit", "").trim();
        if (!commitMsg) {
          console.log(chalk.dim("\n  Usage: /commit <message>\n"));
        } else {
          try {
            const { execSync } = await import("child_process");
            execSync("git add -A", { cwd, timeout: 10000 });
            const result = execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
              cwd, encoding: "utf-8", timeout: 10000,
            });
            console.log(`\n  ${chalk.green("✓")} ${result.trim()}\n`);
          } catch (err) {
            const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
            console.log(`\n  ${chalk.red("✗")} ${msg}\n`);
          }
        }
        askQuestion();
        return;
      }

      if (trimmed === "/diff") {
        try {
          const { execSync } = await import("child_process");
          const diff = execSync("git diff --stat", { cwd, encoding: "utf-8", timeout: 5000 });
          if (diff.trim()) {
            console.log(`\n${diff}`);
          } else {
            console.log("\n  No uncommitted changes.\n");
          }
        } catch {
          console.log("\n  Not a git repository or git not available.\n");
        }
        askQuestion();
        return;
      }

      if (trimmed === "/undo") {
        if (undoStackSize() === 0) {
          console.log("\n  Nothing to undo.\n");
        } else {
          const result = await undoLast();
          if (result) {
            console.log(`\n  ${chalk.green("✓")} ${result}\n`);
          }
        }
        askQuestion();
        return;
      }

      if (trimmed === "/files") {
        const modified = agent.getModifiedFiles();
        if (modified.length === 0) {
          console.log("\n  No files modified in this session.\n");
        } else {
          console.log(`\n  Files modified this session (${modified.length}):`);
          for (const f of modified) {
            console.log(chalk.dim("    ") + f);
          }
          console.log();
        }
        askQuestion();
        return;
      }

      if (trimmed === "/config") {
        try {
          const providers = await listProviders();
          console.log(`\n  ${chalk.bold("Configuration")} (${CONFIG_FILE})`);
          console.log(chalk.dim("  " + "─".repeat(50)));
          for (const p of providers) {
            const marker = p.active ? chalk.green(" ●") : chalk.dim(" ○");
            const keyPreview = p.config.api_key ? "***" + p.config.api_key.slice(-4) : "(not set)";
            console.log(`${marker} ${chalk.cyan(p.name.padEnd(16))} ${p.config.model.padEnd(20)} ${chalk.dim(keyPreview)}`);
            if (p.config.base_url) {
              console.log(chalk.dim(`                     ${p.config.base_url}`));
            }
          }
          console.log(chalk.dim("  " + "─".repeat(50)));
          console.log(chalk.dim(`  /provider <name> to switch, "yinxi setup" to add\n`));
        } catch {
          console.log("\n  Could not load config.\n");
        }
        askQuestion();
        return;
      }

      if (trimmed === "/provider" || trimmed.startsWith("/provider ")) {
        const targetName = trimmed.replace("/provider", "").trim();
        if (!targetName) {
          // List providers
          const providers = await listProviders();
          if (providers.length === 0) {
            console.log("\n  No providers configured. Run \"yinxi setup\".\n");
          } else {
            console.log();
            for (const p of providers) {
              const marker = p.active ? chalk.green("● ") : chalk.dim("○ ");
              console.log(`  ${marker}${chalk.cyan(p.name)} ${chalk.dim("—")} ${p.config.model} ${chalk.dim(p.config.base_url || "(default)")}`);
            }
            console.log(chalk.dim(`\n  /provider <name> to switch\n`));
          }
        } else {
          const newConfig = await switchProvider(targetName);
          if (!newConfig) {
            const providers = await listProviders();
            const names = providers.map(p => p.name).join(", ");
            console.log(`\n  Provider "${targetName}" not found. Available: ${names}\n`);
          } else {
            // Update agent config
            model = newConfig.model;
            agent.updateConfig({ model: newConfig.model, provider: newConfig.provider, apiKey: newConfig.api_key, baseUrl: newConfig.base_url });
            console.log(`\n  ${chalk.green("●")} Switched to ${chalk.cyan(targetName)}: ${newConfig.model} ${chalk.dim(newConfig.base_url || "(default)")}\n`);
          }
        }
        askQuestion();
        return;
      }

      if (trimmed === "/sessions") {
        try {
          const sessions = await listSessions(10);
          if (sessions.length === 0) {
            console.log("\n  No saved sessions.\n");
          } else {
            console.log("\n  Recent sessions:");
            for (const s of sessions) {
              const date = new Date(s.updatedAt).toLocaleDateString();
              const time = new Date(s.updatedAt).toLocaleTimeString();
              const current = s.id === agent.getSessionId() ? chalk.green(" (current)") : "";
              console.log(
                chalk.dim(`    ${s.id}`) + current +
                chalk.dim(` │ ${s.messageCount} msgs │ ${date} ${time} │ `) +
                chalk.dim(s.cwd)
              );
            }
            console.log(chalk.dim("\n  Resume with: yinxi --session <id>\n"));
          }
        } catch {
          console.log("\n  Could not list sessions.\n");
        }
        askQuestion();
        return;
      }

      isRunning = true;
      try {
        await agent.prompt(trimmed);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Already handled by SIGINT
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\n  Error: ${msg}\n`);
        }
      }
      isRunning = false;

      console.log(); // Blank line after response
      askQuestion();
    });
  };

  askQuestion();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
