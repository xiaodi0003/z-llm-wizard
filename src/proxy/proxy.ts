import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { EventEmitter } from 'events';

// Interface for captured request/response
export interface CapturedRequest {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  headers: Record<string, any>;
  body: any;
  query: Record<string, any>;
}

export interface CapturedResponse {
  id: string;
  statusCode: number;
  headers: Record<string, any>;
  body: any;
  isSSE: boolean;
  chunks: string[];
}

export class ProxyServer extends EventEmitter {
  private app: express.Application;
  private targetHost: string;
  private targetPort: number;
  private capturedRequests: Map<string, CapturedRequest> = new Map();
  private capturedResponses: Map<string, CapturedResponse> = new Map();

  constructor(targetHost: string = 'localhost', targetPort: number = 3107) {
    super();
    this.app = express();
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Parse JSON and URL-encoded bodies
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ limit: '50mb', extended: true }));
    this.app.use(express.raw({ limit: '50mb' }));
    this.app.use(express.text({ limit: '50mb' }));

    // Request capture middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      (req as any).requestId = requestId;

      // Capture request
      const capturedReq: CapturedRequest = {
        id: requestId,
        timestamp: Date.now(),
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
        query: req.query,
      };

      this.capturedRequests.set(requestId, capturedReq);
      this.emit('request', capturedReq);

      // Initialize response capture
      this.capturedResponses.set(requestId, {
        id: requestId,
        statusCode: 200,
        headers: {},
        body: null,
        isSSE: false,
        chunks: [],
      });

      next();
    });
  }

  private setupRoutes(): void {
    // Proxy all routes
    this.app.all('*', (req: Request, res: Response) => {
      const requestId = (req as any).requestId;
      this.proxyRequest(req, res, requestId);
    });
  }

  private proxyRequest(req: Request, res: Response, requestId: string): void {
    const options = {
      hostname: this.targetHost,
      port: this.targetPort,
      path: req.originalUrl,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${this.targetHost}:${this.targetPort}`,
      },
    };

    // Remove content-length to let Node.js calculate it
    delete options.headers['content-length'];

    const proxyReq = http.request(options, (proxyRes) => {
      const capturedResponse = this.capturedResponses.get(requestId);
      if (capturedResponse) {
        capturedResponse.statusCode = proxyRes.statusCode || 200;
        capturedResponse.headers = proxyRes.headers;
        capturedResponse.isSSE =
          proxyRes.headers['content-type']?.includes('text/event-stream') || false;
      }

      // Set response headers
      Object.keys(proxyRes.headers).forEach((key) => {
        const value = proxyRes.headers[key];
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });

      res.writeHead(proxyRes.statusCode || 200);

      // Handle SSE
      if (capturedResponse?.isSSE) {
        proxyRes.on('data', (chunk) => {
          const data = chunk.toString();
          if (capturedResponse) {
            capturedResponse.chunks.push(data);
          }
          this.emit('sse-chunk', {
            requestId,
            data,
            timestamp: Date.now(),
          });
          res.write(chunk);
        });
      } else {
        // Handle regular response
        let responseBody = '';
        proxyRes.on('data', (chunk) => {
          responseBody += chunk.toString();
          res.write(chunk);
        });

        proxyRes.on('end', () => {
          if (capturedResponse) {
            try {
              capturedResponse.body =
                proxyRes.headers['content-type']?.includes('application/json') &&
                responseBody
                  ? JSON.parse(responseBody)
                  : responseBody;
            } catch {
              capturedResponse.body = responseBody;
            }
          }
          this.emit('response', this.capturedResponses.get(requestId));
          res.end();
        });
      }

      proxyRes.on('error', (err) => {
        console.error('Proxy response error:', err);
        this.emit('error', { requestId, error: err.message });
        res.status(502).json({ error: 'Bad Gateway' });
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      this.emit('error', { requestId, error: err.message });
      res.status(502).json({ error: 'Bad Gateway' });
    });

    // Write request body
    if (req.body) {
      const bodyData =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      proxyReq.write(bodyData);
    }

    proxyReq.end();
  }

  // Get captured request
  public getRequest(id: string): CapturedRequest | undefined {
    return this.capturedRequests.get(id);
  }

  // Get captured response
  public getResponse(id: string): CapturedResponse | undefined {
    return this.capturedResponses.get(id);
  }

  // Get all captured requests
  public getAllRequests(): CapturedRequest[] {
    return Array.from(this.capturedRequests.values());
  }

  // Get all captured responses
  public getAllResponses(): CapturedResponse[] {
    return Array.from(this.capturedResponses.values());
  }

  // Clear captured data
  public clearCaptures(): void {
    this.capturedRequests.clear();
    this.capturedResponses.clear();
  }

  // Start proxy server
  public start(port: number = 3000): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`HTTP Proxy server listening on port ${port}`);
        console.log(`Forwarding requests to ${this.targetHost}:${this.targetPort}`);
        resolve();
      });
    });
  }

  // Get Express app for testing
  public getApp(): express.Application {
    return this.app;
  }
}
