import express from 'express';
import { WebSocketManager } from './websocket';
import { RequestQueue } from './queue';
import { APIServer } from './api';
import { WebSocketMessage } from '../types';

const app = express();
const HTTP_PORT = 3107;
const WS_PORT = 8107;

// Middleware
app.use(express.json());

// Debug middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Initialize managers
const wsManager = new WebSocketManager(WS_PORT);
const queue = new RequestQueue();
const apiServer = new APIServer(app, wsManager, queue);

// Register WebSocket message handler
wsManager.registerMessageHandler('*', (message: WebSocketMessage) => {
  console.log(`[Queue Handler] Processing message: type=${message.type}, id=${message.id}`);
  if (message.type === 'sse') {
    console.log(`[Queue Handler] Handling SSE data for ${message.id}`);
    queue.handleSSEData(message.id, message.data || '');
  } else if (message.type === 'done') {
    console.log(`[Queue Handler] Handling completion for ${message.id}`);
    queue.handleComplete(message.id);
  } else if (message.type === 'error') {
    console.log(`[Queue Handler] Handling error for ${message.id}: ${message.error}`);
    queue.handleError(message.id, message.error || 'Unknown error');
  }
});

// Start HTTP server
app.listen(HTTP_PORT, () => {
  console.log(`HTTP API server listening on port ${HTTP_PORT}`);
});

console.log(`WebSocket server listening on port ${WS_PORT}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  wsManager.close();
  process.exit(0);
});
