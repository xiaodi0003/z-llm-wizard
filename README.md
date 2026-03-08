# LLM Proxy Service

A proxy service that enables API calls to the Douyin (ByteDance) LLM service through a Chrome extension, providing a standard OpenAI-compatible `/chat/completions` endpoint.

## Architecture

```
API Client
    ↓ (HTTP POST /chat/completions)
Node.js Server (Express + WebSocket)
    ↓ (WebSocket)
Chrome Extension
    ├─ Background Service Worker (WebSocket connection)
    └─ Content Script (Page interaction + XHR interception)
    ↓ (Page automation)
Douyin Chat Page
    ↓ (XHR /chat/completion SSE)
Chrome Extension
    ↓ (WebSocket)
Node.js Server
    ↓ (SSE stream)
API Client
```

## Features

- **Standard OpenAI API**: Compatible `/chat/completions` endpoint
- **Streaming Responses**: Server-Sent Events (SSE) for real-time responses
- **Automatic Reconnection**: Extension automatically reconnects on disconnect
- **Message Queuing**: Handles multiple concurrent requests
- **Error Handling**: Comprehensive error handling and recovery
- **Heartbeat Mechanism**: Keep-alive for WebSocket connections

## Quick Start

### Prerequisites
- Node.js 16+
- Chrome browser
- npm or yarn

### Server Setup

1. Install dependencies:
```bash
npm install
```

2. Build TypeScript:
```bash
npm run build
```

3. Start the server:
```bash
npm start
```

Server will be available at:
- HTTP API: `http://localhost:3000`
- WebSocket: `ws://localhost:8080`

### Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `src/extension` directory

## Usage

### API Request

```bash
curl -X POST http://localhost:3000/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ]
  }'
```

### Response

Server-Sent Events stream:
```
data: {"choices":[{"delta":{"content":"I'm doing well"}}]}
data: {"choices":[{"delta":{"content":", thank you"}}]}
data: [DONE]
```

## Project Structure

```
.
├── src/
│   ├── server/
│   │   ├── index.ts          # Main server entry point
│   │   ├── api.ts            # HTTP API implementation
│   │   ├── websocket.ts      # WebSocket server
│   │   └── queue.ts          # Request queue management
│   ├── extension/
│   │   ├── manifest.json     # Extension manifest
│   │   ├── background.ts     # Background service worker
│   │   ├── content.ts        # Content script
│   │   └── xhr-interceptor.ts # XHR interception
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   └── tests/
│       ├── integration.test.ts
│       └── performance.test.ts
├── package.json
├── tsconfig.json
├── DEPLOYMENT.md             # Deployment guide
├── API.md                     # API documentation
├── TROUBLESHOOTING.md         # Troubleshooting guide
└── README.md                  # This file
```

## Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Server and extension deployment instructions
- **[API.md](./API.md)** - Complete API documentation with examples
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions

## Development

### Run in Development Mode

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

### Build for Production

```bash
npm run build
```

## Configuration

### Server Configuration

Edit `src/server/index.ts`:
- `HTTP_PORT`: HTTP API port (default: 3000)
- `WS_PORT`: WebSocket port (default: 8080)

### Extension Configuration

Edit `src/extension/background.ts`:
- `SERVER_URL`: WebSocket server URL (default: ws://localhost:8080)
- `RECONNECT_DELAY`: Reconnection delay in ms (default: 3000)
- `MAX_RECONNECT_ATTEMPTS`: Max reconnection attempts (default: 5)

Edit `src/extension/manifest.json`:
- `host_permissions`: URLs where extension runs
- `content_scripts.matches`: Page URL patterns

## Key Components

### Server

**WebSocket Manager** (`websocket.ts`)
- Manages client connections
- Routes messages between clients and HTTP handlers
- Implements heartbeat/ping-pong mechanism

**Request Queue** (`queue.ts`)
- Manages pending requests
- Matches responses to requests
- Handles timeouts and cleanup

**HTTP API** (`api.ts`)
- Exposes `/chat/completions` endpoint
- Validates requests
- Streams SSE responses

### Extension

**Background Service Worker** (`background.ts`)
- Maintains WebSocket connection to server
- Routes messages to/from content script
- Handles reconnection logic

**Content Script** (`content.ts`)
- Injects into Douyin page
- Finds and fills input box
- Clicks send button
- Intercepts XHR responses

**XHR Interceptor** (`xhr-interceptor.ts`)
- Intercepts fetch requests
- Identifies SSE endpoints
- Parses and forwards SSE data

## Message Flow

1. **Request**: API client sends POST to `/chat/completions`
2. **Queue**: Server creates request ID and queues request
3. **Send**: Server sends message to extension via WebSocket
4. **Input**: Extension fills input box and clicks send
5. **Intercept**: Extension intercepts XHR response
6. **Forward**: Extension sends SSE data to server via WebSocket
7. **Stream**: Server streams data to client via SSE
8. **Complete**: Extension sends done signal, server closes stream

## Error Handling

- **Connection Failures**: Automatic reconnection with exponential backoff
- **Request Timeouts**: 30-second timeout with error response
- **Client Disconnect**: Graceful cleanup and error notification
- **Invalid Requests**: 400 Bad Request with error details
- **No Available Clients**: 503 Service Unavailable

## Performance

- Supports multiple concurrent requests
- Efficient message queuing
- Minimal memory footprint
- Heartbeat-based connection monitoring
- Automatic cleanup of completed requests

## Security Considerations

- WebSocket connections are local-only by default
- Consider adding authentication for production
- Use WSS (WebSocket Secure) in production
- Validate all incoming requests
- Implement rate limiting for production

## Limitations

- Single client connection at a time (can be extended)
- 30-second request timeout
- No built-in authentication
- No rate limiting (can be added)
- Requires Chrome browser with extension support

## Future Enhancements

- [ ] Multiple client support
- [ ] Authentication and authorization
- [ ] Rate limiting
- [ ] Request logging and monitoring
- [ ] Performance metrics collection
- [ ] Support for multiple LLM providers
- [ ] Caching layer
- [ ] Load balancing

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## License

MIT

## Support

For issues and questions:
1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Review [API.md](./API.md) for API details
3. Check server and browser console logs
4. Verify configuration and network connectivity
