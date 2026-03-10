import express from 'express';
import { ProxyServer } from './proxy';
import { ProxyAPI } from './proxy-api';

// Create Express app
const app = express();

// Create and start proxy server
const proxyServer = new ProxyServer('localhost', 3107);

// Setup API routes for capturing data
const proxyAPI = new ProxyAPI(proxyServer);
app.use('/api/proxy', proxyAPI.getRouter());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Listen to events
proxyServer.on('request', (req) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  console.log(`  Headers:`, req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`  Body:`, JSON.stringify(req.body).substring(0, 200));
  }
});

proxyServer.on('response', (res) => {
  console.log(`[RESPONSE] Status: ${res.statusCode}`);
  console.log(`  Headers:`, res.headers);
  if (res.body && !res.isSSE) {
    const bodyStr =
      typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    console.log(`  Body:`, bodyStr.substring(0, 200));
  }
});

proxyServer.on('sse-chunk', (data) => {
  console.log(`[SSE] Request ${data.requestId}: ${data.data.substring(0, 100)}`);
});

proxyServer.on('error', (err) => {
  console.error(`[ERROR] Request ${err.requestId}: ${err.error}`);
});

// Mount proxy server app
app.use(proxyServer.getApp());

// Start on port 3108
const PORT = process.env.PORT || 3108;
app.listen(parseInt(PORT as string), () => {
  console.log(`HTTP Proxy server listening on port ${PORT}`);
  console.log(`Forwarding requests to localhost:3107`);
  console.log(`API endpoints available at http://localhost:${PORT}/api/proxy`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down proxy server...');
  process.exit(0);
});
