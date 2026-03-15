"""Bash tool — execute shell commands."""

import subprocess

BASH_TOOL = {
    "type": "function",
    "name": "bash",
    "description": (
        "Execute a bash command and return stdout + stderr. "
        "Use for running builds, tests, git commands, listing directories, etc. "
        "Default timeout: 120 seconds."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The bash command to execute.",
            },
            "timeout": {
                "type": "integer",
                "description": "Timeout in seconds. Default: 120, max: 600.",
            },
        },
        "required": ["command"],
    },
}

MAX_OUTPUT = 100_000  # 100KB


def handle_bash(command: str, timeout: int = 120, **_) -> str:
    timeout = min(timeout, 600)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=None,  # inherit from caller
            env=None,  # inherit env
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr

        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + "\n... [output truncated]"

        if not output.strip():
            output = "(no output)"

        if result.returncode != 0:
            output = f"[exit code: {result.returncode}]\n{output}"

        return output

    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout}s"
    except Exception as e:
        return f"Error executing command: {e}"
