# Yinxi — 项目概览

## 项目定位

Yinxi 是一个开源的终端 AI 编程助手（coding agent），目标是打造一个类似 Claude Code / Codex CLI 级别的工具。用户在终端中与 AI 对话，AI 可以读写文件、执行命令、搜索代码库，自主完成软件工程任务。

## 命名

- 原名 `kode`，因与已有项目重名，于 2026-03-15 更名为 `yinxi`
- GitHub 仓库：https://github.com/luoziyan100/yinxi（目前只推送了 Python 版）

## 技术选型

经过对主流 coding agent 的调研，确定以 **TypeScript** 作为主力开发语言。

调研结论：

| 项目 | 语言 |
|------|------|
| Claude Code (Anthropic) | TypeScript |
| Codex CLI (OpenAI) | TS → Rust 重写 |
| Gemini CLI (Google) | TypeScript |
| Amp (Sourcegraph) | TypeScript |
| Cline | TypeScript |
| OpenCode | Go |
| Goose (Block) | Rust |
| Aider | Python |

TypeScript 是终端 coding agent 的绝对主流。Google 团队甚至讨论过用 Go，最终仍选 TS，理由：开发速度快、LLM 对 TS 理解更好、npm 生态成熟。

## 两个版本

项目存在两个并行实现，**互相独立，不同时起作用**：

- **TypeScript 版**（`/src/`）— 主线，功能更全，架构更好
- **Python 版**（`/yinxi/`）— 参考 learn-claude-code 写的，已推送 GitHub，保留作轻量替代

**决定：以 TypeScript 版为主线继续开发。**
