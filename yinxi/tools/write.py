"""Write tool — create or overwrite files."""

import os

WRITE_TOOL = {
    "type": "function",
    "name": "write",
    "description": (
        "Write content to a file. Creates the file and parent directories if they don't exist. "
        "Overwrites existing content."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute path to the file to write.",
            },
            "content": {
                "type": "string",
                "description": "The full content to write to the file.",
            },
        },
        "required": ["file_path", "content"],
    },
}


def handle_write(file_path: str, content: str, **_) -> str:
    file_path = os.path.expanduser(file_path)

    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        lines = content.count("\n") + 1
        return f"Successfully wrote {lines} lines to {file_path}"
    except Exception as e:
        return f"Error writing file: {e}"
