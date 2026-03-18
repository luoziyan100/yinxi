/**
 * Permission system - asks user confirmation before dangerous operations.
 */

import * as readline from "readline";

export type PermissionLevel = "always" | "ask" | "never";

/**
 * Dangerous patterns that require user confirmation.
 */
const DANGEROUS_BASH_PATTERNS = [
  // File destruction
  /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)/,
  /\brm\s+-rf?\s+[\/~]/,  // rm targeting root or home
  // Git destructive operations
  /\bgit\s+push\b.*--force/,
  /\bgit\s+push\b.*-f\b/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+branch\s+-[a-zA-Z]*D/,
  /\bgit\s+rebase\b/,
  /\bgit\s+stash\s+drop/,
  // Database destruction
  /\bdrop\s+(table|database|schema)/i,
  /\btruncate\s+table/i,
  /\bdelete\s+from\b/i,
  // System commands
  /\bkill\s+-9/,
  /\bkillall\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\//,
  // Package management (global installs)
  /\bnpm\s+(-g|--global)\s+install/,
  /\bpip\s+install\b.*--break-system/,
  // Environment/config modification
  /\bchmod\s+777/,
  /\bchown\s+-R/,
];

/**
 * Check if a bash command is dangerous.
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

// Session-level "always allow" for specific patterns
const sessionAlwaysAllow = new Set<string>();

/**
 * Ask user for permission to execute a dangerous operation.
 * Returns true if approved, false if denied.
 * User can respond with 'a' to always allow this type of command for the session.
 */
export async function askPermission(
  description: string
): Promise<boolean> {
  // Check if user previously said "always allow" for this command type
  for (const pattern of sessionAlwaysAllow) {
    if (description.includes(pattern)) {
      return true;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `\n  ⚠️  ${description}\n  Allow? (y/n/a=always for this session): `,
      (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        if (normalized === "a" || normalized === "always") {
          // Extract the command keyword for session-level allow
          const match = description.match(/:\s*(\w+)/);
          if (match) sessionAlwaysAllow.add(match[1]);
          resolve(true);
        } else {
          resolve(normalized === "y" || normalized === "yes");
        }
      }
    );
  });
}
