/**
 * File editing tasks — modify existing code correctly.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BenchmarkCase } from "../types.js";

export const editCases: BenchmarkCase[] = [
  {
    id: "edit-001",
    name: "Rename variable across file",
    category: "edit",
    difficulty: "easy",
    setup: {
      "counter.ts": `export class Counter {
  private count: number = 0;

  increment(): void {
    this.count++;
  }

  decrement(): void {
    this.count--;
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}
`,
    },
    prompt: `In counter.ts, rename the private field "count" to "value" everywhere it appears. Keep all method names the same.`,
    verify: async (workspace) => {
      const content = await fs.readFile(path.join(workspace, "counter.ts"), "utf-8");
      const hasValue = content.includes("this.value");
      const noCount = !content.includes("this.count");
      const hasPrivateValue = content.includes("private value");
      const hasGetCount = content.includes("getCount");
      if (hasValue && noCount && hasPrivateValue && hasGetCount) {
        return { pass: true, reason: "Variable renamed correctly" };
      }
      return { pass: false, reason: `hasValue=${hasValue}, noCount=${noCount}, hasPrivateValue=${hasPrivateValue}, hasGetCount=${hasGetCount}` };
    },
  },

  {
    id: "edit-002",
    name: "Add error handling to function",
    category: "edit",
    difficulty: "medium",
    setup: {
      "fetch-data.ts": `export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}
`,
    },
    prompt: `Modify fetch-data.ts to add proper error handling:
1. Wrap in try/catch
2. Check if response.ok, throw an Error with the status code if not
3. Return null in the catch block`,
    verify: async (workspace) => {
      const content = await fs.readFile(path.join(workspace, "fetch-data.ts"), "utf-8");
      const hasTryCatch = content.includes("try") && content.includes("catch");
      const checksResponseOk = content.includes("response.ok") || content.includes(".ok");
      const returnsNull = content.includes("return null");
      if (hasTryCatch && checksResponseOk && returnsNull) {
        return { pass: true, reason: "Error handling added correctly" };
      }
      return { pass: false, reason: `tryCatch=${hasTryCatch}, checksOk=${checksResponseOk}, returnsNull=${returnsNull}` };
    },
  },

  {
    id: "edit-003",
    name: "Convert class to use generics",
    category: "edit",
    difficulty: "medium",
    setup: {
      "stack.ts": `export class Stack {
  private items: number[] = [];

  push(item: number): void {
    this.items.push(item);
  }

  pop(): number | undefined {
    return this.items.pop();
  }

  peek(): number | undefined {
    return this.items[this.items.length - 1];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}
`,
    },
    prompt: `Convert the Stack class in stack.ts to use generics. It should be Stack<T> and work with any type, not just numbers.`,
    verify: async (workspace) => {
      try {
        const content = await fs.readFile(path.join(workspace, "stack.ts"), "utf-8");
        const hasGeneric = content.includes("Stack<T>") || content.includes("class Stack<T");
        const hasGenericArray = content.includes("T[]");
        const noNumberType = !content.includes(": number[]") && !content.includes(": number |") && !content.includes("(item: number)");
        if (hasGeneric && hasGenericArray && noNumberType) {
          // Try to compile
          const testCode = `
import { Stack } from "./stack.js";
const s = new Stack<string>();
s.push("hello");
s.push("world");
console.log(s.peek() === "world" && s.size() === 2 ? "PASS" : "FAIL");
`;
          await fs.writeFile(path.join(workspace, "test.ts"), testCode);
          const { execSync } = await import("child_process");
          const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
          return out.trim() === "PASS"
            ? { pass: true, reason: "Generic Stack works correctly" }
            : { pass: false, reason: `Runtime: ${out.trim()}` };
        }
        return { pass: false, reason: `hasGeneric=${hasGeneric}, hasGenericArray=${hasGenericArray}, noNumber=${noNumberType}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "edit-004",
    name: "Extract function from inline code",
    category: "edit",
    difficulty: "hard",
    setup: {
      "process.ts": `export function processUsers(users: { name: string; age: number; email: string }[]) {
  const results = [];
  for (const user of users) {
    // Validate email
    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(user.email)) {
      results.push({ ...user, valid: false, reason: "invalid email" });
      continue;
    }
    // Validate age
    if (user.age < 0 || user.age > 150) {
      results.push({ ...user, valid: false, reason: "invalid age" });
      continue;
    }
    // Validate name
    if (!user.name || user.name.trim().length < 2) {
      results.push({ ...user, valid: false, reason: "invalid name" });
      continue;
    }
    results.push({ ...user, valid: true, reason: "" });
  }
  return results;
}
`,
    },
    prompt: `Refactor process.ts: extract the validation logic into a separate function called "validateUser" that takes a single user and returns { valid: boolean, reason: string }. The processUsers function should call validateUser.`,
    verify: async (workspace) => {
      const content = await fs.readFile(path.join(workspace, "process.ts"), "utf-8");
      const hasValidateUser = content.includes("function validateUser") || content.includes("validateUser");
      const callsIt = content.includes("validateUser(");
      const testCode = `
import { processUsers } from "./process.js";
const users = [
  { name: "Alice", age: 30, email: "alice@example.com" },
  { name: "", age: 25, email: "bob@test.com" },
  { name: "Charlie", age: -5, email: "c@t.com" },
  { name: "Diana", age: 40, email: "invalid" },
];
const results = processUsers(users);
const checks = [
  results[0].valid === true,
  results[1].valid === false,
  results[2].valid === false,
  results[3].valid === false,
];
console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify(results));
`;
      try {
        await fs.writeFile(path.join(workspace, "test.ts"), testCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx test.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        if (out.trim().startsWith("PASS") && hasValidateUser && callsIt) {
          return { pass: true, reason: "Extracted validateUser correctly, behavior preserved" };
        }
        return { pass: false, reason: `hasFunc=${hasValidateUser}, calls=${callsIt}, runtime=${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];
