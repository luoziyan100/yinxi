# Claude Code - 命令系统与 Agent 系统

## 命令系统 (Commands)

斜杠命令 (`/command-name`) 是可复用的 Markdown 提示，Claude 在会话中执行。

### 命令格式
Markdown + YAML frontmatter：

```markdown
---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: Create a git commit
model: sonnet
argument-hint: "commit message"
---

## Context
- Current git status: !`git status`
- Current git diff: !`git diff HEAD`

## Your task
Based on the above changes, create a single git commit.
```

### YAML Frontmatter 字段
| 字段 | 用途 |
|------|------|
| `description` | 简要帮助文本 |
| `allowed-tools` | 工具限制 (如 `Bash(git:*)`, `Read, Write`) |
| `model` | 模型覆盖 (haiku, sonnet, opus) |
| `argument-hint` | 参数提示（自动补全用） |
| `disable-model-invocation` | 禁止编程调用 |

### 动态参数
- `$ARGUMENTS` - 整个参数字符串
- `$1`, `$2`, `$3` - 位置参数
- `@$1` - 文件引用（自动读取）
- `@path/to/file.ts` - 静态文件引用
- `` !`command` `` - 内联 Bash 执行（在 Claude 处理前运行）

### 命令发现路径
- `.claude/commands/` (项目级)
- `~/.claude/commands/` (用户级)
- `plugin/commands/` (插件)
- 子目录支持命名空间

## Agent 系统

专业化 AI Agent，有特定专长，用于聚焦任务。

### Agent 定义格式
```markdown
---
name: code-explorer
description: Deeply analyzes existing codebase features...
tools: Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch
model: sonnet
color: yellow
---

## Core Mission
Provide complete understanding of how a specific feature works...

## Analysis Approach
1. Feature Discovery
2. Code Flow Tracing
3. Architecture Analysis
```

### Agent 关键属性
| 属性 | 用途 |
|------|------|
| `name` | 唯一标识符，Task 工具调用用 |
| `tools` | 精确的可用工具集（不继承默认） |
| `model` | 可覆盖默认模型 |
| `color` | 终端 UI 指示色 |

### 并行 Agent 编排示例 (feature-dev 插件)

```
/feature-dev Add OAuth authentication

Phase 2 - 探索:
  ├─ code-explorer × 3 (并行)
  │  ├─ Agent 1: 类似功能分析
  │  ├─ Agent 2: 架构映射
  │  └─ Agent 3: 相关实现分析
  └─ 合并结果 → 读取关键文件

Phase 4 - 架构:
  ├─ code-architect × 3 (并行)
  │  ├─ 方案 1: 最小改动（最大复用）
  │  ├─ 方案 2: 干净架构
  │  └─ 方案 3: 务实平衡
  └─ 呈现对比 → 用户选择

Phase 6 - 质量审查:
  ├─ code-reviewer × 3 (并行)
  │  ├─ 审查 1: 简洁性/DRY/优雅
  │  ├─ 审查 2: Bug/正确性
  │  └─ 审查 3: 规范/抽象
  └─ 合并发现 → 用户决定
```
