/**
 * Undo system - tracks file operations for single-step undo.
 *
 * Keeps in-memory snapshots of file content before modifications.
 * Only the last operation per file is tracked (not a full history).
 */

import * as fs from "fs/promises";

interface FileSnapshot {
  path: string;
  content: string | null; // null means file didn't exist
  timestamp: number;
}

// Stack of recent file operations (limited to last 20)
const undoStack: FileSnapshot[] = [];
const MAX_UNDO_STACK = 20;

/**
 * Save a snapshot of a file before modifying it.
 * Call this before Write or Edit operations.
 */
export async function saveSnapshot(filePath: string): Promise<void> {
  let content: string | null = null;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  undoStack.push({
    path: filePath,
    content,
    timestamp: Date.now(),
  });

  // Trim stack
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
}

/**
 * Undo the last file operation.
 * Returns description of what was undone, or null if nothing to undo.
 */
export async function undoLast(): Promise<string | null> {
  const snapshot = undoStack.pop();
  if (!snapshot) return null;

  try {
    if (snapshot.content === null) {
      // File didn't exist before — delete it
      await fs.unlink(snapshot.path);
      return `Deleted ${snapshot.path} (file was newly created)`;
    } else {
      // Restore previous content
      await fs.writeFile(snapshot.path, snapshot.content, "utf-8");
      const lines = snapshot.content.split("\n").length;
      return `Restored ${snapshot.path} (${lines} lines)`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Failed to undo: ${message}`;
  }
}

/**
 * Get number of operations in the undo stack.
 */
export function undoStackSize(): number {
  return undoStack.length;
}
