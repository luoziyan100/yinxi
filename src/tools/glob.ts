/**
 * Glob tool - find files by pattern.
 */

import { glob } from "glob";
import * as path from "path";
import type { Tool, ToolResult } from "../types.js";

export function createGlobTool(cwd: string): Tool {
  return {
    name: "Glob",
    description:
      "Fast file pattern matching tool that works with any codebase size.\n\n" +
      "Usage:\n" +
      '- Supports glob patterns like "**/*.ts", "src/**/*.js", "*.py".\n' +
      "- Returns matching file paths sorted by name.\n" +
      "- Use this tool when you need to find files by name patterns.\n" +
      "- For open-ended searches that may require multiple rounds, use Agent instead.\n" +
      "- You can make multiple Glob calls in parallel to search different patterns simultaneously.\n" +
      "- Use this instead of 'find' or 'ls' via Bash.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            'The glob pattern to match files against, e.g. "**/*.ts".',
        },
        path: {
          type: "string",
          description:
            "The directory to search in. Defaults to the project root.",
        },
      },
      required: ["pattern"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || cwd;
      const resolvedPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(cwd, searchPath);

      try {
        const matches = await glob(pattern, {
          cwd: resolvedPath,
          nodir: false,
          dot: false,
          ignore: [
            "**/node_modules/**",
            "**/.git/**",
            "**/dist/**",
            "**/build/**",
            "**/.env*",
            "**/.venv/**",
            "**/venv/**",
            "**/__pycache__/**",
            "**/.cache/**",
          ],
        });

        if (matches.length === 0) {
          return { content: "No files found matching the pattern." };
        }

        // Return paths relative to search dir, limited to 200 results
        const limited = matches.slice(0, 200);
        const result = limited
          .map((m) => path.join(resolvedPath, m))
          .join("\n");

        let output = `${matches.length} file${matches.length !== 1 ? "s" : ""} found:\n${result}`;
        if (matches.length > 200) {
          output += `\n\n... and ${matches.length - 200} more files`;
        }

        return { content: output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error: ${message}`, isError: true };
      }
    },
  };
}
