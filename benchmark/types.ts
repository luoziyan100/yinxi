/**
 * Benchmark system type definitions.
 */

export interface BenchmarkCase {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category: basic, edit, debug, multi-file, reasoning */
  category: string;
  /** Difficulty: easy, medium, hard */
  difficulty: "easy" | "medium" | "hard";
  /** Files to create in the workspace before running */
  setup: Record<string, string>;
  /** The prompt to send to the agent */
  prompt: string;
  /** Timeout in ms (default: 120_000) */
  timeoutMs?: number;
  /** Verification function: returns { pass, reason } */
  verify: (workspace: string) => Promise<VerifyResult>;
}

export interface VerifyResult {
  pass: boolean;
  reason: string;
}

export interface CaseResult {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  pass: boolean;
  reason: string;
  elapsedMs: number;
  tokens: { input: number; output: number };
  toolCalls: number;
  error?: string;
}

export interface BenchmarkReport {
  model: string;
  provider: string;
  timestamp: string;
  totalCases: number;
  passed: number;
  failed: number;
  passRate: string;
  totalTokens: { input: number; output: number };
  totalElapsedMs: number;
  results: CaseResult[];
  byCategory: Record<string, { total: number; passed: number }>;
  byDifficulty: Record<string, { total: number; passed: number }>;
}
