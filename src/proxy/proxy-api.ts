import express, { Request, Response } from 'express';
import { ProxyServer } from './proxy';

export class ProxyAPI {
  private router: express.Router;
  private proxyServer: ProxyServer;

  constructor(proxyServer: ProxyServer) {
    this.proxyServer = proxyServer;
    this.router = express.Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Get all captured requests
    this.router.get('/requests', (req: Request, res: Response) => {
      const requests = this.proxyServer.getAllRequests();
      res.json({
        total: requests.length,
        requests: requests.map((r) => ({
          id: r.id,
          timestamp: r.timestamp,
          method: r.method,
          path: r.path,
          headers: r.headers,
          body: r.body,
          query: r.query,
        })),
      });
    });

    // Get specific request
    this.router.get('/requests/:id', (req: Request, res: Response) => {
      const request = this.proxyServer.getRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }
      res.json(request);
    });

    // Get all captured responses
    this.router.get('/responses', (req: Request, res: Response) => {
      const responses = this.proxyServer.getAllResponses();
      res.json({
        total: responses.length,
        responses: responses.map((r) => ({
          id: r.id,
          statusCode: r.statusCode,
          headers: r.headers,
          body: r.body,
          isSSE: r.isSSE,
          chunksCount: r.chunks.length,
        })),
      });
    });

    // Get specific response
    this.router.get('/responses/:id', (req: Request, res: Response) => {
      const response = this.proxyServer.getResponse(req.params.id);
      if (!response) {
        return res.status(404).json({ error: 'Response not found' });
      }
      res.json(response);
    });

    // Get request-response pair
    this.router.get('/pairs/:id', (req: Request, res: Response) => {
      const request = this.proxyServer.getRequest(req.params.id);
      const response = this.proxyServer.getResponse(req.params.id);

      if (!request || !response) {
        return res.status(404).json({ error: 'Request or response not found' });
      }

      res.json({
        request,
        response,
      });
    });

    // Clear all captures
    this.router.post('/clear', (req: Request, res: Response) => {
      this.proxyServer.clearCaptures();
      res.json({ message: 'All captures cleared' });
    });

    // Get statistics
    this.router.get('/stats', (req: Request, res: Response) => {
      const requests = this.proxyServer.getAllRequests();
      const responses = this.proxyServer.getAllResponses();

      const sseCount = responses.filter((r) => r.isSSE).length;
      const errorCount = responses.filter((r) => r.statusCode >= 400).length;

      res.json({
        totalRequests: requests.length,
        totalResponses: responses.length,
        sseResponses: sseCount,
        errorResponses: errorCount,
      });
    });
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
