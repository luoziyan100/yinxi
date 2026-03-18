# 改动记录

## 2026-03-17：UI/UX 全面升级

**改动范围**：

- `src/ui/terminal.ts` — 完全重写：
  - 添加 **动画 spinner**（braille 点阵），thinking 和 tool 执行期间都有旋转动画
  - **工具调用 box 渲染**：┌/│/└ 边框包裹，显示图标 + 工具名 + 参数摘要 + 耗时
  - **工具结果智能格式化**：每种工具有专门的结果展示逻辑（Read 显示行数，Bash 显示前4后2行输出，Grep 显示前几条匹配，Edit 显示行号和变化）
  - **Thinking 边框**：showThinking 模式下用 ╭/│/╰ 边框显示思考过程
  - 路径自动缩短（HOME → ~）
  - 截断用 `…` 而非 `...`
  - 改进 Markdown 渲染器配置（reflowText、code styling、width 限制）
  - 改进 spinner 颜色：每种工具有独立颜色

- `src/index.ts` — UI 一致性改进：
  - `/help` 命令输出重排：表格式对齐 + 分隔线
  - `/usage` 命令输出：右对齐数字 + 分隔线
  - 退出摘要：单行紧凑格式（tokens · cost · time · files）
  - 移除重复的 multi-line input 提示
  - Banner 改进：info bar 简化，help hint 更清晰

## 2026-03-16：系统提示词架构重构（参照 Claude Code 提示词设计）

**背景**：研究了 Claude Code 的完整系统提示词架构（247 个 markdown 片段），发现其提示词设计有几个核心特征：
1. 模块化分段结构（System → Doing tasks → Executing actions with care → Using tools → Output efficiency）
2. 工具描述不仅是 API 说明，更是行为规则的载体（包含"什么时候用"和"什么时候不用"）
3. 约束前置 + 理由后置（先说 NEVER do X，再解释 why）
4. 系统提示与工具描述之间通过交叉引用形成闭环

**改动范围**：

- `src/system-prompt.ts` — 完全重写，从单一扁平结构改为 7 段模块化架构：
  - System section（身份 + 环境）
  - Doing tasks（行为约束 + 避免过度工程化）
  - Executing actions with care（可逆性 + 爆炸半径框架）
  - Using tools（跨工具行为规则，形成工具间闭环引用）
  - Output efficiency（沟通风格）
  - Safety（安全约束）
  - User commands（可用命令列表）

- `src/tools/bash.ts` — 描述增加"什么时候不用 Bash"的完整列表
- `src/tools/read.ts` — 描述增加"必须先 Read 再 Edit"规则和并行读取提示
- `src/tools/write.ts` — 描述增加"ALWAYS prefer Edit"和"NEVER create docs"规则
- `src/tools/edit.ts` — 描述增加缩进保持、唯一性、read-before-edit 规则
- `src/tools/glob.ts` — 描述增加"open-ended search 用 Agent"的路由规则
- `src/tools/grep.ts` — 描述增加"ALWAYS use Grep, NEVER via Bash"规则
- `src/tools/agent.ts` — 描述增加"When NOT to use"反向指引
- `src/tools/fetch.ts` — 描述增加"Do NOT generate/guess URLs"约束
- `src/compaction.ts` — 总结提示改为 Claude Code 的 5 段结构化格式（Task Overview / Current State / Important Discoveries / Next Steps / Context to Preserve）

## 2026-03-15：项目重命名 kode → yinxi

**原因**：kode 名称已被占用

**改动范围**：

TypeScript 侧：
- `package.json` / `package-lock.json` — name 和 bin 从 `kode` → `yinxi`
- `src/index.ts` — 帮助文本、CLI 用法示例、错误提示
- `src/system-prompt.ts` — agent 名称 "You are Yinxi"
- `src/types.ts` — 注释
- `src/ui/terminal.ts` — banner "Yinxi Agent"

Python 侧：
- 目录重命名：`kode/` → `yinxi/`，`kode/kode/` → `yinxi/yinxi/`
- `pyproject.toml` — package name 和 script entry point
- `main.py` — import 路径
- 所有源文件中的 "Kode" → "Yinxi"
- 配置目录 `~/.kode/` → `~/.yinxi/`
- 卸载旧的 `uv tool uninstall kode`，重装 `uv tool install .`
- 复制旧配置 `~/.kode/config.json` → `~/.yinxi/config.json`

GitHub：
- 创建公开仓库 https://github.com/luoziyan100/yinxi
- 推送 Python 版初始 commit

---

## 2026-03-15：P0 + P1 功能实现（TypeScript 版）

### P0：配置持久化 + Setup Wizard
- 新增 `src/config.ts`
- 配置文件：`~/.yinxi/config.json`
- 存储：api_key、base_url、model、provider
- 优先级：CLI 参数 > 环境变量 > 配置文件 > 默认值
- `yinxi setup` 命令启动交互式配置
- 首次运行无 API key 时自动触发 setup

### P0：Ctrl+C 中断支持
- Agent 类新增 `abort()` 方法 + `AbortController`
- `AbortSignal` 传递到 provider 流式层
- 空闲时 Ctrl+C = 退出程序
- 运行中 Ctrl+C = 中断当前请求，回到输入提示
- Anthropic: `stream.abort()` 中断
- OpenAI: 循环中检查 `signal.aborted` 退出

### P1：权限确认机制
- 新增 `src/permissions.ts`
- 检测危险 bash 命令模式：
  - `rm -rf` / `rm --force`
  - `git push --force` / `git reset --hard` / `git clean -f`
  - `drop table` / `truncate table`
  - `kill -9` / `sudo` / `mkfs` / `dd if=`
- Bash 工具执行前自动检查，匹配到危险模式时提示用户确认（y/n）
- 用户拒绝则返回 "Command denied by user."

### P1：Markdown 渲染
- 安装 `marked` + `marked-terminal` 依赖
- 新增 `src/types/marked-terminal.d.ts` 类型声明
- UI 层文本输出改为缓冲模式：
  - `text_delta` 事件累积到 `textBuffer`
  - 在 `turn_end` 或 `tool_use_start` 时统一调用 `renderMarkdown()` 输出
- 效果：代码块语法高亮、标题/列表/表格格式化

### 其他改进
- 新增 `/reset` 命令（清空对话历史）
- 新增 `/model` 命令（显示当前模型）
- Agent 类新增 `clearMessages()` 方法
- 帮助文本增加 `yinxi setup` 说明
- 更新 banner 增加 slash commands 提示

---

## 2026-03-15：P1 Context Window + P2 功能实现（TypeScript 版）

### P1：Context Window 管理
- 新增 `src/context.ts`
- Token 估算（英文 ~4 chars/token，中文 ~2 chars/token）
- 内置主流模型 context window 限制（GPT-4.1 1M、Claude 200K 等）
- 到达 85% 容量时自动截断：
  - 保留第一条消息和最近 6 条消息
  - 从中间移除最旧的消息
  - 长工具结果（>2000 字符）截断为首尾各 500 字符
  - 插入系统提示告知移除了多少消息
- 每次 `prompt()` 和工具执行后自动检查

### P2：Git 感知
- 新增 `src/git.ts`
- 启动时自动检测：是否 git repo、当前分支、未提交修改、远程 URL
- 信息注入 system prompt 的 "Current Environment" 部分

### P2：项目文件支持（YINXI.md）
- 新增 `src/project-file.ts`
- 启动时搜索 `YINXI.md` / `yinxi.md` / `.yinxi.md`
- 从当前目录向上搜索最多 5 层
- 内容追加到 system prompt 的 "Project Instructions" 部分
- 类似 Claude Code 的 `CLAUDE.md` 机制

### P2：Token / Cost 追踪
- `types.ts` 新增 `TokenUsage` 接口
- `turn_end` 事件携带 `usage` 信息
- Provider 层从 Anthropic / OpenAI API 响应中提取实际 token 用量
- Agent 类累计整个会话的 input/output tokens
- 新增 `/usage` 命令显示会话 token 用量

### 其他改进
- `buildSystemPrompt()` 改为 async（需要读项目文件）
- Banner 增加 `/usage` 命令提示

---

## 2026-03-16：结构性优化（基于 Agent 骨架分析）

基于对 6 个参考项目（Codex、Claude Code、Pi-mono、Learn CC、AI Agents From Scratch）的深度结构分析，按骨架优先级实施了以下优化。

### 骨头 1 - 环的控制机构

**并行工具执行** (`agent.ts`)
- 当 LLM 一次返回多个 tool_use 时，使用 `Promise.all` 并行执行
- 单个工具时仍顺序执行（无额外开销）
- 参考来源：Codex FuturesOrdered、Claude Code 并行 Agent

**自动重试 + 指数退避** (`provider.ts`)
- 检测可重试错误：429 rate limit、500/502/503 服务器错误、overloaded、timeout
- 最多重试 3 次，指数退避 2s→4s→8s（上限 60s），加 ±25% 抖动
- 重试期间 UI 显示 retry 状态
- 参考来源：Pi-mono 错误恢复机制

**上下文溢出恢复** (`agent.ts`)
- 当 API 返回 context overflow 错误时，自动压缩并重试（仅一次）
- 避免无限循环：`overflowRecoveryAttempted` 标记
- 参考来源：Pi-mono isContextOverflow 恢复

### 骨头 2 - 消息（状态载体）

**会话持久化 JSONL** (`session.ts` 新增)
- 会话保存到 `~/.yinxi/sessions/{id}.jsonl`
- 每条消息（user/assistant/tool_result）实时追加
- 支持创建、加载、列表、继续最近会话
- CLI 新增 `--continue` / `--session <id>` 参数
- 新增 `/sessions` 命令列表最近会话
- 参考来源：Pi-mono JSONL 持久化

### 骨头 3 - 工具（行动边界）

**Bash 工具重写** (`tools/bash.ts`)
- 从 `exec` 改为 `spawn`（支持进程组管理）
- 支持 `detached` 进程组创建，清理杀整棵进程树
- ANSI 转义码自动剥离
- 更精确的超时处理

**Read 工具增强** (`tools/read.ts`)
- 文件大小检查（>5MB 拒绝，提示用 offset/limit）
- 二进制文件检测（读取前 8KB 检查 null 字节）

**Edit 工具改进** (`tools/edit.ts`)
- 结果输出包含替换数量和影响行数

**Grep 工具修复** (`tools/grep.ts`)
- 修复参数拼接问题（`-C` 和 `--max-count` 分开传参）
- 添加 `--color=never` 防止颜色代码污染输出

### 骨头 4 - 头骨（上下文窗口）

**LLM 摘要压缩** (`compaction.ts` 新增)
- 80% 容量时触发压缩
- 将旧消息发给 LLM 生成摘要（保留文件操作、决策、错误、当前状态）
- 保留最近 ~30k tokens 的上下文不压缩
- 失败时回退到简单截断
- UI 显示压缩状态（status 事件）
- 新增 `/compact` 手动压缩命令
- 参考来源：Pi-mono LLM compaction、Learn CC 三层压缩

**模型上下文限制更新** (`context.ts`)
- 新增 o3/o4-mini、Claude 4 系列、DeepSeek 模型
- 使用前缀匹配（`claude-opus-4` 匹配所有日期后缀）

### 骨头 5 - 权限膜

**权限模式增强** (`permissions.ts`)
- 新增危险模式：git rebase、git stash drop、DELETE FROM、killall、npm global install、chmod 777
- 新增 "always allow" 选项（输入 `a`，本次会话内不再询问同类命令）

### 骨头 6 - 系统提示（基因）

**系统提示丰富化** (`system-prompt.ts`)
- 新增 Shell 类型和 Node.js 版本信息
- 新增安全指南（不提交 secrets、确认破坏操作、优先可逆动作、不执行交互命令）
- 新增并行工具执行提示
- 新增文件引用格式提示（包含行号）

### UI 与交互

- 新增 `status` 事件类型（黄色圆点 + 斜体状态文字）
- 新增 `/help` 命令（显示所有可用命令和键盘快捷键）
- 新增 `/compact` 命令（手动触发上下文压缩）
- Banner 更新显示新命令

### 配置与兼容

- 自动从模型名检测 provider（claude 开头自动设为 anthropic）
- 工具执行增加 try/catch（未处理异常不会崩溃 agent 循环）

### 新增文件
- `src/compaction.ts` - LLM 摘要压缩
- `src/session.ts` - 会话持久化
- `context_doc/参考/00-结构.md` - Agent 骨架结构分析

---

## 2026-03-16：第二轮优化（骨架深化）

### 骨头 1 - 环的控制机构

**AbortSignal 传播到工具层**
- Tool 接口新增可选 `signal?: AbortSignal` 参数
- Agent 将 AbortController.signal 传递给每个工具执行
- Bash 工具收到 abort 信号时立即 kill 进程树
- 修复了 Ctrl+C 无法中断正在运行的 bash 命令的问题

**循环安全边界**
- Agent 主循环增加 MAX_LOOP_ITERATIONS (100) 限制
- 防止 LLM 陷入无限工具调用循环

**多行输入**
- 行尾输入 `\` 进入多行模式
- 空行提交多行输入
- 提示符 `… ` 表示续行

### 骨头 2 - 消息（状态载体）

**Compaction 持久化**
- 压缩事件记录到 session JSONL
- 恢复会话时保留压缩历史

**会话清理**
- 启动时自动清理旧会话文件（保留最近 50 个）
- `cleanupSessions()` fire-and-forget

### 骨头 3 - 工具（行动边界）

**Write 工具安全增强**
- 覆盖已有文件时显示行数变化（old → new lines）
- 新建文件与覆盖文件使用不同提示信息
- 阻止写入项目目录和 HOME 目录之外的文件

**Edit 工具增强**
- 结果显示编辑发生的行号（`:lineNum`）
- 显示行数变化（+N / -N / ±0 lines）

**Glob 工具安全**
- 忽略列表新增 `.env*`、`.venv`、`venv`、`__pycache__`、`.cache`

### 骨头 4 - 头骨（上下文窗口）

**Anthropic input token 修复**
- `message_start` 的 input_tokens 现在正确合并到 `turn_end` usage
- 之前 Anthropic 的 input tokens 始终为 0

**OpenAI stream usage**
- `stream_options: { include_usage: true }` 确保流式响应包含 token 用量

### 骨头 5 - 权限膜

**API 错误人性化**
- 401/403/404 等常见 API 错误转换为用户友好消息
- 网络错误（ECONNREFUSED）提示检查配置
- 增加 socket hang up、network error 的重试

### 骨头 6 - 系统提示

**新增命令文档**
- System prompt 告知 LLM 用户可用的 slash 命令列表
- 告知多行输入方式

### UI 与交互

**实时文本流**
- 文本输出从缓冲模式改为实时流式（每个 token 立即显示）
- 去除 markdown 渲染延迟，提升感知速度

**工具执行计时**
- 工具结果显示执行耗时（如 `(1.2s)` 或 `(45ms)`）

**退出摘要**
- 退出时显示会话 token 用量、估算成本、会话时长

**`/usage` 增强**
- 显示估算成本（基于模型定价表）
- 显示会话时长

**`/history` 增强**
- 显示最近 10 条消息的预览（角色 + 内容摘要）

**`/config` 命令**
- 显示当前配置（provider、model、API key 后四位、base URL）

**`--version` 参数**

**管道模式**
- 检测 stdin 非 TTY 时从管道读取输入
- 支持 `echo "fix the bug" | yinxi` 用法

### 配置

**环境变量扩展**
- 新增 `YINXI_MODEL` 环境变量设置模型
- 新增 `YINXI_PROVIDER` 环境变量设置 provider

### 新增文件
- `src/cost.ts` - 模型定价与成本估算

---

## 2026-03-16：第三轮优化（能力扩展）

### 骨头 1 - 环的控制机构

**动态系统提示**
- 每次 `prompt()` 刷新 system prompt（更新 git 分支、日期等）
- 确保 agent 始终知道当前 git 状态

**空流保护**
- LLM 返回空内容时不添加空 assistant 消息

**上下文溢出检测精确化**
- 替换过于宽泛的匹配（"token"），改用精确模式（"context length"、"token limit"、"prompt is too long" 等）

### 骨头 2 - 消息（状态载体）

**工具结果截断**
- 超过 50K 字符的工具结果自动截断（保留前 200 行和后 100 行）
- 防止单次 Read 大文件耗尽上下文

**文件变更追踪**
- Agent 记录 Write/Edit 修改的所有文件
- `getModifiedFiles()` 方法 + `/files` 命令
- 退出摘要显示修改文件数

### 骨头 3 - 工具（行动边界）

**Sub-Agent 工具** (`tools/agent.ts` 新增)
- 派生子 agent 执行复杂研究任务
- 子 agent 拥有独立上下文窗口和基础工具集
- 不含 Agent 工具（防止递归）
- 5 分钟超时保护
- 结果截断至 10K 字符

**Fetch 工具** (`tools/fetch.ts` 新增)
- HTTP/HTTPS URL 内容获取
- 支持 GET/POST 方法和自定义 headers
- 30 秒超时，100KB 响应限制
- 二进制内容自动检测

**Read 工具增强**
- 始终显示总行数

### 骨头 4 - 头骨（上下文窗口）

**Anthropic 提示缓存**
- system prompt 使用 `cache_control: { type: "ephemeral" }`
- 减少重复 system prompt 的 token 计费

**Anthropic thinking 块传递**
- 在后续 API 调用中正确包含 thinking 内容块
- 修复 extended thinking 的上下文连续性

**Extended Thinking 支持**
- `--thinking` 参数传递到 Anthropic API
- `max_tokens` 自动调整（thinking_budget + 4096）

### 骨头 5 - 权限膜

**API Key 智能检测**
- 同时存在 OPENAI_API_KEY 和 ANTHROPIC_API_KEY 时，根据模型名自动选择
- Claude 模型优先使用 ANTHROPIC_API_KEY

**API 错误网络重试**
- 新增 ECONNREFUSED、socket hang up、network error 重试

### 骨头 6 - 系统提示

**工具文档**
- 提示 LLM 可用 Fetch 和 Agent 工具

### UI 与交互

**`--show-thinking`**
- 显示模型推理过程（暗色文本）

**`--quiet` 模式**
- 仅显示文本输出，隐藏工具详情

**`/model` 切换**
- `/model <name>` 运行中切换模型

**`/files` 命令**
- 显示本次会话修改的文件列表

### 新增文件
- `src/tools/agent.ts` - Sub-Agent 工具
- `src/tools/fetch.ts` - URL 获取工具

### 代码统计
- 源文件：24 个 TypeScript 文件
- 总代码：4106 行（从初始 ~1500 行增长至今）

---

## 2026-03-16：第四轮优化（完善与打磨）

### 骨头 3 - 工具（行动边界）

**Undo 系统** (`undo.ts` 新增)
- Write/Edit 操作前自动保存文件快照
- 内存中保留最近 20 次操作的快照栈
- `/undo` 命令恢复上一次修改
- Edit 工具仅在验证通过后才保存快照（防止失败操作污染栈）

**输入验证**
- Bash 工具验证 command 参数存在且为字符串
- Read 工具验证 file_path 参数

**Secret 文件保护**
- Read 工具拒绝读取 `.env*`、`credentials.json`、`.secrets` 文件
- 引导用户使用 Bash 本地查看

**Glob 输出改善**
- 结果头部显示匹配文件总数

**Compaction 上下文保留**
- 工具调用序列化按工具类型优化（Read/Write/Edit 保留文件路径，Bash 保留命令）

### UI 与交互

**`/undo` 命令** — 撤销上一次文件修改

**`/diff` 命令** — 显示 git diff 统计

**`/commit` 命令** — 快速 git commit（`/commit <message>`）

**`/model` 切换增强** — 自动检测 provider（claude → anthropic）

**`/history` 增强** — 显示 token 估算

**SIGTERM 优雅退出** — 与 SIGINT 相同的退出摘要

### 最终代码统计
- 源文件：25 个 TypeScript 文件
- 总代码：4291 行
- 工具：8 个（Read, Write, Edit, Bash, Glob, Grep, Fetch, Agent）
- 命令：14 个（/help, /clear, /reset, /compact, /undo, /diff, /commit, /history, /model, /usage, /files, /sessions, /config, exit）
