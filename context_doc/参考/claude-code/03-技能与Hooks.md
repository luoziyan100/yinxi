# Claude Code - 技能系统与 Hooks

## 技能系统 (Skills)

模块化、可复用的知识包，按需加载。

### 技能结构
```
skill-name/
├── SKILL.md (150-200 行，必须)
│   ├── YAML 元数据（名称、描述含触发短语、版本）
│   └── Markdown 指令（目标 1,500-2,000 词）
├── references/ (可选，详细内容)
├── scripts/ (可选，可执行代码)
└── assets/ (可选，输出资源)
```

### 渐进式加载（核心设计）
```
Level 1: 元数据始终在上下文中（触发检测）
Level 2: SKILL.md 正文在技能激活时加载
Level 3: references/scripts 按 Claude 判断按需加载
```

### 技能元数据示例
```yaml
---
name: Command Development
description: This skill should be used when the user asks to
  "create a slash command", "add a command", "write a custom command",
  "define command arguments", "use command frontmatter"...
version: 0.2.0
---
```

**触发机制**: 描述中的关键词匹配用户请求 → 自动加载

## Hooks 系统

事件驱动的自动化，在 Claude Code 事件响应时执行。

### 支持的 Hook 事件
| 事件 | 触发时机 | 用途 |
|------|---------|------|
| `PreToolUse` | 工具执行前 | 验证/拒绝/修改 |
| `PostToolUse` | 工具完成后 | 反应/日志/反馈 |
| `Stop` | 主 Agent 退出时 | 验证完成度 |
| `SubagentStop` | 子 Agent 退出时 | 同上 |
| `SessionStart` | 会话开始 | 加载上下文 |
| `SessionEnd` | 会话关闭 | 清理 |
| `UserPromptSubmit` | 处理用户输入前 | 预处理 |
| `PreCompact` | 压缩对话前 | 修改 |

### Hook 配置格式
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/handler.py",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Hook 类型

**1. Prompt-Based（推荐，上下文感知）**
```json
{
  "type": "prompt",
  "prompt": "Evaluate if this tool use is appropriate: $TOOL_INPUT",
  "timeout": 30
}
```

**2. Command（确定性检查）**
```json
{
  "type": "command",
  "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/validate.py",
  "timeout": 60
}
```

### Hook 输入/输出

**输入** (JSON via stdin):
```json
{
  "session_id": "...",
  "tool_name": "Edit",
  "tool_input": { "file_path": "src/app.ts", "new_string": "..." }
}
```

**输出** (JSON to stdout):
```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": {"field": "value"}
  },
  "systemMessage": "Explanation to pass to Claude"
}
```

**退出码**:
- `0`: 允许/继续
- `2`: 阻止/拒绝（stderr 反馈给 Claude）

### 安全 Hook 实践示例
```python
# security_reminder_hook.py
# 检测 9 种安全模式：
# - GitHub Actions workflow 注入
# - child_process.exec() 命令注入
# - eval(), new Function()
# - dangerouslySetInnerHTML, innerHTML
# - pickle 反序列化, os.system
#
# 每会话跟踪已显示警告，避免重复
# 旧状态文件 >30 天自动清理
```

## MCP 集成

外部工具提供者，通过 Model Context Protocol 扩展能力。

### 服务器类型
```json
// Stdio（直接进程通信）
{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }

// HTTP
{ "url": "http://localhost:3000" }

// SSE（Server-Sent Events）
{ "url": "https://api.example.com/mcp" }
```

### 变量支持
- `${CLAUDE_PLUGIN_ROOT}` - 插件目录（跨系统可移植）
- `${CLAUDE_PROJECT_DIR}` - 项目根目录

## 权限模型

### 层级
1. **Managed Settings**（最高优先级）: 组织强制执行
2. **User Settings**: `.claude/settings.json`
3. **Command Settings**: 命令 frontmatter 的 `allowed-tools`
4. **Defaults**: 工具默认可用除非限制

### 设置示例
```json
{
  "permissions": {
    "ask": ["Bash", "WebSearch"],
    "allow": ["Read", "Write"],
    "deny": ["WebFetch"]
  },
  "sandbox": {
    "network": {
      "allowedDomains": ["api.github.com"]
    }
  }
}
```
