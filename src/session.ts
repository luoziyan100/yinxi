/**
 * Session persistence - save and restore conversation state as JSONL.
 *
 * Each session is a JSONL file in ~/.yinxi/sessions/.
 * Each line is a JSON entry: session metadata, messages, or compaction markers.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Message } from "./types.js";

const SESSIONS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".yinxi",
  "sessions"
);

export interface SessionEntry {
  type: "session" | "message" | "compaction" | "usage";
  timestamp: string;
  data: unknown;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Generate a short session ID.
 */
function generateId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${now}-${rand}`;
}

/**
 * Ensure sessions directory exists.
 */
async function ensureDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * Create a new session file and return its ID.
 */
export async function createSession(cwd: string, model: string): Promise<string> {
  await ensureDir();
  const id = generateId();
  const filePath = path.join(SESSIONS_DIR, `${id}.jsonl`);

  const meta: SessionEntry = {
    type: "session",
    timestamp: new Date().toISOString(),
    data: { id, cwd, model },
  };

  await fs.writeFile(filePath, JSON.stringify(meta) + "\n", "utf-8");
  return id;
}

/**
 * Append a message to an existing session.
 */
export async function appendMessage(sessionId: string, message: Message): Promise<void> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);

  const entry: SessionEntry = {
    type: "message",
    timestamp: new Date().toISOString(),
    data: message,
  };

  await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Append multiple messages at once.
 */
export async function appendMessages(sessionId: string, messages: Message[]): Promise<void> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);

  const lines = messages.map((msg) => {
    const entry: SessionEntry = {
      type: "message",
      timestamp: new Date().toISOString(),
      data: msg,
    };
    return JSON.stringify(entry);
  });

  await fs.appendFile(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Record a compaction event.
 */
export async function appendCompaction(
  sessionId: string,
  summary: string,
  removedCount: number
): Promise<void> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);

  const entry: SessionEntry = {
    type: "compaction",
    timestamp: new Date().toISOString(),
    data: { summary, removedCount },
  };

  await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Load all messages from a session.
 */
export async function loadSession(sessionId: string): Promise<{
  meta: { cwd: string; model: string };
  messages: Message[];
}> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let meta = { cwd: ".", model: "gpt-4.1" };
  const messages: Message[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.type === "session") {
        const data = entry.data as any;
        meta = { cwd: data.cwd || ".", model: data.model || "gpt-4.1" };
      } else if (entry.type === "message") {
        messages.push(entry.data as Message);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { meta, messages };
}

/**
 * List recent sessions, newest first.
 */
export async function listSessions(limit: number = 10): Promise<SessionMeta[]> {
  await ensureDir();

  let files: string[];
  try {
    files = await fs.readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const sessions: SessionMeta[] = [];

  for (const file of jsonlFiles.slice(0, limit)) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const stat = await fs.stat(filePath);

      // Parse first line for session meta
      const first = JSON.parse(lines[0]) as SessionEntry;
      const data = first.data as any;

      const messageCount = lines.filter((l) => {
        try { return JSON.parse(l).type === "message"; } catch { return false; }
      }).length;

      sessions.push({
        id: data.id || file.replace(".jsonl", ""),
        cwd: data.cwd || ".",
        model: data.model || "unknown",
        createdAt: first.timestamp,
        updatedAt: stat.mtime.toISOString(),
        messageCount,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return sessions;
}

/**
 * Find the most recent session for a given cwd.
 */
export async function findRecentSession(cwd: string): Promise<string | null> {
  const sessions = await listSessions(20);
  const match = sessions.find((s) => s.cwd === cwd && s.messageCount > 0);
  return match ? match.id : null;
}

/**
 * Clean up old session files, keeping only the most recent N.
 */
export async function cleanupSessions(keep: number = 50): Promise<number> {
  await ensureDir();
  let files: string[];
  try {
    files = await fs.readdir(SESSIONS_DIR);
  } catch {
    return 0;
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const toDelete = jsonlFiles.slice(keep);

  let deleted = 0;
  for (const file of toDelete) {
    try {
      await fs.unlink(path.join(SESSIONS_DIR, file));
      deleted++;
    } catch {
      // skip
    }
  }

  return deleted;
}
