/**
 * Multi-file tasks — require reading, understanding, and modifying multiple files.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BenchmarkCase } from "../types.js";

export const multiFileCases: BenchmarkCase[] = [
  {
    id: "multi-001",
    name: "Add new API endpoint with tests",
    category: "multi-file",
    difficulty: "medium",
    setup: {
      "types.ts": `export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Todo {
  id: number;
  userId: number;
  title: string;
  done: boolean;
}
`,
      "db.ts": `import type { User, Todo } from "./types.js";

const users: User[] = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];

const todos: Todo[] = [
  { id: 1, userId: 1, title: "Buy milk", done: false },
  { id: 2, userId: 1, title: "Walk dog", done: true },
  { id: 3, userId: 2, title: "Read book", done: false },
];

export function getUsers(): User[] { return users; }
export function getUserById(id: number): User | undefined { return users.find(u => u.id === id); }
export function getTodos(): Todo[] { return todos; }
export function getTodosByUserId(userId: number): Todo[] { return todos.filter(t => t.userId === userId); }
`,
      "api.ts": `import { getUsers, getUserById, getTodos, getTodosByUserId } from "./db.js";
import type { User, Todo } from "./types.js";

export function handleRequest(method: string, path: string): { status: number; body: any } {
  if (method === "GET" && path === "/users") {
    return { status: 200, body: getUsers() };
  }

  const userMatch = path.match(/^\\/users\\/(\\d+)$/);
  if (method === "GET" && userMatch) {
    const user = getUserById(parseInt(userMatch[1]));
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { error: "User not found" } };
  }

  if (method === "GET" && path === "/todos") {
    return { status: 200, body: getTodos() };
  }

  return { status: 404, body: { error: "Not found" } };
}
`,
    },
    prompt: `Add a new endpoint: GET /users/:id/todos that returns all todos for a given user.
- If the user doesn't exist, return 404 with { error: "User not found" }
- If the user exists but has no todos, return 200 with an empty array
- Update api.ts to handle this new route
- Create a test file api.test.ts that tests the new endpoint along with existing ones`,
    verify: async (workspace) => {
      try {
        // Check test file exists
        const testExists = await fs.access(path.join(workspace, "api.test.ts")).then(() => true).catch(() => false);
        if (!testExists) return { pass: false, reason: "api.test.ts not created" };

        // Functional verification — import and call the handler directly
        const verifyCode = `
import { handleRequest } from "./api.js";

const checks: [string, boolean][] = [];

// Existing endpoints still work
const r1 = handleRequest("GET", "/users");
checks.push(["GET /users returns users", r1.status === 200 && r1.body.length === 2]);

const r1b = handleRequest("GET", "/users/1");
checks.push(["GET /users/1 returns user", r1b.status === 200 && r1b.body.name === "Alice"]);

const r1c = handleRequest("GET", "/todos");
checks.push(["GET /todos returns todos", r1c.status === 200 && r1c.body.length === 3]);

// New endpoint: user 1 todos
const r2 = handleRequest("GET", "/users/1/todos");
checks.push(["GET /users/1/todos returns 200", r2.status === 200]);
checks.push(["User 1 has 2 todos", Array.isArray(r2.body) && r2.body.length === 2]);

// Non-existent user
const r3 = handleRequest("GET", "/users/999/todos");
checks.push(["GET /users/999/todos returns 404", r3.status === 404]);

const allPass = checks.every(([, ok]) => ok);
if (!allPass) {
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  console.log("FAIL:" + JSON.stringify(failed));
} else {
  console.log("PASS");
}
`;
        await fs.writeFile(path.join(workspace, "verify.ts"), verifyCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx verify.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "New endpoint works, existing endpoints preserved" }
          : { pass: false, reason: `Verify: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  {
    id: "multi-002",
    name: "Refactor module into separate files",
    category: "multi-file",
    difficulty: "hard",
    setup: {
      "monolith.ts": `// This file is too big. Split it into separate modules.

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createConsoleLogger(prefix: string): Logger {
  return {
    info: (msg) => console.log(\`[\${prefix}] INFO: \${msg}\`),
    warn: (msg) => console.warn(\`[\${prefix}] WARN: \${msg}\`),
    error: (msg) => console.error(\`[\${prefix}] ERROR: \${msg}\`),
  };
}

export interface Validator<T> {
  validate(value: T): { valid: boolean; errors: string[] };
}

export function createStringValidator(minLength: number, maxLength: number): Validator<string> {
  return {
    validate(value: string) {
      const errors: string[] = [];
      if (value.length < minLength) errors.push(\`Too short (min \${minLength})\`);
      if (value.length > maxLength) errors.push(\`Too long (max \${maxLength})\`);
      return { valid: errors.length === 0, errors };
    },
  };
}

export function createNumberValidator(min: number, max: number): Validator<number> {
  return {
    validate(value: number) {
      const errors: string[] = [];
      if (value < min) errors.push(\`Too small (min \${min})\`);
      if (value > max) errors.push(\`Too large (max \${max})\`);
      if (!Number.isFinite(value)) errors.push("Must be finite");
      return { valid: errors.length === 0, errors };
    },
  };
}

export interface EventEmitter<T extends Record<string, any>> {
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): void;
  emit<K extends keyof T>(event: K, data: T[K]): void;
}

export function createEventEmitter<T extends Record<string, any>>(): EventEmitter<T> {
  const handlers = new Map<keyof T, Set<(data: any) => void>>();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    emit(event, data) {
      const set = handlers.get(event);
      if (set) set.forEach(fn => fn(data));
    },
  };
}
`,
    },
    prompt: `Refactor monolith.ts into 3 separate files:
1. logger.ts — Logger interface and createConsoleLogger
2. validator.ts — Validator interface, createStringValidator, createNumberValidator
3. events.ts — EventEmitter interface and createEventEmitter

Then create an index.ts that re-exports everything from all three files.
Delete the original monolith.ts after refactoring.`,
    verify: async (workspace) => {
      try {
        // Check all files exist
        const files = ["logger.ts", "validator.ts", "events.ts", "index.ts"];
        for (const f of files) {
          try {
            await fs.access(path.join(workspace, f));
          } catch {
            return { pass: false, reason: `Missing file: ${f}` };
          }
        }

        // Check monolith.ts is deleted
        try {
          await fs.access(path.join(workspace, "monolith.ts"));
          return { pass: false, reason: "monolith.ts should be deleted" };
        } catch {
          // Good — it's deleted
        }

        // Verify imports work via index.ts
        const verifyCode = `
import { createConsoleLogger, createStringValidator, createNumberValidator, createEventEmitter } from "./index.js";

const checks: boolean[] = [];

// Logger
const logger = createConsoleLogger("test");
checks.push(typeof logger.info === "function");

// String validator
const sv = createStringValidator(2, 10);
checks.push(sv.validate("ok").valid === true);
checks.push(sv.validate("x").valid === false);

// Number validator
const nv = createNumberValidator(0, 100);
checks.push(nv.validate(50).valid === true);
checks.push(nv.validate(-1).valid === false);

// EventEmitter
const ee = createEventEmitter<{ click: { x: number } }>();
let received = false;
ee.on("click", (data) => { received = data.x === 42; });
ee.emit("click", { x: 42 });
checks.push(received === true);

console.log(checks.every(Boolean) ? "PASS" : "FAIL:" + JSON.stringify(checks));
`;
        await fs.writeFile(path.join(workspace, "verify.ts"), verifyCode);
        const { execSync } = await import("child_process");
        const out = execSync(`npx tsx verify.ts`, { cwd: workspace, encoding: "utf-8", timeout: 30000 });
        return out.trim().startsWith("PASS")
          ? { pass: true, reason: "Refactored into 3 files, all exports work" }
          : { pass: false, reason: `Verify: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];
