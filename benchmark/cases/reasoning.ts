/**
 * Reasoning tasks — require understanding context, reading code, and making decisions.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { BenchmarkCase } from "../types.js";

export const reasoningCases: BenchmarkCase[] = [
  {
    id: "reason-001",
    name: "Find and fix security vulnerability",
    category: "reasoning",
    difficulty: "medium",
    setup: {
      "server.ts": `export function buildQuery(table: string, filters: Record<string, string>): string {
  let query = \`SELECT * FROM \${table}\`;
  const conditions: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    conditions.push(\`\${key} = '\${value}'\`);
  }
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  return query;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(\`{{\\s*\${key}\\s*}}\`, "g"), value);
  }
  return result;
}
`,
    },
    prompt: `Review server.ts for security vulnerabilities. Fix any issues you find. Write a brief comment above each fix explaining the vulnerability.`,
    verify: async (workspace) => {
      const content = await fs.readFile(path.join(workspace, "server.ts"), "utf-8");

      // Should have fixed SQL injection (parameterized or escaped)
      const fixedSql = !content.includes(`\${value}'`) || content.includes("escape") || content.includes("parameterize") || content.includes("sanitize") || content.includes("replace(");

      // Should have a comment about SQL injection or XSS
      const hasComment = content.toLowerCase().includes("injection") || content.toLowerCase().includes("xss") || content.toLowerCase().includes("security") || content.toLowerCase().includes("sanitiz");

      if (fixedSql && hasComment) {
        return { pass: true, reason: "Security vulnerabilities identified and fixed" };
      }
      return { pass: false, reason: `fixedSql=${fixedSql}, hasComment=${hasComment}` };
    },
  },

  {
    id: "reason-002",
    name: "Understand codebase and add feature",
    category: "reasoning",
    difficulty: "hard",
    setup: {
      "src/store.ts": `export interface State {
  items: string[];
  filter: string;
  sortOrder: "asc" | "desc";
}

export type Action =
  | { type: "ADD_ITEM"; payload: string }
  | { type: "REMOVE_ITEM"; payload: number }
  | { type: "SET_FILTER"; payload: string }
  | { type: "SET_SORT"; payload: "asc" | "desc" };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_ITEM":
      return { ...state, items: [...state.items, action.payload] };
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter((_, i) => i !== action.payload) };
    case "SET_FILTER":
      return { ...state, filter: action.payload };
    case "SET_SORT":
      return { ...state, sortOrder: action.payload };
    default:
      return state;
  }
}

export function getFilteredItems(state: State): string[] {
  let items = state.items;
  if (state.filter) {
    items = items.filter(item => item.toLowerCase().includes(state.filter.toLowerCase()));
  }
  items = [...items].sort((a, b) =>
    state.sortOrder === "asc" ? a.localeCompare(b) : b.localeCompare(a)
  );
  return items;
}

export function createStore(initialState: State) {
  let state = initialState;
  const listeners: (() => void)[] = [];

  return {
    getState: () => state,
    dispatch: (action: Action) => {
      state = reducer(state, action);
      listeners.forEach(l => l());
    },
    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };
}
`,
    },
    prompt: `Study the store system in src/store.ts. Add a new action type "TOGGLE_SORT" that flips the sort order (asc ↔ desc). Also add an "UNDO" action that reverts to the previous state (only needs to support one level of undo). Make sure all existing functionality still works.`,
    verify: async (workspace) => {
      try {
        const verifyCode = `
import { createStore, getFilteredItems } from "./src/store.js";

const store = createStore({ items: [], filter: "", sortOrder: "asc" });
const checks: [string, boolean][] = [];

// Existing: add items
store.dispatch({ type: "ADD_ITEM", payload: "banana" });
store.dispatch({ type: "ADD_ITEM", payload: "apple" });
checks.push(["add works", store.getState().items.length === 2]);

// Existing: sort
const asc = getFilteredItems(store.getState());
checks.push(["asc sort", asc[0] === "apple"]);

// New: TOGGLE_SORT
store.dispatch({ type: "TOGGLE_SORT" } as any);
checks.push(["toggle flips to desc", store.getState().sortOrder === "desc"]);

const desc = getFilteredItems(store.getState());
checks.push(["desc sort", desc[0] === "banana"]);

// Toggle back
store.dispatch({ type: "TOGGLE_SORT" } as any);
checks.push(["toggle back to asc", store.getState().sortOrder === "asc"]);

// New: UNDO
store.dispatch({ type: "ADD_ITEM", payload: "cherry" });
checks.push(["3 items", store.getState().items.length === 3]);
store.dispatch({ type: "UNDO" } as any);
checks.push(["undo removes cherry", store.getState().items.length === 2]);

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
          ? { pass: true, reason: "TOGGLE_SORT and UNDO actions work correctly" }
          : { pass: false, reason: `Verify: ${out.trim()}` };
      } catch (err) {
        return { pass: false, reason: `Error: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];
