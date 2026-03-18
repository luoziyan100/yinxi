/**
 * Bash tool - executes shell commands with permission checks for dangerous operations.
 */

import { spawn } from "child_process";
import { isDangerousCommand, askPermission } from "../permissions.js";
import type { Tool, ToolResult } from "../types.js";

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_TIMEOUT = 600_000; // 10 minutes
const MAX_OUTPUT = 100_000; // 100KB output limit

/**
 * Kill a process and all its children.
 */
function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
}

/**
 * Strip ANSI escape codes from output.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export function createBashTool(cwd: string): Tool {
  return {
    name: "Bash",
    description:
      "Execute a shell command and return its output (stdout + stderr combined). " +
      "Default timeout: 2 minutes (max 10 minutes).\n\n" +
      "IMPORTANT: Do NOT use Bash when a dedicated tool can accomplish the task:\n" +
      "- To read files: use Read (NOT cat/head/tail)\n" +
      "- To edit files: use Edit (NOT sed/awk)\n" +
      "- To create files: use Write (NOT echo/cat heredoc)\n" +
      "- To find files: use Glob (NOT find/ls)\n" +
      "- To search content: use Grep (NOT grep/rg)\n\n" +
      "Use Bash for: running builds, tests, git commands, package installation, and system operations.\n" +
      "Do NOT use for interactive commands (vim, less, git rebase -i).\n" +
      "Always quote file paths with spaces. Prefer absolute paths.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute.",
        },
        timeout: {
          type: "number",
          description:
            "Optional timeout in milliseconds (max 600000). Default: 120000.",
        },
      },
      required: ["command"],
    },

    async execute(params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
      const command = params.command as string;
      if (!command || typeof command !== "string") {
        return { content: "Error: 'command' parameter is required and must be a string.", isError: true };
      }
      const timeout = Math.min(
        (params.timeout as number) || DEFAULT_TIMEOUT,
        MAX_TIMEOUT
      );

      // Check for dangerous commands
      if (isDangerousCommand(command)) {
        const allowed = await askPermission(
          `Dangerous command: ${command}`
        );
        if (!allowed) {
          return {
            content: "Command denied by user.",
            isError: true,
          };
        }
      }

      if (signal?.aborted) {
        return { content: "Command aborted.", isError: true };
      }

      return new Promise((resolve) => {
        let output = "";
        let killed = false;

        const child = spawn("/bin/zsh", ["-c", command], {
          cwd,
          detached: true, // Create process group for clean kill
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, TERM: "dumb" },
        });

        // Abort signal: kill the process when agent is interrupted
        const onAbort = () => {
          killed = true;
          killProcessTree(child.pid);
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const timeoutId = setTimeout(() => {
          killed = true;
          killProcessTree(child.pid);
        }, timeout);

        const onData = (chunk: Buffer) => {
          const text = stripAnsi(chunk.toString("utf-8"));
          if (output.length < MAX_OUTPUT) {
            output += text;
          }
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("close", (code) => {
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);

          if (output.length > MAX_OUTPUT) {
            output = output.substring(0, MAX_OUTPUT) + "\n... [output truncated]";
          }

          if (killed) {
            output = (output || "") + "\n[Command timed out after " + (timeout / 1000) + "s]";
          }

          if (!output.trim()) {
            output = "(no output)";
          }

          resolve({
            content: output.trim(),
            isError: killed || (code !== null && code !== 0),
          });
        });

        child.on("error", (err) => {
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            content: `Command failed: ${err.message}`,
            isError: true,
          });
        });
      });
    },
  };
}
