"""
Configuration management.
Loads API key and settings from ~/.yinxi/config.json so you don't need env vars.
"""

import os
import json

CONFIG_DIR = os.path.expanduser("~/.yinxi")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

DEFAULT_CONFIG = {
    "api_key": "",
    "base_url": "",
    "model": "gpt-4.1",
}


def load_config() -> dict:
    """Load config from ~/.yinxi/config.json, merging with defaults."""
    config = dict(DEFAULT_CONFIG)

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                saved = json.load(f)
            config.update(saved)
        except Exception:
            pass

    # Env vars override config file
    if os.environ.get("OPENAI_API_KEY"):
        config["api_key"] = os.environ["OPENAI_API_KEY"]
    if os.environ.get("OPENAI_BASE_URL"):
        config["base_url"] = os.environ["OPENAI_BASE_URL"]

    return config


def save_config(config: dict) -> None:
    """Save config to ~/.yinxi/config.json."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def setup_wizard() -> dict:
    """Interactive first-time setup."""
    print("\n  Welcome to Yinxi! Let's set up your API.\n")

    api_key = input("  API Key: ").strip()
    base_url = input("  Base URL (leave empty for OpenAI default): ").strip()
    model = input(f"  Model (default: {DEFAULT_CONFIG['model']}): ").strip()

    config = {
        "api_key": api_key,
        "base_url": base_url,
        "model": model or DEFAULT_CONFIG["model"],
    }

    save_config(config)
    print(f"\n  ✓ Config saved to {CONFIG_FILE}\n")
    return config
