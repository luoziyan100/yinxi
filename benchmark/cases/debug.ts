/**
 * Bug fixing tasks — find and fix bugs in existing code.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BenchmarkCase } from "../types.js";

export const debugCases: BenchmarkCase[] = [
  {
    id: "debug-001",
    name: "Fix off-by-one error",
    category: "debug",
    difficulty: "easy",
    setup: {
      "range.ts": `/**
 * Returns an array of numbers from start to end (inclusive).
 * Example: range(1, 5) should return [1, 2, 3, 4, 5]
 */
export function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i < end; i++) {
    result.push(i);
  }
  return result;
}
`,
      "range.test.ts": `import { range } from "./range.js";

const r = range(1, 5);
if (JSON.stringify(r) !== JSON.stringify([1, 2, 3, 4, 5])) {
  console.log("FAIL: range(1,5) =", JSON.stringify(r), "expected [1,2,3,4,5]");
  process.exit(1);
}

const r2 = range(0, 0);
if (JSON.stringify(r2) !== JSON.stringify([0])) {
  console.log("FAIL: range(0,0) =", JSON.stringify(r2), "expected [0]");
  process.exit(1);
}

console.log("PASS");
`,
    },
    prompt: `The range function in range.ts has a bug. Run the test file range.test.ts to see the failure, then fix the bug.`,
    verify: async (workspace) => {
      try {
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx range.test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim() === "PASS"
          ? { pass: true, reason: "Off-by-one fixed, tests pass" }
          : { pass: false, reason: `Test output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Test failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "debug-002",
    name: "Fix async race condition",
    category: "debug",
    difficulty: "medium",
    setup: {
      "cache.ts": `/**
 * Simple async cache. get() should return cached value if available,
 * otherwise call the loader function and cache the result.
 *
 * Bug: concurrent calls to get() with the same key can trigger
 * multiple loader calls. Should only call loader once per key.
 */
export class AsyncCache<T> {
  private cache = new Map<string, T>();

  async get(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const value = await loader();
    this.cache.set(key, value);
    return value;
  }
}
`,
      "cache.test.ts": `import { AsyncCache } from "./cache.js";

async function test() {
  const cache = new AsyncCache<number>();
  let loadCount = 0;

  const loader = async () => {
    loadCount++;
    await new Promise(r => setTimeout(r, 50));
    return 42;
  };

  // Fire 5 concurrent requests for the same key
  const results = await Promise.all([
    cache.get("x", loader),
    cache.get("x", loader),
    cache.get("x", loader),
    cache.get("x", loader),
    cache.get("x", loader),
  ]);

  // All should return 42
  const allCorrect = results.every(r => r === 42);
  // Loader should only be called once
  const onceOnly = loadCount === 1;

  if (allCorrect && onceOnly) {
    console.log("PASS");
  } else {
    console.log(\`FAIL: allCorrect=\${allCorrect}, loadCount=\${loadCount}\`);
  }
}

test();
`,
    },
    prompt: `The AsyncCache in cache.ts has a race condition bug. Run cache.test.ts to see the failure, then fix it. Concurrent get() calls with the same key should only trigger the loader once.`,
    verify: async (workspace) => {
      try {
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx cache.test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim() === "PASS"
          ? { pass: true, reason: "Race condition fixed" }
          : { pass: false, reason: `Test output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Test failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "debug-003",
    name: "Fix type error in generic function",
    category: "debug",
    difficulty: "medium",
    setup: {
      "merge.ts": `/**
 * Deep merge two objects. Second object's values override first's.
 * Arrays should be concatenated, not replaced.
 *
 * This code has several bugs. Fix them all.
 */
export function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  const result = { ...a };

  for (const key in b) {
    const bVal = b[key];
    const aVal = result[key];

    if (Array.isArray(aVal) && Array.isArray(bVal)) {
      // Bug 1: should concatenate, not assign
      (result as any)[key] = bVal;
    } else if (aVal && typeof aVal === "object" && bVal && typeof bVal === "object" && !Array.isArray(aVal)) {
      // Bug 2: wrong recursion — doesn't cast properly
      (result as any)[key] = deepMerge(aVal, bVal);
    } else if (bVal !== undefined) {
      (result as any)[key] = bVal;
    }
  }

  return result;
}
`,
      "merge.test.ts": `import { deepMerge } from "./merge.js";

const a = { x: 1, tags: ["a", "b"], nested: { foo: 1, bar: 2 } };
const b = { x: 10, tags: ["c"], nested: { bar: 20, baz: 3 } };

const result = deepMerge(a, b);

const checks = [
  result.x === 10,
  JSON.stringify(result.tags) === JSON.stringify(["a", "b", "c"]),
  result.nested.foo === 1,
  result.nested.bar === 20,
  (result.nested as any).baz === 3,
];

console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify({ result, checks }));
`,
    },
    prompt: `The deepMerge function in merge.ts has bugs. Run merge.test.ts to see failures, then fix all bugs.`,
    verify: async (workspace) => {
      try {
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx merge.test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim() === "PASS"
          ? { pass: true, reason: "All merge bugs fixed" }
          : { pass: false, reason: `Test output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Test failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];
