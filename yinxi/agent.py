"""
Agent loop — the core engine.

This follows the learn-claude-code pattern:
  while True:
      response = LLM(messages, tools)
      if no tool calls → return
      execute tools → append results → loop

The loop is the invariant. Everything else layers on top.
"""

import json
from openai import OpenAI
from rich.console import Console
from rich.text import Text
from rich.panel import Panel
from rich.markdown import Markdown

from .tools import TOOLS, TOOL_HANDLERS
from .prompt import build_system_prompt

console = Console()


def agent_loop(
    client: OpenAI,
    model: str,
    messages: list,
    system_prompt: str,
    max_tokens: int = 16384,
    stream: bool = True,
) -> None:
    """
    The core agent loop. Runs until the model stops calling tools.

    messages: conversation history (mutated in place)
    """
    while True:
        if stream:
            response = _stream_response(
                client, model, messages, system_prompt, max_tokens
            )
        else:
            response = _simple_response(
                client, model, messages, system_prompt, max_tokens
            )

        # Extract function calls from response output
        function_calls = [
            item for item in response.output if item.type == "function_call"
        ]

        # If no tool calls, we're done — add text output to messages
        if not function_calls:
            # Store assistant text in messages for conversation history
            for item in response.output:
                if item.type == "message":
                    for part in item.content:
                        if hasattr(part, "text"):
                            messages.append({"role": "assistant", "content": part.text})
            return

        # Responses API: we must include the assistant's output items
        # (including function_call items) in the next input, then add
        # function_call_output items after them.
        for item in response.output:
            if item.type == "function_call":
                messages.append(item.to_dict())
            elif item.type == "message":
                messages.append(item.to_dict())

        # Execute each tool call and append results
        for fc in function_calls:
            tool_name = fc.name
            try:
                args = json.loads(fc.arguments)
            except json.JSONDecodeError:
                args = {}

            handler = TOOL_HANDLERS.get(tool_name)
            if handler is None:
                result_text = f"Error: Unknown tool '{tool_name}'"
                _print_tool_error(tool_name, result_text)
            else:
                _print_tool_start(tool_name, args)
                result_text = handler(**args)
                _print_tool_result(tool_name, result_text)

            messages.append(
                {
                    "type": "function_call_output",
                    "call_id": fc.call_id,
                    "output": result_text,
                }
            )

        # Loop continues — LLM sees tool results and responds


def _simple_response(client, model, messages, system_prompt, max_tokens):
    """Non-streaming LLM call."""
    return client.responses.create(
        model=model,
        instructions=system_prompt,
        input=messages,
        tools=TOOLS,
        max_output_tokens=max_tokens,
    )


def _stream_response(client, model, messages, system_prompt, max_tokens):
    """Streaming LLM call with real-time output."""
    stream = client.responses.create(
        model=model,
        instructions=system_prompt,
        input=messages,
        tools=TOOLS,
        max_output_tokens=max_tokens,
        stream=True,
    )

    # We need to collect the full response while streaming text to terminal
    full_text = ""
    started_text = False

    for event in stream:
        if event.type == "response.output_text.delta":
            if not started_text:
                started_text = True
                console.print()  # blank line before response
            console.print(event.delta, end="", highlight=False)
            full_text += event.delta
        elif event.type == "response.completed":
            if started_text:
                console.print()  # newline after streaming
            return event.response

    # Shouldn't reach here, but handle gracefully
    return None


# ── UI Helpers ──


def _print_tool_start(name: str, args: dict) -> None:
    """Print tool invocation in a compact format."""
    summary = _format_tool_args(name, args)
    console.print(
        Text(f"  ⚡ {name} ", style="bold cyan") + Text(summary, style="dim")
    )


def _format_tool_args(name: str, args: dict) -> str:
    """Format tool args as a one-line summary."""
    if name == "read":
        return _trunc(args.get("file_path", ""), 80)
    elif name == "write":
        return _trunc(args.get("file_path", ""), 80)
    elif name == "edit":
        return _trunc(args.get("file_path", ""), 80)
    elif name == "bash":
        return _trunc(args.get("command", ""), 80)
    elif name == "glob":
        return _trunc(args.get("pattern", ""), 80)
    elif name == "grep":
        p = args.get("pattern", "")
        path = args.get("path", "")
        return _trunc(f"{p}" + (f" in {path}" if path else ""), 80)
    return _trunc(json.dumps(args), 80)


def _print_tool_result(name: str, result: str) -> None:
    """Print tool result summary."""
    is_error = result.startswith("Error")
    if is_error:
        console.print(Text(f"    ✗ {_trunc(result, 120)}", style="red"))
    else:
        lines = result.count("\n") + 1
        size = len(result)
        if size > 200:
            summary = f"{lines} lines"
        else:
            summary = _trunc(result, 100)
        console.print(Text(f"    ✓ ", style="green") + Text(summary, style="dim"))


def _print_tool_error(name: str, error: str) -> None:
    console.print(Text(f"  ✗ {name}: {error}", style="bold red"))


def _trunc(s: str, max_len: int) -> str:
    s = s.replace("\n", " ")
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."
