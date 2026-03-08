# LLM代理服务 - 设计文档

## 系统架构

```
┌─────────────────┐
│  API 调用方      │
└────────┬────────┘
         │ HTTP POST /chat/completions
         │
┌────────▼────────────────────────────┐
│      服务端 (Node.js/Express)        │
│  ┌──────────────────────────────┐   │
│  │ /chat/completions 接口       │   │
│  │ (OpenAPI 格式)               │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────▼───────────────┐   │
│  │ WebSocket 服务器             │   │
│  │ (ws://localhost:8080)        │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼────────────────────┘
                  │ WebSocket
         ┌────────▼──────────────────────────┐
         │      Chrome 浏览器                 │
         │  ┌────────────────────────────┐   │
         │  │  Chrome 扩展               │   │
         │  │  ┌──────────────────────┐  │   │
         │  │  │ Background Service   │  │   │
         │  │  │ Worker (WebSocket)   │  │   │
         │  │  └──────────────────────┘  │   │
         │  │  ┌──────────────────────┐  │   │
         │  │  │ Content Script       │  │   │
         │  │  │ (XHR 拦截)          │  │   │
         │  │  └──────────────────────┘  │   │
         │  └────────────────────────────┘   │
         │                                    │
         │  ┌────────────────────────────┐   │
         │  │  豆包聊天页面 (Tab)        │   │
         │  │  - 聊天输入框              │   │
         │  │  - 发送按钮                │   │
         │  │  - XHR /chat/completion    │   │
         │  │    (SSE 流)                │   │
         │  └────────────────────────────┘   │
         └────────────────────────────────────┘
```

**关键说明:**
- Chrome扩展和豆包页面都运行在同一个Chrome浏览器实例中
- Content Script 注入到豆包页面，可以直接操作页面DOM和监听XHR
- Background Service Worker 管理WebSocket连接和消息路由
- Content Script 和 Background Worker 通过 Chrome Extension Message API 通信

## 技术栈

### 服务端
- **框架**: Express.js
- **WebSocket**: ws 库
- **语言**: Node.js (TypeScript)
- **端口**: 8080 (WebSocket), 3000 (HTTP API)

### Chrome扩展
- **Manifest**: V3
- **脚本**: Content Script + Background Service Worker
- **通信**: WebSocket API

## 核心模块设计

### 1. 服务端模块

#### 1.1 HTTP API 模块 (server/api.ts)
```typescript
// POST /chat/completions
// 请求体: { messages: Array<{role, content}> }
// 响应: SSE 流
```

**职责:**
- 接收OpenAPI格式的请求
- 验证请求格式
- 获取可用的WebSocket客户端
- 通过WebSocket发送消息给客户端
- 建立SSE连接并流式返回响应

#### 1.2 WebSocket 服务器模块 (server/websocket.ts)
```typescript
// 管理客户端连接
// 消息路由和转发
```

**职责:**
- 管理客户端连接池
- 处理客户端连接/断开事件
- 路由消息到对应的HTTP请求处理器
- 处理心跳/ping-pong

#### 1.3 消息队列模块 (server/queue.ts)
```typescript
// 关联HTTP请求和WebSocket响应
```

**职责:**
- 为每个HTTP请求创建唯一ID
- 存储待处理的请求
- 匹配客户端响应到对应请求
- 超时处理

### 2. Chrome扩展模块

#### 2.1 Background Service Worker (extension/background.ts)
```typescript
// WebSocket 连接管理
// 消息路由
```

**职责:**
- 建立和维护到服务端的WebSocket连接
- 接收来自服务端的消息
- 将消息转发给Content Script（通过Chrome Extension Message API）
- 接收Content Script的响应
- 转发响应给服务端

#### 2.2 Content Script (extension/content.ts)
```typescript
// 页面交互
// XHR 监听
// 运行在豆包页面的上下文中
```

**职责:**
- 在豆包页面中定位聊天输入框
- 输入消息文本
- 点击发送按钮
- 监听页面的XHR请求
- 捕获 /chat/completion SSE流
- 通过Chrome Extension Message API转发SSE数据给Background Worker

#### 2.3 XHR 拦截器 (extension/xhr-interceptor.ts)
```typescript
// 在Content Script中运行
// 拦截和转发XHR请求
```

**职责:**
- 使用fetch API拦截（通过修改全局fetch）
- 识别 /chat/completion 接口
- 捕获SSE事件流
- 解析SSE消息格式
- 将数据转发给Background Worker

#### 2.4 Chrome Extension Message API 通信
```typescript
// Content Script → Background Worker
chrome.runtime.sendMessage({
  type: "sse_data",
  id: "req-123",
  data: "..."
})

// Background Worker → Content Script
chrome.tabs.sendMessage(tabId, {
  type: "message",
  id: "req-123",
  content: "..."
})
```

## 数据流

### 请求流程
1. API调用方 → POST /chat/completions
2. 服务端生成请求ID，存储在队列中
3. 服务端通过WebSocket发送消息给客户端: `{type: "message", id, content}`
4. 客户端接收消息，在豆包页面输入并发送
5. 豆包页面发起XHR请求到 /chat/completion (SSE)

### 响应流程
1. 客户端监听XHR响应，捕获SSE流
2. 客户端通过WebSocket转发SSE数据: `{type: "sse", id, data}`
3. 服务端接收SSE数据，通过HTTP SSE连接转发给调用方
4. 调用方接收流式响应
5. 流完成后，客户端发送完成信号: `{type: "done", id}`

## 消息格式

### WebSocket 消息格式

**客户端 ← 服务端 (请求消息)**
```json
{
  "type": "message",
  "id": "req-123",
  "content": "你好，请介绍一下自己"
}
```

**客户端 → 服务端 (SSE数据)**
```json
{
  "type": "sse",
  "id": "req-123",
  "data": "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n"
}
```

**客户端 → 服务端 (完成信号)**
```json
{
  "type": "done",
  "id": "req-123"
}
```

**客户端 → 服务端 (错误信号)**
```json
{
  "type": "error",
  "id": "req-123",
  "error": "Failed to send message"
}
```

## 错误处理

- **连接失败**: 重试机制，指数退避
- **请求超时**: 30秒超时，返回错误
- **客户端断开**: 返回503错误给调用方
- **无可用客户端**: 返回503错误

## 安全考虑

- WebSocket连接验证（可选token）
- 请求ID验证，防止消息混乱
- 超时保护，防止资源泄漏
- 日志记录所有关键操作

## 扩展性考虑

- 支持多个客户端连接
- 请求队列管理
- 连接池管理
- 可配置的超时和重试参数
