/**
 * Project file support - reads YINXI.md from the project root.
 * Similar to Claude Code's CLAUDE.md, lets users define project-level rules and context.
 */

import * as fs from "fs/promises";
import * as path from "path";

const PROJECT_FILE_NAMES = ["YINXI.md", "yinxi.md", ".yinxi.md"];

/**
 * Search for a project file in the given directory and its parents.
 * Returns the content if found, null otherwise.
 */
export async function loadProjectFile(cwd: string): Promise<string | null> {
  let dir = cwd;

  // Search up to 5 levels up
  for (let i = 0; i < 5; i++) {
    for (const name of PROJECT_FILE_NAMES) {
      const filePath = path.join(dir, name);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return content.trim();
      } catch {
        // File doesn't exist, continue
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return null;
}
