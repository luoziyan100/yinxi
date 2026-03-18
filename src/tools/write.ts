/**
 * Write tool - creates or overwrites files.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { saveSnapshot } from "../undo.js";
import type { Tool, ToolResult } from "../types.js";

export function createWriteTool(cwd: string): Tool {
  return {
    name: "Write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, or overwrites if it does.\n\n" +
      "Usage:\n" +
      "- This tool will overwrite the existing file. You MUST use Read first to read an existing file's contents.\n" +
      "- ALWAYS prefer Edit for modifying existing files — it only sends the diff. Use Write only for new files or complete rewrites.\n" +
      "- NEVER create documentation files (*.md, README) unless explicitly requested.\n" +
      "- Automatically creates parent directories as needed.\n" +
      "- Do not write files that contain secrets (.env, credentials, API keys).",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to write.",
        },
        content: {
          type: "string",
          description: "The full content to write to the file.",
        },
      },
      required: ["file_path", "content"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      let filePath = params.file_path as string;
      const content = params.content as string;

      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(cwd, filePath);
      }

      // Security: prevent writing outside project directory
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(cwd) && !resolved.startsWith(process.env.HOME || "/")) {
        return {
          content: `Error: Cannot write to ${filePath} — path is outside the project and home directory.`,
          isError: true,
        };
      }

      // Save snapshot for undo
      await saveSnapshot(filePath).catch(() => {});

      try {
        // Check if file already exists
        let existed = false;
        let oldLines = 0;
        try {
          const oldContent = await fs.readFile(filePath, "utf-8");
          existed = true;
          oldLines = oldContent.split("\n").length;
        } catch {
          // File doesn't exist, will create
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");

        const lines = content.split("\n").length;
        if (existed) {
          return {
            content: `Successfully overwrote ${filePath} (${oldLines} → ${lines} lines)`,
          };
        }
        return {
          content: `Successfully created ${filePath} (${lines} lines)`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error writing file: ${message}`, isError: true };
      }
    },
  };
}
