"""Grep tool — search file contents."""

import subprocess
import os

GREP_TOOL = {
    "type": "function",
    "name": "grep",
    "description": (
        "Search file contents using grep/ripgrep. Supports regex. "
        "Returns matching lines with file paths and line numbers."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Regex pattern to search for.",
            },
            "path": {
                "type": "string",
                "description": "File or directory to search in. Defaults to current directory.",
            },
            "include": {
                "type": "string",
                "description": 'File glob filter, e.g. "*.py", "*.{js,ts}".',
            },
            "case_insensitive": {
                "type": "boolean",
                "description": "Case insensitive search. Default: false.",
            },
            "max_results": {
                "type": "integer",
                "description": "Max matching lines. Default: 100.",
            },
        },
        "required": ["pattern"],
    },
}


def handle_grep(
    pattern: str,
    path: str = ".",
    include: str = "",
    case_insensitive: bool = False,
    max_results: int = 100,
    **_,
) -> str:
    path = os.path.expanduser(path)

    # Try ripgrep first, fall back to grep
    rg_available = subprocess.run(
        ["which", "rg"], capture_output=True
    ).returncode == 0

    if rg_available:
        cmd = ["rg", "--no-heading", "-n", f"-m{max_results}"]
        if case_insensitive:
            cmd.append("-i")
        if include:
            cmd.extend(["--glob", include])
        cmd.extend(["--", pattern, path])
    else:
        cmd = ["grep", "-rn"]
        if case_insensitive:
            cmd.append("-i")
        if include:
            cmd.extend(["--include", include])
        cmd.extend(["--", pattern, path])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = result.stdout.strip()
        if not output:
            return "No matches found."

        # Limit output
        lines = output.split("\n")
        if len(lines) > max_results:
            lines = lines[:max_results]
            output = "\n".join(lines) + f"\n... (limited to {max_results} results)"
        else:
            output = "\n".join(lines)

        return output

    except subprocess.TimeoutExpired:
        return "Error: Search timed out."
    except Exception as e:
        return f"Error: {e}"
