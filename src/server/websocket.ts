import { WebSocket, WebSocketServer } from 'ws';
import { WebSocketMessage } from '../types';

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, ExtendedWebSocket> = new Map();
  private clientCounter = 0;
  private messageHandlers: Map<string, (message: WebSocketMessage) => void> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
  }

  private setupServer() {
    this.wss.on('connection', (ws: ExtendedWebSocket) => {
      const clientId = `client-${++this.clientCounter}`;
      this.clients.set(clientId, ws);
      console.log(`Client connected: ${clientId}, total clients: ${this.clients.size}`);

      // Setup ping-pong for keep-alive
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          console.log(`Received message from ${clientId}: type=${message.type}, id=${message.id}`);
          this.handleMessage(clientId, message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`Client disconnected: ${clientId}, remaining clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
      });
    });

    // Start heartbeat
    this.startHeartbeat();
  }

  private startHeartbeat() {
    setInterval(() => {
      this.clients.forEach((ws, clientId) => {
        if (!ws.isAlive) {
          ws.terminate();
          this.clients.delete(clientId);
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  private handleMessage(clientId: string, message: WebSocketMessage) {
    // First try specific handler for this request ID
    const handler = this.messageHandlers.get(message.id);
    if (handler) {
      handler(message);
      return;
    }
    
    // If no specific handler, try the wildcard handler
    const wildcardHandler = this.messageHandlers.get('*');
    if (wildcardHandler) {
      wildcardHandler(message);
    }
  }

  public sendMessage(clientId: string, message: WebSocketMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = this.clients.get(clientId);
      if (!client) {
        reject(new Error(`Client ${clientId} not found`));
        return;
      }
      client.send(JSON.stringify(message), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public broadcast(message: WebSocketMessage): void {
    this.clients.forEach((ws) => {
      ws.send(JSON.stringify(message));
    });
  }

  public getAvailableClient(): string | null {
    if (this.clients.size === 0) return null;
    const firstKey = this.clients.keys().next().value;
    return firstKey || null;
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public registerMessageHandler(requestId: string, handler: (message: WebSocketMessage) => void) {
    this.messageHandlers.set(requestId, handler);
  }

  public unregisterMessageHandler(requestId: string) {
    this.messageHandlers.delete(requestId);
  }

  public close() {
    this.wss.close();
  }
}
