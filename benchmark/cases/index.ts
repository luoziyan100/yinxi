/**
 * All benchmark cases, organized by category.
 */

import { basicCases } from "./basic.js";
import { editCases } from "./edit.js";
import { debugCases } from "./debug.js";
import { multiFileCases } from "./multi-file.js";
import { reasoningCases } from "./reasoning.js";
import type { BenchmarkCase } from "../types.js";

export const allCases: BenchmarkCase[] = [
  ...basicCases,
  ...editCases,
  ...debugCases,
  ...multiFileCases,
  ...reasoningCases,
];

export function getCasesByCategory(category: string): BenchmarkCase[] {
  return allCases.filter((c) => c.category === category);
}

export function getCasesByDifficulty(difficulty: string): BenchmarkCase[] {
  return allCases.filter((c) => c.difficulty === difficulty);
}

export function getCaseById(id: string): BenchmarkCase | undefined {
  return allCases.find((c) => c.id === id);
}

export const categories = [...new Set(allCases.map((c) => c.category))];

export { basicCases, editCases, debugCases, multiFileCases, reasoningCases };
