# 开发路线图

## 已完成

- [x] P0：配置持久化 + Setup Wizard（`~/.yinxi/config.json`）
- [x] P0：Ctrl+C 中断支持（AbortController）
- [x] P1：权限确认机制（危险 bash 命令拦截）
- [x] P1：Markdown 渲染（marked + marked-terminal）
- [x] P1：Context Window 管理（token 估算 + 自动截断）
- [x] P2：Git 感知（分支、未提交修改注入 system prompt）
- [x] P2：项目文件支持（YINXI.md，类似 CLAUDE.md）
- [x] P2：Token / Cost 追踪（`/usage` 命令）

## 待开发

### P3：工具并行执行
- 多个独立工具调用用 `Promise.all` 并行执行
- 减少多工具场景的等待时间

### P3：错误重试
- API 调用失败时指数退避重试
- 速率限制（429）自动等待
- 网络错误优雅处理

### 远期目标
- MCP (Model Context Protocol) 支持
- 子 agent / 并行 agent
- 图片/截图理解
- VS Code 插件
- 会话持久化（保存/恢复对话）
- npm 全局安装发布
- 更丰富的 TUI（ink 框架）
- 多文件 diff 预览
- 自动 git commit
