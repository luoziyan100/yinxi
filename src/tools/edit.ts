/**
 * Edit tool - performs exact string replacements in files.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { saveSnapshot } from "../undo.js";
import type { Tool, ToolResult } from "../types.js";

export function createEditTool(cwd: string): Tool {
  return {
    name: "Edit",
    description:
      "Perform exact string replacements in files.\n\n" +
      "Usage:\n" +
      "- You MUST use Read at least once before editing a file. This tool will fail if old_string is not found.\n" +
      "- Preserve exact indentation (tabs/spaces) as shown in the Read output. The line number prefix is NOT part of the file content.\n" +
      "- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.\n" +
      "- The edit will FAIL if old_string is not unique. Provide more surrounding context to make it unique, or use replace_all.\n" +
      "- Use replace_all for renaming variables or strings across the file.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to edit.",
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace.",
        },
        new_string: {
          type: "string",
          description: "The text to replace old_string with.",
        },
        replace_all: {
          type: "boolean",
          description:
            "If true, replace all occurrences. Default: false (only replace first unique match).",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      let filePath = params.file_path as string;
      const oldString = params.old_string as string;
      const newString = params.new_string as string;
      const replaceAll = (params.replace_all as boolean) || false;

      if (!path.isAbsolute(filePath)) {
        filePath = path.resolve(cwd, filePath);
      }

      try {
        const content = await fs.readFile(filePath, "utf-8");

        if (oldString === newString) {
          return {
            content: "Error: old_string and new_string are identical.",
            isError: true,
          };
        }

        if (!content.includes(oldString)) {
          return {
            content: `Error: old_string not found in ${filePath}. Make sure the string matches exactly, including whitespace and indentation.`,
            isError: true,
          };
        }

        if (!replaceAll) {
          // Check uniqueness
          const firstIdx = content.indexOf(oldString);
          const secondIdx = content.indexOf(oldString, firstIdx + 1);
          if (secondIdx !== -1) {
            const count = content.split(oldString).length - 1;
            return {
              content: `Error: old_string appears ${count} times in the file. Provide more context to make it unique, or use replace_all: true.`,
              isError: true,
            };
          }
        }

        // Save snapshot for undo (only after validation passes)
        await saveSnapshot(filePath).catch(() => {});

        let newContent: string;
        if (replaceAll) {
          newContent = content.split(oldString).join(newString);
        } else {
          newContent = content.replace(oldString, newString);
        }

        await fs.writeFile(filePath, newContent, "utf-8");

        // Report what changed
        const replacements = replaceAll
          ? content.split(oldString).length - 1
          : 1;
        const oldLineCount = oldString.split("\n").length;
        const newLineCount = newString.split("\n").length;
        const delta = newLineCount - oldLineCount;
        const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";

        // Show snippet of the change location
        const editIdx = newContent.indexOf(newString);
        const lineNum = newContent.substring(0, editIdx).split("\n").length;

        return {
          content: `Successfully edited ${filePath}:${lineNum} (${replacements} replacement${replacements > 1 ? "s" : ""}, ${deltaStr} lines)`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error editing file: ${message}`, isError: true };
      }
    },
  };
}
