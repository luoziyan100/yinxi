/**
 * Tool registry - creates all available tools.
 */

import type { Tool, AgentConfig } from "../types.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createBashTool } from "./bash.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createAgentTool } from "./agent.js";
import { createFetchTool } from "./fetch.js";

/**
 * Create all basic tools (without Agent tool — used for sub-agents).
 */
export function createAllTools(cwd: string): Tool[] {
  return [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createBashTool(cwd),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createFetchTool(),
  ];
}

/**
 * Create all tools including the Agent tool (used for top-level agent).
 */
export function createAllToolsWithAgent(cwd: string, parentConfig: AgentConfig): Tool[] {
  return [
    ...createAllTools(cwd),
    createAgentTool(cwd, parentConfig),
  ];
}

export {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createGlobTool,
  createGrepTool,
  createFetchTool,
  createAgentTool,
};
