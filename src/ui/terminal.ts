/**
 * Terminal UI - handles rendering agent events to the terminal.
 *
 * Design principles (inspired by Claude Code):
 * - Clean visual hierarchy with box-drawing characters
 * - Animated spinners for async operations
 * - Rich tool call display with context
 * - Streaming text with markdown rendering at completion
 */

import chalk from "chalk";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import type { AgentEvent, ToolResult } from "../types.js";

// ── Markdown Renderer ──

marked.setOptions({
  renderer: new (TerminalRenderer as any)({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100) - 4,
    // Code block styling
    code: chalk.bgGray,
    codespan: chalk.cyan,
    // Headings
    firstHeading: chalk.bold.underline,
    heading: chalk.bold,
    // Links
    href: chalk.blue.underline,
    // Tables
    tableOptions: {
      chars: { mid: "─", "left-mid": "├", "mid-mid": "┼", "right-mid": "┤" },
    },
  }),
});

function renderMarkdown(text: string): string {
  try {
    const rendered = marked(text) as string;
    // Clean up trailing whitespace but keep structure
    return rendered.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  } catch {
    return text;
  }
}

// ── Spinner ──

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let spinnerLabel = "";

function startSpinner(label: string, color: (s: string) => string = chalk.cyan): void {
  stopSpinner();
  spinnerLabel = label;
  spinnerFrame = 0;
  const render = () => {
    const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
    process.stdout.write(`\r  ${color(frame)} ${chalk.dim(spinnerLabel)}`);
    spinnerFrame++;
  };
  render();
  spinnerTimer = setInterval(render, 80);
}

function stopSpinner(finalMessage?: string): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    // Clear the spinner line
    process.stdout.write("\r" + " ".repeat(spinnerLabel.length + 10) + "\r");
    if (finalMessage) {
      process.stdout.write(finalMessage);
    }
  }
}

// ── Constants ──

const COLS = Math.min(process.stdout.columns || 80, 100);

// Tool icons
const TOOL_ICONS: Record<string, string> = {
  Read: "📖",
  Write: "✏️ ",
  Edit: "🔧",
  Bash: "⚡",
  Glob: "🔍",
  Grep: "🔎",
  Fetch: "🌐",
  Agent: "🤖",
};

// Tool display colors
const TOOL_COLORS: Record<string, (s: string) => string> = {
  Read: chalk.blue,
  Write: chalk.green,
  Edit: chalk.yellow,
  Bash: chalk.magenta,
  Glob: chalk.blue,
  Grep: chalk.blue,
  Fetch: chalk.cyan,
  Agent: chalk.magenta,
};

// ── Rendering State ──

let isThinking = false;
let isToolRunning = false;
let currentToolName = "";
let currentToolInput = "";
let textBuffer = "";
let toolStartTime = 0;
let showThinkingText = false;
let quietMode = false;
// Track if we're in the middle of streaming text (for proper newlines)
let streamingText = false;

/**
 * Configure the renderer.
 */
export function configureRenderer(options: { showThinking?: boolean; quiet?: boolean }): void {
  if (options.showThinking !== undefined) showThinkingText = options.showThinking;
  if (options.quiet !== undefined) quietMode = options.quiet;
}

/**
 * Handle an agent event and render it to the terminal.
 */
export function renderEvent(event: AgentEvent): void {
  // In quiet mode, only show text output and errors
  if (quietMode && event.type !== "text_delta" && event.type !== "turn_end" && event.type !== "error") {
    return;
  }

  switch (event.type) {
    case "thinking_delta":
      if (!isThinking) {
        isThinking = true;
        if (showThinkingText) {
          process.stdout.write("\n" + chalk.dim("  ╭─ thinking ─────────────────────────") + "\n");
        } else {
          startSpinner("thinking...", chalk.magenta);
        }
      }
      if (showThinkingText && event.text) {
        // Indent thinking text
        const indented = event.text.replace(/\n/g, "\n" + chalk.dim("  │ "));
        process.stdout.write(chalk.dim("  │ ") + chalk.dim(indented));
      }
      break;

    case "text_delta":
      if (isThinking) {
        isThinking = false;
        if (showThinkingText) {
          process.stdout.write("\n" + chalk.dim("  ╰─────────────────────────────────") + "\n\n");
        } else {
          stopSpinner();
        }
      }
      if (!streamingText) {
        streamingText = true;
        process.stdout.write("\n");
      }
      textBuffer += event.text;
      process.stdout.write(event.text);
      break;

    case "tool_use_start":
      if (isThinking) {
        isThinking = false;
        if (showThinkingText) {
          process.stdout.write("\n" + chalk.dim("  ╰─────────────────────────────────") + "\n");
        } else {
          stopSpinner();
        }
      }
      if (streamingText) {
        streamingText = false;
        process.stdout.write("\n");
        textBuffer = "";
      }
      isToolRunning = true;
      currentToolName = event.name;
      currentToolInput = "";
      toolStartTime = Date.now();

      // Show spinner while tool is executing
      const toolColor = TOOL_COLORS[event.name] || chalk.cyan;
      startSpinner(`${event.name}...`, toolColor);
      break;

    case "tool_use_input_delta":
      currentToolInput += event.text;
      break;

    case "tool_result": {
      isToolRunning = false;
      const elapsed = Date.now() - toolStartTime;
      const elapsedStr = elapsed >= 1000
        ? `${(elapsed / 1000).toFixed(1)}s`
        : `${elapsed}ms`;

      // Stop spinner and render the tool call box
      stopSpinner();
      renderToolCallBox(currentToolName, currentToolInput, event.result, elapsedStr);
      break;
    }

    case "turn_end":
      if (isThinking) {
        isThinking = false;
        stopSpinner();
      }
      if (streamingText) {
        streamingText = false;
        process.stdout.write("\n");
        textBuffer = "";
      }
      if (isToolRunning) {
        isToolRunning = false;
        stopSpinner();
      }
      break;

    case "status":
      stopSpinner();
      process.stdout.write(
        "\n  " + chalk.yellow("●") + " " + chalk.dim.italic(event.message) + "\n"
      );
      break;

    case "error":
      stopSpinner();
      if (streamingText) {
        streamingText = false;
        process.stdout.write("\n");
        textBuffer = "";
      }
      process.stdout.write(
        "\n  " + chalk.red.bold("✕ Error: ") + chalk.red(event.error) + "\n"
      );
      break;
  }
}

// ── Tool Call Box Rendering ──

/**
 * Render a tool call as a visually distinct box.
 *
 * Example output:
 *   ┌ 📖 Read src/foo.ts (0.3s)
 *   │ 42 lines
 *   └
 */
function renderToolCallBox(name: string, rawInput: string, result: ToolResult, elapsed: string): void {
  const icon = TOOL_ICONS[name] || "⚡";
  const color = TOOL_COLORS[name] || chalk.cyan;
  const inputSummary = formatToolInput(name, rawInput);

  // Header line
  let header = `\n  ${chalk.dim("┌")} ${icon} ${chalk.bold(color(name))}`;
  if (inputSummary) {
    header += ` ${chalk.white(inputSummary)}`;
  }
  header += chalk.dim(` (${elapsed})`);
  process.stdout.write(header + "\n");

  // Result body
  if (result.isError) {
    process.stdout.write(
      `  ${chalk.dim("│")} ${chalk.red("✕")} ${chalk.red(truncate(result.content, COLS - 10))}\n`
    );
  } else {
    const resultLines = formatToolResult(name, rawInput, result.content);
    for (const line of resultLines) {
      process.stdout.write(`  ${chalk.dim("│")} ${line}\n`);
    }
  }

  // Footer
  process.stdout.write(`  ${chalk.dim("└")}\n`);
}

/**
 * Format tool input into a readable one-line summary.
 */
function formatToolInput(name: string, rawInput: string): string {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(rawInput || "{}");
  } catch {
    return "";
  }
  switch (name) {
    case "Read":
      return shortenPath(String(input.file_path || ""));
    case "Write":
      return shortenPath(String(input.file_path || ""));
    case "Edit":
      return shortenPath(String(input.file_path || ""));
    case "Bash":
      return truncate(String(input.command || ""), 80);
    case "Glob":
      return truncate(String(input.pattern || ""), 60);
    case "Grep": {
      const pat = String(input.pattern || "");
      const p = input.path ? ` in ${shortenPath(String(input.path))}` : "";
      return truncate(`"${pat}"${p}`, 80);
    }
    case "Fetch":
      return truncate(String(input.url || ""), 80);
    case "Agent":
      return truncate(String(input.task || ""), 80);
    default:
      return truncate(JSON.stringify(input), 60);
  }
}

/**
 * Format tool result into display lines.
 * Returns an array of lines to show inside the tool box.
 */
function formatToolResult(name: string, rawInput: string, content: string): string[] {
  const lines: string[] = [];

  // Tool-specific formatting
  switch (name) {
    case "Read": {
      // Show line count and a snippet
      const contentLines = content.split("\n");
      const headerMatch = content.match(/^\[(\d+ lines|Showing lines [^\]]+)\]/);
      if (headerMatch) {
        lines.push(chalk.green("✓") + " " + chalk.dim(headerMatch[1]));
      } else {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${contentLines.length} lines`));
      }
      break;
    }

    case "Write": {
      // Show success message
      lines.push(chalk.green("✓") + " " + chalk.dim(content));
      break;
    }

    case "Edit": {
      // Show edit result (already contains line info)
      if (content.startsWith("Successfully")) {
        lines.push(chalk.green("✓") + " " + chalk.dim(content.replace("Successfully edited ", "")));
      } else {
        lines.push(chalk.green("✓") + " " + chalk.dim(content));
      }
      break;
    }

    case "Bash": {
      // Show output preview (first few and last few lines)
      const outputLines = content.split("\n");
      if (outputLines.length <= 8) {
        for (const line of outputLines) {
          lines.push(chalk.dim(truncate(line, COLS - 8)));
        }
      } else {
        // Show first 4 and last 2 lines
        for (let i = 0; i < 4; i++) {
          lines.push(chalk.dim(truncate(outputLines[i], COLS - 8)));
        }
        lines.push(chalk.dim(`  ... (${outputLines.length - 6} more lines)`));
        for (let i = outputLines.length - 2; i < outputLines.length; i++) {
          lines.push(chalk.dim(truncate(outputLines[i], COLS - 8)));
        }
      }
      break;
    }

    case "Glob": {
      // Show file count
      const countMatch = content.match(/^(\d+) files? found/);
      if (countMatch) {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${countMatch[1]} files found`));
      } else {
        lines.push(chalk.dim(truncate(content, COLS - 8)));
      }
      break;
    }

    case "Grep": {
      // Show match count
      const matchCountMatch = content.match(/^(\d+) match/);
      if (matchCountMatch) {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${matchCountMatch[1]} matches`));
        // Show first few matches
        const matchLines = content.split("\n").slice(1, 5);
        for (const line of matchLines) {
          lines.push(chalk.dim("  " + truncate(line, COLS - 12)));
        }
        const totalMatches = content.split("\n").length - 1;
        if (totalMatches > 4) {
          lines.push(chalk.dim(`  ... and ${totalMatches - 4} more`));
        }
      } else {
        lines.push(chalk.dim(truncate(content, COLS - 8)));
      }
      break;
    }

    case "Agent": {
      // Show truncated sub-agent result
      const subLines = content.split("\n");
      lines.push(chalk.green("✓") + " " + chalk.dim(`Sub-agent returned ${subLines.length} lines`));
      break;
    }

    case "Fetch": {
      const size = content.length;
      if (size > 1000) {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${(size / 1024).toFixed(1)}KB fetched`));
      } else {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${size} bytes`));
      }
      break;
    }

    default: {
      const resultLines = content.split("\n");
      if (resultLines.length <= 3) {
        for (const line of resultLines) {
          lines.push(chalk.dim(truncate(line, COLS - 8)));
        }
      } else {
        lines.push(chalk.green("✓") + " " + chalk.dim(`${resultLines.length} lines`));
      }
    }
  }

  return lines;
}

// ── Banner and Prompt ──

/**
 * Print the welcome banner.
 */
export function printBanner(model: string, cwd: string): void {
  const logo = `
  ${chalk.bold.cyan("╦ ╦")}${chalk.bold.blue("╦╔╗╔")}${chalk.bold.magenta("═╗ ╦")}${chalk.bold.cyan("╦")}
  ${chalk.bold.cyan("╚╦╝")}${chalk.bold.blue("║║║║")}${chalk.bold.magenta("╔╩╦╝")}${chalk.bold.cyan("║")}
   ${chalk.bold.cyan("╩ ")}${chalk.bold.blue("╩╝╚╝")}${chalk.bold.magenta("╩ ╚═")}${chalk.bold.cyan("╩")}`;

  console.log(logo);
  console.log(chalk.dim("  AI Coding Agent for the Terminal\n"));

  // Info bar
  const modelStr = chalk.white(model);
  const cwdStr = chalk.white(shortenPath(cwd));
  console.log(`  ${chalk.dim("model")} ${modelStr}  ${chalk.dim("cwd")} ${cwdStr}`);
  console.log();

  // Help hint
  console.log(`  ${chalk.dim("Type")} ${chalk.cyan("/help")} ${chalk.dim("for commands,")} ${chalk.cyan("Ctrl+C")} ${chalk.dim("to interrupt")}`);
  console.log(`  ${chalk.dim("End a line with")} ${chalk.cyan("\\")} ${chalk.dim("for multi-line input")}`);
  console.log(chalk.dim("  " + "─".repeat(Math.min(COLS - 4, 60))));
}

/**
 * Print the input prompt.
 */
export function printPrompt(): void {
  process.stdout.write("\n" + chalk.bold.magenta("  ❯ "));
}

// ── Utilities ──

/**
 * Shorten a path for display (replace home dir with ~).
 */
function shortenPath(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + "…";
}
