/**
 * Git awareness - detects git repo info for system prompt enrichment.
 */

import { execSync } from "child_process";

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  hasUncommitted?: boolean;
  remoteUrl?: string;
}

/**
 * Detect git information for the given directory.
 */
export function detectGitInfo(cwd: string): GitInfo {
  try {
    // Check if it's a git repo
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    });
  } catch {
    return { isRepo: false };
  }

  const info: GitInfo = { isRepo: true };

  try {
    info.branch = execSync("git branch --show-current", {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    // detached HEAD or error
  }

  try {
    const status = execSync("git status --porcelain", {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    })
      .toString()
      .trim();
    info.hasUncommitted = status.length > 0;
  } catch {
    // ignore
  }

  try {
    info.remoteUrl = execSync("git remote get-url origin", {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    // no remote
  }

  return info;
}

/**
 * Format git info as a string for the system prompt.
 */
export function formatGitInfo(info: GitInfo): string {
  if (!info.isRepo) {
    return "- Git: not a git repository";
  }

  const parts = ["- Git: yes"];
  if (info.branch) {
    parts.push(`- Branch: ${info.branch}`);
  }
  if (info.hasUncommitted !== undefined) {
    parts.push(`- Uncommitted changes: ${info.hasUncommitted ? "yes" : "no"}`);
  }
  if (info.remoteUrl) {
    parts.push(`- Remote: ${info.remoteUrl}`);
  }

  return parts.join("\n");
}
