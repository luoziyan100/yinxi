/**
 * Tests for config.ts — multi-provider configuration management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// We need to test the module with controlled filesystem access.
// Import the functions under test.
import {
  loadConfig,
  loadMultiConfig,
  saveMultiConfig,
  saveConfig,
  switchProvider,
  listProviders,
  applyEnvOverrides,
  type ProviderConfig,
  type YinxiConfig,
} from "./config.js";

const CONFIG_DIR = path.join(os.homedir(), ".yinxi");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Save/restore the real config file
let originalConfig: string | null = null;

beforeEach(async () => {
  try {
    originalConfig = await fs.readFile(CONFIG_FILE, "utf-8");
  } catch {
    originalConfig = null;
  }
});

afterEach(async () => {
  // Restore original config
  if (originalConfig !== null) {
    await fs.writeFile(CONFIG_FILE, originalConfig, "utf-8");
  } else {
    try {
      await fs.unlink(CONFIG_FILE);
    } catch {
      // File didn't exist, that's fine
    }
  }

  // Clean up env vars
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.YINXI_MODEL;
  delete process.env.YINXI_PROVIDER;
});

describe("applyEnvOverrides", () => {
  it("returns config unchanged when no env vars are set", () => {
    const config: ProviderConfig = {
      api_key: "test-key",
      model: "gpt-4.1",
      provider: "responses",
    };
    const result = applyEnvOverrides(config);
    expect(result).toEqual(config);
    // Should return a new object, not mutate
    expect(result).not.toBe(config);
  });

  it("uses OPENAI_API_KEY for non-claude models", () => {
    process.env.OPENAI_API_KEY = "env-openai-key";
    const result = applyEnvOverrides({
      api_key: "file-key",
      model: "gpt-4.1",
      provider: "responses",
    });
    expect(result.api_key).toBe("env-openai-key");
  });

  it("uses ANTHROPIC_API_KEY for claude models", () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
    const result = applyEnvOverrides({
      api_key: "file-key",
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
    expect(result.api_key).toBe("env-anthropic-key");
  });

  it("falls back to any available key when config has no key", () => {
    process.env.OPENAI_API_KEY = "env-openai-key";
    const result = applyEnvOverrides({
      api_key: "",
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });
    // No ANTHROPIC_API_KEY, falls back to OPENAI_API_KEY
    expect(result.api_key).toBe("env-openai-key");
  });

  it("YINXI_MODEL overrides model", () => {
    process.env.YINXI_MODEL = "custom-model";
    const result = applyEnvOverrides({
      api_key: "key",
      model: "gpt-4.1",
      provider: "responses",
    });
    expect(result.model).toBe("custom-model");
  });

  it("YINXI_PROVIDER overrides provider", () => {
    process.env.YINXI_PROVIDER = "openai";
    const result = applyEnvOverrides({
      api_key: "key",
      model: "gpt-4.1",
      provider: "responses",
    });
    expect(result.provider).toBe("openai");
  });

  it("auto-detects anthropic provider for claude models", () => {
    const result = applyEnvOverrides({
      api_key: "key",
      model: "claude-opus-4-6",
      provider: "responses",
    });
    expect(result.provider).toBe("anthropic");
  });

  it("OPENAI_BASE_URL overrides base_url", () => {
    process.env.OPENAI_BASE_URL = "https://custom.api.com";
    const result = applyEnvOverrides({
      api_key: "key",
      model: "gpt-4.1",
      provider: "responses",
    });
    expect(result.base_url).toBe("https://custom.api.com");
  });
});

describe("migrateOldConfig (via loadMultiConfig)", () => {
  it("migrates old single-provider config to multi-provider format", async () => {
    const oldConfig = {
      api_key: "old-key",
      base_url: "https://api.example.com",
      model: "gpt-4.1",
      provider: "responses",
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(oldConfig), "utf-8");

    const multi = await loadMultiConfig();
    expect(multi.active).toBe("default");
    expect(multi.providers.default).toBeDefined();
    expect(multi.providers.default.api_key).toBe("old-key");
    expect(multi.providers.default.model).toBe("gpt-4.1");
  });

  it("migrates xuedingtoken base_url to named provider", async () => {
    const oldConfig = {
      api_key: "xd-key",
      base_url: "https://api.xuedingtoken.com/v1",
      model: "gpt-4.1",
      provider: "responses",
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(oldConfig), "utf-8");

    const multi = await loadMultiConfig();
    expect(multi.active).toBe("xuedingtoken");
    expect(multi.providers.xuedingtoken).toBeDefined();
  });

  it("passes through already-migrated config", async () => {
    const newConfig: YinxiConfig = {
      active: "myProvider",
      providers: {
        myProvider: {
          api_key: "new-key",
          model: "gpt-4.1",
          provider: "responses",
        },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig), "utf-8");

    const multi = await loadMultiConfig();
    expect(multi.active).toBe("myProvider");
    expect(multi.providers.myProvider.api_key).toBe("new-key");
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", async () => {
    try { await fs.unlink(CONFIG_FILE); } catch { /* ok */ }

    const config = await loadConfig();
    expect(config.model).toBe("gpt-4.1");
    expect(config.provider).toBe("responses");
  });

  it("reads active provider from multi-config", async () => {
    const multiConfig: YinxiConfig = {
      active: "prod",
      providers: {
        prod: {
          api_key: "prod-key",
          model: "gpt-4.1-mini",
          provider: "openai",
          base_url: "https://prod.api.com",
        },
        dev: {
          api_key: "dev-key",
          model: "gpt-4.1",
          provider: "responses",
        },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    const config = await loadConfig();
    expect(config.api_key).toBe("prod-key");
    expect(config.model).toBe("gpt-4.1-mini");
    expect(config.provider).toBe("openai");
  });

  it("applies env var overrides", async () => {
    const multiConfig: YinxiConfig = {
      active: "default",
      providers: {
        default: {
          api_key: "file-key",
          model: "gpt-4.1",
          provider: "responses",
        },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    process.env.OPENAI_API_KEY = "env-key";
    const config = await loadConfig();
    expect(config.api_key).toBe("env-key");
  });
});

describe("switchProvider", () => {
  it("switches to an existing provider", async () => {
    const multiConfig: YinxiConfig = {
      active: "a",
      providers: {
        a: { api_key: "key-a", model: "gpt-4.1", provider: "responses" },
        b: { api_key: "key-b", model: "claude-sonnet-4-20250514", provider: "anthropic" },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    const result = await switchProvider("b");
    expect(result).not.toBeNull();
    expect(result!.api_key).toBe("key-b");
    expect(result!.model).toBe("claude-sonnet-4-20250514");
    expect(result!.provider).toBe("anthropic");

    // Verify persistence
    const multi = await loadMultiConfig();
    expect(multi.active).toBe("b");
  });

  it("returns null for non-existent provider", async () => {
    const multiConfig: YinxiConfig = {
      active: "a",
      providers: {
        a: { api_key: "key-a", model: "gpt-4.1", provider: "responses" },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    const result = await switchProvider("nonexistent");
    expect(result).toBeNull();

    // Active should not change
    const multi = await loadMultiConfig();
    expect(multi.active).toBe("a");
  });

  it("applies env var overrides to switched provider", async () => {
    const multiConfig: YinxiConfig = {
      active: "a",
      providers: {
        a: { api_key: "key-a", model: "gpt-4.1", provider: "responses" },
        b: { api_key: "", model: "gpt-4.1-mini", provider: "responses" },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    process.env.OPENAI_API_KEY = "env-key";
    const result = await switchProvider("b");
    expect(result).not.toBeNull();
    expect(result!.api_key).toBe("env-key");
  });
});

describe("listProviders", () => {
  it("returns empty list when no providers configured", async () => {
    try { await fs.unlink(CONFIG_FILE); } catch { /* ok */ }

    const providers = await listProviders();
    expect(providers).toEqual([]);
  });

  it("lists all providers with active flag", async () => {
    const multiConfig: YinxiConfig = {
      active: "prod",
      providers: {
        prod: { api_key: "key-1", model: "gpt-4.1", provider: "responses" },
        dev: { api_key: "key-2", model: "gpt-4.1-mini", provider: "openai" },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    const providers = await listProviders();
    expect(providers).toHaveLength(2);

    const prod = providers.find(p => p.name === "prod");
    expect(prod?.active).toBe(true);

    const dev = providers.find(p => p.name === "dev");
    expect(dev?.active).toBe(false);
  });
});

describe("saveConfig", () => {
  it("saves to the active provider slot without clobbering others", async () => {
    const multiConfig: YinxiConfig = {
      active: "main",
      providers: {
        main: { api_key: "old-key", model: "gpt-4.1", provider: "responses" },
        backup: { api_key: "backup-key", model: "gpt-4.1-mini", provider: "openai" },
      },
    };
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(multiConfig), "utf-8");

    await saveConfig({
      api_key: "new-key",
      model: "gpt-4.1",
      provider: "responses",
    });

    const multi = await loadMultiConfig();
    expect(multi.providers.main.api_key).toBe("new-key");
    expect(multi.providers.backup.api_key).toBe("backup-key"); // Untouched
  });
});
