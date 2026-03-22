/**
 * Basic coding tasks — code generation and simple operations.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BenchmarkCase } from "../types.js";

export const basicCases: BenchmarkCase[] = [
  {
    id: "basic-001",
    name: "FizzBuzz function",
    category: "basic",
    difficulty: "easy",
    setup: {},
    prompt: `Create a file called fizzbuzz.ts that exports a function fizzbuzz(n: number): string[].
It should return an array of strings from 1 to n where:
- multiples of 3 are "Fizz"
- multiples of 5 are "Buzz"
- multiples of both are "FizzBuzz"
- other numbers are their string representation`,
    verify: async (workspace) => {
      try {
        const content = await fs.readFile(path.join(workspace, "fizzbuzz.ts"), "utf-8");
        if (!content.includes("function") && !content.includes("=>")) {
          return { pass: false, reason: "No function found in fizzbuzz.ts" };
        }
        // Write and run a quick test
        const testCode = `
import { fizzbuzz } from "./fizzbuzz.js";
const result = fizzbuzz(15);
const checks = [
  result[0] === "1",
  result[2] === "Fizz",
  result[4] === "Buzz",
  result[14] === "FizzBuzz",
  result.length === 15,
];
console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify(result));
`;
        await fs.writeFile(path.join(workspace, "test.ts"), testCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "FizzBuzz output correct" }
          : { pass: false, reason: `Output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "basic-002",
    name: "Fibonacci generator",
    category: "basic",
    difficulty: "easy",
    setup: {},
    prompt: `Create a file called fib.ts that exports a function fibonacci(n: number): number[]
which returns the first n Fibonacci numbers starting from [0, 1, 1, 2, 3, 5, ...].`,
    verify: async (workspace) => {
      try {
        const testCode = `
import { fibonacci } from "./fib.js";
const result = fibonacci(8);
const expected = [0, 1, 1, 2, 3, 5, 8, 13];
console.log(JSON.stringify(result) === JSON.stringify(expected) ? "PASS" : "FAIL:" + JSON.stringify(result));
`;
        await fs.writeFile(path.join(workspace, "test.ts"), testCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "Fibonacci output correct" }
          : { pass: false, reason: `Output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "basic-003",
    name: "JSON parser utility",
    category: "basic",
    difficulty: "medium",
    setup: {},
    prompt: `Create a file called json-utils.ts that exports:
1. safeParse<T>(json: string): T | null — parses JSON, returns null on invalid input
2. deepGet(obj: any, path: string): any — gets a nested value by dot path (e.g. "a.b.c")
3. deepSet(obj: any, path: string, value: any): void — sets a nested value by dot path, creating intermediate objects`,
    verify: async (workspace) => {
      try {
        const testCode = `
import { safeParse, deepGet, deepSet } from "./json-utils.js";

const checks: boolean[] = [];

// safeParse
checks.push(safeParse('{"a":1}')?.a === 1);
checks.push(safeParse('invalid') === null);
checks.push(safeParse('null') === null);

// deepGet
checks.push(deepGet({ a: { b: { c: 42 } } }, "a.b.c") === 42);
checks.push(deepGet({ a: 1 }, "a.b.c") === undefined);

// deepSet
const obj: any = {};
deepSet(obj, "a.b.c", 42);
checks.push(obj.a.b.c === 42);

console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify(checks));
`;
        await fs.writeFile(path.join(workspace, "test.ts"), testCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "All JSON utils work correctly" }
          : { pass: false, reason: `Output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "basic-004",
    name: "CLI argument parser",
    category: "basic",
    difficulty: "medium",
    setup: {},
    prompt: `Create a file called parse-args.ts that exports a function parseArgs(args: string[]): Record<string, string | boolean>.
Rules:
- "--flag" without a value → { flag: true }
- "--key value" → { key: "value" }
- "--key=value" → { key: "value" }
- "-k value" → { k: "value" }
- Everything else is ignored`,
    verify: async (workspace) => {
      try {
        const testCode = `
import { parseArgs } from "./parse-args.js";
const checks: boolean[] = [];

const r1 = parseArgs(["--verbose", "--name", "test", "--port=3000", "-d", "/tmp"]);
checks.push(r1.verbose === true);
checks.push(r1.name === "test");
checks.push(r1.port === "3000");
checks.push(r1.d === "/tmp");

const r2 = parseArgs([]);
checks.push(Object.keys(r2).length === 0);

console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify({ r1, checks }));
`;
        await fs.writeFile(path.join(workspace, "test.ts"), testCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "Argument parser works correctly" }
          : { pass: false, reason: `Output: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];
