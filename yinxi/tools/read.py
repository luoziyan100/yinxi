"""Read tool — read file contents with line numbers."""

import os

READ_TOOL = {
    "type": "function",
    "name": "read",
    "description": (
        "Read the contents of a file. Returns content with line numbers. "
        "Use offset and limit for large files. "
        "The file_path must be an absolute path."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute path to the file to read.",
            },
            "offset": {
                "type": "integer",
                "description": "Line number to start reading from (1-based). Default: 1.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of lines to read. Default: 2000.",
            },
        },
        "required": ["file_path"],
    },
}


def handle_read(
    file_path: str, offset: int = 1, limit: int = 2000, **_
) -> str:
    file_path = os.path.expanduser(file_path)

    if not os.path.exists(file_path):
        return f"Error: File not found: {file_path}"

    if os.path.isdir(file_path):
        return f"Error: {file_path} is a directory. Use bash with 'ls' to list contents."

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
    except Exception as e:
        return f"Error reading file: {e}"

    total = len(all_lines)
    start = max(0, offset - 1)
    end = min(total, start + limit)
    selected = all_lines[start:end]

    # Format with line numbers
    lines_out = []
    for i, line in enumerate(selected):
        line_num = start + i + 1
        # Truncate long lines
        text = line.rstrip("\n")
        if len(text) > 2000:
            text = text[:2000] + "..."
        lines_out.append(f"{line_num:>6}\t{text}")

    header = ""
    if start > 0 or end < total:
        header = f"[Showing lines {start + 1}-{end} of {total}]\n"

    return header + "\n".join(lines_out)
