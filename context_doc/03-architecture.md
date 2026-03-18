# TypeScript 版架构

## 目录结构

```
/Users/zihao/Workspace/Projects/agent/
├── src/
│   ├── index.ts            # 入口：CLI 解析、交互循环、Ctrl+C 处理
│   ├── agent.ts            # Agent 类：核心 agent loop、abort 支持
│   ├── provider.ts         # LLM Provider：Anthropic + OpenAI 双后端
│   ├── config.ts           # 配置管理：~/.yinxi/config.json + setup wizard
│   ├── permissions.ts      # 权限系统：危险命令确认
│   ├── system-prompt.ts    # 动态 system prompt（含 git + 项目文件）
│   ├── context.ts          # Context window 管理（token 估算 + 截断）
│   ├── git.ts              # Git 信息检测
│   ├── project-file.ts     # YINXI.md 项目文件加载
│   ├── types.ts            # 类型定义
│   ├── types/
│   │   └── marked-terminal.d.ts  # 第三方类型声明
│   ├── tools/
│   │   ├── index.ts        # 工具注册
│   │   ├── read.ts         # 读文件（带行号）
│   │   ├── write.ts        # 写文件（创建/覆盖）
│   │   ├── edit.ts         # 精确字符串替换
│   │   ├── bash.ts         # 执行 shell 命令（含权限检查）
│   │   ├── glob.ts         # 文件名模式匹配
│   │   └── grep.ts         # 文件内容搜索（ripgrep）
│   └── ui/
│       └── terminal.ts     # 终端渲染（Markdown、工具状态）
├── dist/                   # 编译输出
├── package.json
├── tsconfig.json
├── yinxi/                  # Python 版（独立项目）
└── context_doc/            # 项目文档
```

## 核心流程

```
用户输入
  ↓
Agent.prompt(message)
  ↓
runLoop():
  ├── streamResponse(config, messages, signal)  ← LLM 流式响应
  │     ├── streamAnthropic()  或  streamOpenAI()
  │     └── yield AgentEvent（text_delta / tool_use_start / ...）
  ├── parseStreamedContent(events)  ← 解析为结构化 blocks
  ├── 提取 ToolUseBlock[]
  ├── 如果没有 tool calls → 结束
  ├── 执行每个 tool（含权限检查）
  ├── 收集 ToolResultBlock[]
  └── 追加到 messages，回到循环顶部
```

## 事件系统

Agent 通过 `subscribe(listener)` 注册事件监听器，UI 层订阅这些事件实时渲染：

| 事件 | 说明 |
|------|------|
| `text_delta` | LLM 文本输出片段 |
| `thinking_delta` | 扩展思维片段（Anthropic） |
| `tool_use_start` | 工具调用开始 |
| `tool_use_input_delta` | 工具输入参数片段 |
| `tool_result` | 工具执行结果 |
| `turn_end` | 一轮结束 |
| `error` | 错误 |

## 消息格式（Universal Format）

统一的消息格式，通过 provider.ts 转换为 Anthropic 或 OpenAI 格式：

- `UserMessage { role: "user", content: string }`
- `AssistantMessage { role: "assistant", content: AssistantContent[] }`
  - `TextBlock { type: "text", text }`
  - `ThinkingBlock { type: "thinking", thinking }`
  - `ToolUseBlock { type: "tool_use", id, name, input }`
- `ToolResultMessage { role: "user", content: ToolResultBlock[] }`

## 双 Provider 支持

| | Anthropic | OpenAI |
|---|---|---|
| SDK | `@anthropic-ai/sdk` | `openai` |
| System Prompt | `system` 参数 | system 角色消息 |
| 工具格式 | `input_schema` | `function.parameters` |
| 流式事件 | `content_block_start/delta` | `choice.delta` |
| 扩展思维 | 支持 | 不支持 |
| Tool Result | `tool_result` content block | `tool` 角色消息 |
