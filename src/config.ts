/**
 * Configuration management.
 * Supports multiple named providers with switching.
 * Persists settings to ~/.yinxi/config.json.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const CONFIG_DIR = path.join(os.homedir(), ".yinxi");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface ProviderConfig {
  api_key: string;
  base_url?: string;
  model: string;
  provider: "openai" | "anthropic" | "responses";
}

export interface YinxiConfig {
  active: string;
  providers: Record<string, ProviderConfig>;
}

// Alias for backwards compatibility — structurally identical to ProviderConfig
export type FlatConfig = ProviderConfig;

const DEFAULT_PROVIDER: ProviderConfig = {
  api_key: "",
  model: "gpt-4.1",
  provider: "responses",
};

/**
 * Migrate old single-provider config to new multi-provider format.
 */
function migrateOldConfig(raw: Record<string, unknown>): YinxiConfig {
  // Old format: { api_key, base_url, model, provider }
  if ("api_key" in raw && !("providers" in raw)) {
    const name = (raw.base_url as string)?.includes("xuedingtoken") ? "xuedingtoken"
      : (raw.base_url as string)?.includes("aigocode") ? "aigocode"
      : "default";
    return {
      active: name,
      providers: {
        [name]: {
          api_key: raw.api_key as string,
          base_url: raw.base_url as string | undefined,
          model: (raw.model as string) || "gpt-4.1",
          provider: (raw.provider as ProviderConfig["provider"]) || "responses",
        },
      },
    };
  }
  return raw as unknown as YinxiConfig;
}

/**
 * Apply environment variable overrides to a config.
 * Priority: YINXI_* env vars > ANTHROPIC/OPENAI env vars > config file values.
 */
export function applyEnvOverrides(config: ProviderConfig): ProviderConfig {
  const result = { ...config };

  // Explicit overrides always win
  if (process.env.YINXI_MODEL) {
    result.model = process.env.YINXI_MODEL;
  }
  if (process.env.YINXI_PROVIDER) {
    result.provider = process.env.YINXI_PROVIDER as ProviderConfig["provider"];
  }
  if (process.env.OPENAI_BASE_URL) {
    result.base_url = process.env.OPENAI_BASE_URL;
  }

  // API key: match key to model type
  const isClaude = result.model.startsWith("claude");
  if (isClaude && process.env.ANTHROPIC_API_KEY) {
    result.api_key = process.env.ANTHROPIC_API_KEY;
  } else if (!isClaude && process.env.OPENAI_API_KEY) {
    result.api_key = process.env.OPENAI_API_KEY;
  }
  // Fallback: use any available key if none set
  if (!result.api_key) {
    result.api_key = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
  }

  // Auto-detect provider from model name
  if (result.model.startsWith("claude") && result.provider !== "anthropic") {
    result.provider = "anthropic";
  }

  return result;
}

/**
 * Load config from ~/.yinxi/config.json, merging with env vars.
 * Returns the active provider's flattened config.
 */
export async function loadConfig(): Promise<ProviderConfig> {
  let multiConfig: YinxiConfig = { active: "default", providers: {} };

  // Read config file
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    multiConfig = migrateOldConfig(parsed);
  } catch {
    // No config file yet
  }

  const activeProvider = multiConfig.providers[multiConfig.active] || DEFAULT_PROVIDER;
  return applyEnvOverrides(activeProvider);
}

/**
 * Load the full multi-provider config.
 */
export async function loadMultiConfig(): Promise<YinxiConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return migrateOldConfig(parsed);
  } catch {
    return { active: "default", providers: {} };
  }
}

/**
 * Save multi-provider config to ~/.yinxi/config.json.
 */
export async function saveMultiConfig(config: YinxiConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Save config (backwards-compatible wrapper).
 */
export async function saveConfig(config: ProviderConfig): Promise<void> {
  const multi = await loadMultiConfig();
  multi.providers[multi.active] = {
    api_key: config.api_key,
    base_url: config.base_url,
    model: config.model,
    provider: config.provider,
  };
  await saveMultiConfig(multi);
}

/**
 * Switch active provider. Returns the new provider's config with env overrides applied.
 */
export async function switchProvider(name: string): Promise<ProviderConfig | null> {
  const multi = await loadMultiConfig();
  if (!multi.providers[name]) {
    return null;
  }
  multi.active = name;
  await saveMultiConfig(multi);
  return applyEnvOverrides(multi.providers[name]);
}

/**
 * List all configured providers.
 */
export async function listProviders(): Promise<{ name: string; config: ProviderConfig; active: boolean }[]> {
  const multi = await loadMultiConfig();
  return Object.entries(multi.providers).map(([name, config]) => ({
    name,
    config,
    active: name === multi.active,
  }));
}

/**
 * Interactive first-time setup wizard.
 */
export async function setupWizard(): Promise<ProviderConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

  console.log("\n  Welcome to Yinxi! Let's set up your API.\n");

  const name = await ask("  Provider name (e.g. openai, anthropic, custom): ");
  const apiKey = await ask("  API Key: ");
  const baseUrl = await ask("  Base URL (leave empty for OpenAI default): ");
  const model = await ask(`  Model (default: gpt-4.1): `);
  const provider = await ask("  API type - openai, responses, or anthropic (default: responses): ");

  rl.close();

  const providerConfig: ProviderConfig = {
    api_key: apiKey,
    base_url: baseUrl || undefined,
    model: model || "gpt-4.1",
    provider: (provider as ProviderConfig["provider"]) || "responses",
  };

  const multi = await loadMultiConfig();
  multi.providers[name || "default"] = providerConfig;
  multi.active = name || "default";
  await saveMultiConfig(multi);

  console.log(`\n  ✓ Config saved to ${CONFIG_FILE}\n`);

  return { ...providerConfig };
}

export { CONFIG_FILE };
