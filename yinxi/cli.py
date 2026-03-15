"""
Yinxi CLI — interactive terminal agent.

Usage:
  yinxi                              # Interactive mode
  yinxi "fix the bug in main.py"     # One-shot mode
  yinxi -m gpt-4.1                   # Specify model
  yinxi setup                        # First-time API config
"""

import os
import sys
import argparse

from openai import OpenAI
from rich.console import Console
from rich.text import Text
from rich.panel import Panel

from .agent import agent_loop
from .prompt import build_system_prompt
from .config import load_config, setup_wizard

console = Console()


def parse_args():
    parser = argparse.ArgumentParser(
        prog="yinxi",
        description="Yinxi — AI coding agent for the terminal",
    )
    parser.add_argument("prompt", nargs="*", help="One-shot prompt or 'setup'")
    parser.add_argument(
        "-m", "--model", default=None, help="Model name (overrides config)"
    )
    parser.add_argument(
        "-k", "--api-key", default=None, help="API key (overrides config)"
    )
    parser.add_argument(
        "-b", "--base-url", default=None, help="API base URL (overrides config)"
    )
    parser.add_argument(
        "--no-stream", action="store_true", help="Disable streaming"
    )
    return parser.parse_args()


def print_banner(model: str, cwd: str):
    console.print()
    console.print(
        Panel(
            Text("⚡ Yinxi Agent ⚡", justify="center", style="bold white"),
            border_style="blue",
            width=42,
        )
    )
    console.print(Text(f"  Model: {model}", style="dim"))
    console.print(Text(f"  CWD:   {cwd}", style="dim"))
    console.print(Text('  Type "exit" or Ctrl+C to quit.', style="dim"))
    console.print(Text("  /clear /reset /history — slash commands", style="dim"))
    console.print()


def main():
    args = parse_args()

    # Handle "yinxi setup"
    if args.prompt and args.prompt[0] == "setup":
        setup_wizard()
        return

    # Load config: ~/.yinxi/config.json → env vars → CLI flags (priority: high→low)
    config = load_config()

    api_key = args.api_key or config.get("api_key")
    base_url = args.base_url or config.get("base_url")
    model = args.model or config.get("model", "gpt-4.1")

    # No API key? Run setup wizard
    if not api_key:
        console.print("[yellow]No API key found. Let's set up Yinxi.[/yellow]")
        config = setup_wizard()
        api_key = config["api_key"]
        base_url = config.get("base_url")
        model = args.model or config.get("model", "gpt-4.1")

    if not api_key:
        console.print("[red]Error:[/red] No API key configured. Run: yinxi setup")
        sys.exit(1)

    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url

    client = OpenAI(**client_kwargs)
    cwd = os.getcwd()
    system_prompt = build_system_prompt(cwd)
    stream = not args.no_stream

    # Conversation history
    messages: list = []

    # One-shot mode
    if args.prompt:
        user_text = " ".join(args.prompt)
        messages.append({"role": "user", "content": user_text})
        agent_loop(client, model, messages, system_prompt, stream=stream)
        return

    # Interactive mode
    print_banner(model, cwd)

    while True:
        try:
            console.print(Text("\n❯ ", style="bold green"), end="")
            user_input = input().strip()
        except (KeyboardInterrupt, EOFError):
            console.print("\n\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("exit", "quit"):
            console.print("\nGoodbye!")
            break

        if user_input == "/clear":
            os.system("clear")
            print_banner(model, cwd)
            continue

        if user_input == "/history":
            console.print(f"\n  Conversation: {len(messages)} messages")
            continue

        if user_input == "/reset":
            messages.clear()
            console.print("\n  Conversation reset.")
            continue

        if user_input == "/model":
            console.print(f"\n  Current model: {model}")
            continue

        # Add user message and run agent loop
        messages.append({"role": "user", "content": user_input})

        try:
            agent_loop(client, model, messages, system_prompt, stream=stream)
        except KeyboardInterrupt:
            console.print("\n  [yellow]Interrupted.[/yellow]")
        except Exception as e:
            console.print(f"\n  [red]Error: {e}[/red]")


if __name__ == "__main__":
    main()
