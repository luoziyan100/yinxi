"""Tool definitions and handlers for the Yinxi agent."""

from .read import READ_TOOL, handle_read
from .write import WRITE_TOOL, handle_write
from .edit import EDIT_TOOL, handle_edit
from .bash import BASH_TOOL, handle_bash
from .glob_tool import GLOB_TOOL, handle_glob
from .grep import GREP_TOOL, handle_grep

# Tool dispatch map — the core pattern from learn-claude-code
TOOLS = [READ_TOOL, WRITE_TOOL, EDIT_TOOL, BASH_TOOL, GLOB_TOOL, GREP_TOOL]

TOOL_HANDLERS = {
    "read": handle_read,
    "write": handle_write,
    "edit": handle_edit,
    "bash": handle_bash,
    "glob": handle_glob,
    "grep": handle_grep,
}
