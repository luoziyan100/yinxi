# Codex - Agent 循环

## 核心数据结构

```rust
pub(crate) struct Session {
    conversation_id: ThreadId,
    tx_event: Sender<Event>,              // 事件流发送给客户端
    agent_status: watch::Sender<AgentStatus>,
    state: Mutex<SessionState>,           // 带锁的配置状态
    active_turn: Mutex<Option<ActiveTurn>>, // 当前轮次
    services: SessionServices,            // 共享服务
    js_repl: Arc<JsReplHandle>,
    conversation: Arc<RealtimeConversationManager>,
}

pub(crate) struct TurnContext {
    sub_id: String,                       // 唯一轮次 ID
    trace_id: Option<String>,             // OpenTelemetry 追踪
    model_info: ModelInfo,                // 模型详情（上下文窗口等）
    cwd: PathBuf,                         // 当前工作目录
    approval_policy: Constrained<AskForApproval>,
    sandbox_policy: Constrained<SandboxPolicy>,
    tools_config: ToolsConfig,            // 可用工具配置
    // ... 20+ 其他字段
}
```

## 主循环流程 (codex.rs:run_turn())

```
loop {
    1. 处理 pending session start hooks
    2. 收集 pending 用户输入
    3. 构建采样请求（对话历史 + 工具定义）
    4. 调用 run_sampling_request() → 执行模型轮次
    5. 处理结果：
       - needs_follow_up → 继续循环
       - token_limit_reached → 运行自动压缩
       - complete → 触发 stop hooks 并退出
    6. 处理工具调用（通过 ToolRouter）
}
```

## 采样请求流程 (run_sampling_request())

1. 构建 `Prompt`（对话历史 + 工具定义）
2. 通过 `ModelClientSession::stream()` 调用 OpenAI Responses API
3. 流式处理每个 chunk：
   - 解析 assistant text deltas
   - 检测工具调用 (function calls)
   - 动态构建工具规格
   - 路由工具调用到 handlers

## 关键机制

### Cancellation Token
- 传递给所有长时间运行的任务
- 子 token 用于嵌套操作
- 支持任何时刻的优雅中断

### Turn-Scoped Context
- `TurnContext` 每轮创建，跨所有操作共享
- 包含轮次相关状态（模型、cwd、权限等）
- 轮次结束时丢弃，清理资源

### Event Channel
```rust
// 所有事件通过 channel 发送给客户端
impl Session {
    async fn send_event(&self, ctx: &TurnContext, msg: EventMsg) {
        let event = Event { id: ctx.sub_id.clone(), msg };
        let _ = self.tx_event.send(event).await;
    }
}
```
