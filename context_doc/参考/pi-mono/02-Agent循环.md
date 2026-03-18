# Pi - Agent 循环与会话管理

## AgentSession：核心编排器

```typescript
class AgentSession {
  agent: Agent                     // 来自 pi-agent-core
  sessionManager: SessionManager   // 持久化
  settingsManager: SettingsManager // 设置

  // 事件处理
  _eventListeners: AgentSessionEventListener[]
  _agentEventQueue: Promise<void>  // 串行化事件处理

  // 消息队列（三种模式）
  _steeringMessages: string[]      // Enter - 中断下一个工具
  _followUpMessages: string[]      // Alt+Enter - 等待空闲
  _pendingNextTurnMessages: CustomMessage[]

  // 压缩状态
  _autoCompactionAbortController?: AbortController

  // 重试状态
  _retryPromise?: Promise<void>
  _retryAttempt: number

  // 扩展系统
  _extensionRunner?: ExtensionRunner
  _toolRegistry: Map<string, AgentTool>
}
```

## 事件循环流程

```
Agent 发出事件
    ↓
_handleAgentEvent() [同步]
  ├─ 为 agent_end 创建重试 promise
  └─ 排入 _processAgentEvent() [异步]
    ↓
_processAgentEvent() [由 _agentEventQueue 串行化]
  ├─ 从 steering/followUp 队列移除（若 message_start）
  ├─ 通过 _extensionRunner 发出扩展事件
  ├─ 发出给所有监听器
  ├─ 会话持久化（在 message_end 时）
  └─ 自动重试 & 自动压缩检查（在 agent_end 时）
```

## 事件类型
- `agent_start` / `agent_end` - 轮次边界
- `message_start` / `message_update` / `message_end` - 流式更新
- `tool_execution_start/update/end` - 工具执行生命周期
- `turn_start` / `turn_end` - 工具执行阶段

## 异步事件队列（关键模式）

```typescript
// 事件串行处理，避免竞态
_agentEventQueue: Promise<void> = Promise.resolve()

_handleAgentEvent(event) {
  this._agentEventQueue = this._agentEventQueue.then(
    () => this._processAgentEvent(event),
    () => this._processAgentEvent(event)  // 错误时也继续链
  )
}
```

确保：
- 会话状态无竞态
- 副作用正确排序
- 扩展 hooks 在下一事件前完成

## 初始化序列

```
1. CLI 启动 (cli.ts)
   ├─ 解析参数第一轮（发现扩展）
   ├─ 创建 SettingsManager / AuthStorage / ModelRegistry
   └─ 加载扩展以发现其 flags

2. 资源加载 (resource-loader.ts)
   ├─ 从所有发现路径加载 .ts/.js 文件
   ├─ 调用扩展工厂函数
   └─ 提取 flags, hooks, tools, commands

3. 参数解析第二轮
   ├─ 现在包含扩展 flags
   └─ 解析模型

4. Agent 初始化 (sdk.ts → agent-session.ts)
   ├─ 创建 Agent + 工具
   ├─ 创建 ExtensionRunner
   ├─ 构建系统提示
   └─ 订阅 agent 事件

5. 模式初始化
   ├─ Interactive: 创建 TUI → 开始事件循环
   ├─ Print: 订阅事件 → 发送消息 → 输出
   └─ RPC: JSON 读取器 → RPC 协议
```
