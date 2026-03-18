/**
 * Grep tool - search file contents with regex.
 */

import { exec } from "child_process";
import * as path from "path";
import type { Tool, ToolResult } from "../types.js";

export function createGrepTool(cwd: string): Tool {
  return {
    name: "Grep",
    description:
      "Search file contents using ripgrep (rg). Supports full regex syntax.\n\n" +
      "Usage:\n" +
      "- ALWAYS use Grep for content search tasks. NEVER invoke grep or rg via Bash.\n" +
      '- Supports full regex (e.g., "log.*Error", "function\\\\s+\\\\w+").\n' +
      "- Filter files with the glob parameter (e.g., \"*.ts\", \"*.{js,jsx}\").\n" +
      "- Returns matching lines with file paths and line numbers.\n" +
      "- For open-ended searches requiring multiple rounds, use Agent instead.\n" +
      "- Falls back to grep if ripgrep is not installed.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for.",
        },
        path: {
          type: "string",
          description:
            "File or directory to search in. Defaults to project root.",
        },
        glob: {
          type: "string",
          description:
            'Glob pattern to filter files, e.g. "*.ts", "*.{js,jsx}".',
        },
        case_insensitive: {
          type: "boolean",
          description: "Case insensitive search. Default: false.",
        },
        context: {
          type: "number",
          description: "Number of context lines before and after each match.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matching lines. Default: 100.",
        },
      },
      required: ["pattern"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || cwd;
      const fileGlob = params.glob as string | undefined;
      const caseInsensitive = params.case_insensitive as boolean;
      const context = params.context as number | undefined;
      const maxResults = (params.max_results as number) || 100;

      const resolvedPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(cwd, searchPath);

      // Build rg command with proper escaping
      const args: string[] = ["rg", "--no-heading", "-n", "--color=never"];

      if (caseInsensitive) args.push("-i");
      if (context) args.push(`-C`, `${context}`);
      if (fileGlob) args.push(`--glob`, fileGlob);
      args.push(`--max-count`, `${maxResults}`);
      args.push("--", pattern, resolvedPath);

      const command = args.map(a => a.includes(" ") ? `'${a}'` : a).join(" ");

      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd,
            timeout: 30_000,
            maxBuffer: 5 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error && !stdout) {
              // rg exits with 1 when no matches found
              if (error.code === 1) {
                resolve({ content: "No matches found." });
                return;
              }
              // Try falling back to grep if rg is not installed
              const fallbackCmd = `grep -rn ${caseInsensitive ? "-i" : ""} ${JSON.stringify(pattern)} ${JSON.stringify(resolvedPath)} | head -${maxResults}`;
              exec(
                fallbackCmd,
                { cwd, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
                (err2, stdout2) => {
                  if (err2 && !stdout2) {
                    resolve({
                      content: "No matches found.",
                    });
                    return;
                  }
                  resolve({ content: stdout2.trim() || "No matches found." });
                }
              );
              return;
            }

            const output = stdout.trim();
            if (!output) {
              resolve({ content: "No matches found." });
              return;
            }
            const matchCount = output.split("\n").length;
            resolve({
              content: `${matchCount} match${matchCount !== 1 ? "es" : ""}:\n${output}`,
            });
          }
        );
      });
    },
  };
}
