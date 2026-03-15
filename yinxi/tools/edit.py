"""Edit tool — exact string replacement in files."""

import os

EDIT_TOOL = {
    "type": "function",
    "name": "edit",
    "description": (
        "Perform an exact string replacement in a file. "
        "The old_string must match exactly (including whitespace/indentation) "
        "and must be unique in the file unless replace_all is true."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute path to the file to edit.",
            },
            "old_string": {
                "type": "string",
                "description": "The exact text to find and replace.",
            },
            "new_string": {
                "type": "string",
                "description": "The text to replace old_string with.",
            },
            "replace_all": {
                "type": "boolean",
                "description": "Replace all occurrences. Default: false.",
            },
        },
        "required": ["file_path", "old_string", "new_string"],
    },
}


def handle_edit(
    file_path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
    **_,
) -> str:
    file_path = os.path.expanduser(file_path)

    if not os.path.exists(file_path):
        return f"Error: File not found: {file_path}"

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return f"Error reading file: {e}"

    if old_string == new_string:
        return "Error: old_string and new_string are identical."

    if old_string not in content:
        return (
            f"Error: old_string not found in {file_path}. "
            "Make sure the string matches exactly, including whitespace and indentation."
        )

    if not replace_all:
        count = content.count(old_string)
        if count > 1:
            return (
                f"Error: old_string appears {count} times. "
                "Provide more context to make it unique, or set replace_all=true."
            )

    if replace_all:
        new_content = content.replace(old_string, new_string)
    else:
        new_content = content.replace(old_string, new_string, 1)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        return f"Successfully edited {file_path}"
    except Exception as e:
        return f"Error writing file: {e}"
