/**
 * Read tool - reads file contents with optional line range.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult } from "../types.js";

export function createReadTool(cwd: string): Tool {
  return {
    name: "Read",
    description:
      "Read the contents of a file. Returns content with line numbers.\n\n" +
      "Usage:\n" +
      "- The file_path must be an absolute path, not relative.\n" +
      "- By default reads up to 2000 lines. Use offset and limit for large files.\n" +
      "- You MUST read a file before editing it with Edit or overwriting with Write.\n" +
      "- This tool can only read files, not directories. Use Glob or Bash 'ls' for directories.\n" +
      "- When you need to read multiple files and they are independent, read them all in parallel.\n" +
      "- Detects binary files and files containing secrets (.env, credentials).",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description:
            "Absolute path to the file to read. Must be an absolute path, not relative.",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of lines to read. Defaults to 2000. Optional.",
        },
      },
      required: ["file_path"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      let filePath = params.file_path as string;
      if (!filePath || typeof filePath !== "string") {
        return { content: "Error: 'file_path' parameter is required.", isError: true };
      }
      const offset = (params.offset as number) || 1;
      const limit = (params.limit as number) || 2000;

      // Resolve relative paths
      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(cwd, filePath);
      }

      // Warn about potential secret files
      const basename = path.basename(filePath);
      if (basename.startsWith(".env") || basename === "credentials.json" || basename === ".secrets") {
        return {
          content: `Warning: ${filePath} may contain secrets. Reading this file could expose sensitive information to the LLM. Use Bash to inspect it locally if needed.`,
          isError: true,
        };
      }

      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          return {
            content: `Error: ${filePath} is a directory, not a file. Use Glob to find files or Bash with 'ls' to list directory contents.`,
            isError: true,
          };
        }

        // Check file size - warn if very large
        if (stat.size > 5 * 1024 * 1024) {
          return {
            content: `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset and limit to read a portion.`,
            isError: true,
          };
        }

        // Detect binary files by reading first 8KB
        const buf = Buffer.alloc(Math.min(8192, stat.size));
        const fh = await fs.open(filePath, "r");
        try {
          await fh.read(buf, 0, buf.length, 0);
        } finally {
          await fh.close();
        }
        const hasNull = buf.includes(0);
        if (hasNull) {
          return {
            content: `Error: ${filePath} appears to be a binary file. Cannot display binary content.`,
            isError: true,
          };
        }

        const raw = await fs.readFile(filePath, "utf-8");
        const lines = raw.split("\n");
        const startIdx = Math.max(0, offset - 1);
        const endIdx = Math.min(lines.length, startIdx + limit);
        const selectedLines = lines.slice(startIdx, endIdx);

        // Format with line numbers (cat -n style)
        const formatted = selectedLines
          .map((line, i) => {
            const lineNum = startIdx + i + 1;
            const numStr = String(lineNum).padStart(6, " ");
            // Truncate long lines
            const truncated =
              line.length > 2000 ? line.substring(0, 2000) + "..." : line;
            return `${numStr}\t${truncated}`;
          })
          .join("\n");

        let header = "";
        if (startIdx > 0 || endIdx < lines.length) {
          header = `[Showing lines ${startIdx + 1}-${endIdx} of ${lines.length} total]\n`;
        } else {
          header = `[${lines.length} lines]\n`;
        }

        return { content: header + formatted };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error reading file: ${message}`, isError: true };
      }
    },
  };
}
