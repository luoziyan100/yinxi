"""Glob tool — find files by pattern."""

import glob as globmod
import os

GLOB_TOOL = {
    "type": "function",
    "name": "glob",
    "description": (
        'Find files matching a glob pattern. E.g. "**/*.py", "src/**/*.ts". '
        "Returns matching file paths. Ignores node_modules, .git, dist, build."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": 'Glob pattern, e.g. "**/*.py".',
            },
            "path": {
                "type": "string",
                "description": "Directory to search in. Defaults to current directory.",
            },
        },
        "required": ["pattern"],
    },
}

IGNORE_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv"}


def handle_glob(pattern: str, path: str = ".", **_) -> str:
    path = os.path.expanduser(path)

    try:
        full_pattern = os.path.join(path, pattern)
        matches = globmod.glob(full_pattern, recursive=True)

        # Filter out ignored directories
        filtered = []
        for m in matches:
            parts = m.split(os.sep)
            if not any(p in IGNORE_DIRS for p in parts):
                filtered.append(m)

        if not filtered:
            return "No files found matching the pattern."

        # Limit to 200 results
        limited = filtered[:200]
        result = "\n".join(limited)
        if len(filtered) > 200:
            result += f"\n\n... and {len(filtered) - 200} more files"

        return result

    except Exception as e:
        return f"Error: {e}"
