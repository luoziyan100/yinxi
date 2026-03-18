/**
 * Configuration management.
 * Persists settings to ~/.yinxi/config.json so you don't need env vars every time.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const CONFIG_DIR = path.join(os.homedir(), ".yinxi");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface YinxiConfig {
  api_key: string;
  base_url?: string;
  model: string;
  provider: "openai" | "anthropic" | "responses";
}

const DEFAULT_CONFIG: YinxiConfig = {
  api_key: "",
  model: "gpt-4.1",
  provider: "responses",
};

/**
 * Load config from ~/.yinxi/config.json, merging with env vars.
 * Priority: env vars > config file > defaults
 */
export async function loadConfig(): Promise<YinxiConfig> {
  const config = { ...DEFAULT_CONFIG };

  // Read config file
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const saved = JSON.parse(raw);
    Object.assign(config, saved);
  } catch {
    // No config file yet, that's fine
  }

  // Env vars override config file
  // ANTHROPIC_API_KEY takes precedence if model starts with "claude"
  if (process.env.OPENAI_API_KEY && !config.model.startsWith("claude")) {
    config.api_key = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    // Use Anthropic key if model is claude, or if no other key is set
    if (config.model.startsWith("claude") || !config.api_key) {
      config.api_key = process.env.ANTHROPIC_API_KEY;
    }
    // Auto-detect provider from API key if not explicitly set
    if (config.model.startsWith("claude") && config.provider !== "anthropic") {
      config.provider = "anthropic";
    }
  }
  // Fallback: if no key yet but OPENAI_API_KEY exists, use it
  if (!config.api_key && process.env.OPENAI_API_KEY) {
    config.api_key = process.env.OPENAI_API_KEY;
  }
  if (process.env.OPENAI_BASE_URL) {
    config.base_url = process.env.OPENAI_BASE_URL;
  }
  if (process.env.YINXI_MODEL) {
    config.model = process.env.YINXI_MODEL;
  }
  if (process.env.YINXI_PROVIDER) {
    config.provider = process.env.YINXI_PROVIDER as "openai" | "anthropic" | "responses";
  }

  // Auto-detect provider from model name if API key suggests it
  if (config.model.startsWith("claude") && config.provider !== "anthropic") {
    config.provider = "anthropic";
  }

  return config;
}

/**
 * Save config to ~/.yinxi/config.json.
 */
export async function saveConfig(config: YinxiConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Interactive first-time setup wizard.
 */
export async function setupWizard(): Promise<YinxiConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

  console.log("\n  Welcome to Yinxi! Let's set up your API.\n");

  const apiKey = await ask("  API Key: ");
  const baseUrl = await ask("  Base URL (leave empty for OpenAI default): ");
  const model = await ask(`  Model (default: ${DEFAULT_CONFIG.model}): `);
  const provider = await ask("  Provider - openai, responses, or anthropic (default: responses): ");

  rl.close();

  const config: YinxiConfig = {
    api_key: apiKey,
    base_url: baseUrl || undefined,
    model: model || DEFAULT_CONFIG.model,
    provider: (provider as "openai" | "anthropic" | "responses") || "responses",
  };

  await saveConfig(config);
  console.log(`\n  ✓ Config saved to ${CONFIG_FILE}\n`);

  return config;
}

export { CONFIG_FILE };
