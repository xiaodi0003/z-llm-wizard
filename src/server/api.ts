import { Express, Request, Response } from 'express';
import { ChatCompletionRequest, WebSocketMessage } from '../types';
import { WebSocketManager } from './websocket';
import { RequestQueue } from './queue';

// Convert Douyin response to OpenAI-compatible format
// Returns null if no content to send (empty delta)
function convertToOpenAIFormat(data: string, requestId: string, model: string): string | null {
  try {
    const obj = JSON.parse(data);
    
    // Extract text content from various response formats
    let textContent = '';
    
    // Format 1: Direct text field
    if (obj.text) {
      textContent = obj.text;
    }
    // Format 2: Content block with text
    else if (obj.content?.content_block?.[0]?.content?.text_block?.text) {
      textContent = obj.content.content_block[0].content.text_block.text;
    }
    // Format 3: Patch operation with text
    else if (obj.patch_op?.[0]?.patch_value?.content_block?.[0]?.content?.text_block?.text) {
      textContent = obj.patch_op[0].patch_value.content_block[0].content.text_block.text;
    }
    
    // If no content found, return null to skip this message
    if (!textContent || textContent.trim() === '') {
      console.log(`[API] Skipping empty content for ${requestId}`);
      return null;
    }
    
    // Build standard OpenAI format response with content
    const response: any = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: textContent },
          finish_reason: null
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 0
        },
        completion_tokens_details: {
          reasoning_tokens: 0
        }
      }
    };
    
    return JSON.stringify(response);
  } catch (error) {
    // If not JSON, return null to skip
    console.log(`[API] Skipping non-JSON data: ${data.substring(0, 50)}`);
    return null;
  }
}

export class APIServer {
  private app: Express;
  private wsManager: WebSocketManager;
  private queue: RequestQueue;

  constructor(app: Express, wsManager: WebSocketManager, queue: RequestQueue) {
    this.app = app;
    this.wsManager = wsManager;
    this.queue = queue;
    this.setupRoutes();
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ 
        status: 'ok',
        clients: this.wsManager.getClientCount(),
        timestamp: new Date().toISOString()
      });
    });

    // Models endpoint for litellm compatibility
    this.app.get('/v1/models', (req: Request, res: Response) => {
      res.json({
        object: 'list',
        data: [
          {
            id: 'doubao',
            object: 'model',
            owned_by: 'doubao',
            permission: []
          },
          {
            id: 'localdoubao/llm',
            object: 'model',
            owned_by: 'localdoubao',
            permission: []
          },
          {
            id: 'deepseek-chat',
            object: 'model',
            owned_by: 'deepseek',
            permission: []
          },
          {
            id: 'deepseek-coder',
            object: 'model',
            owned_by: 'deepseek',
            permission: []
          }
        ]
      });
    });
    
    this.app.post('/chat/completions', (req: Request, res: Response) => {
      this.handleChatCompletions(req, res);
    });
    // Also support OpenAI-compatible v1 endpoint
    this.app.post('/v1/chat/completions', (req: Request, res: Response) => {
      this.handleChatCompletions(req, res);
    });
  }

  private async handleChatCompletions(req: Request, res: Response) {
    try {
      console.log('Received chat completions request');
      
      // Validate request
      const request: ChatCompletionRequest = req.body;
      if (!request.messages || !Array.isArray(request.messages)) {
        console.error('Invalid request format:', request);
        res.status(400).json({ error: 'Invalid request format' });
        return;
      }

      // Check if streaming is requested (default: true)
      const stream = request.stream !== false;
      console.log(`Stream mode: ${stream}`);

      console.log('Request validated, checking for available clients');
      
      // Check if client is available
      const clientId = this.wsManager.getAvailableClient();
      const clientCount = this.wsManager.getClientCount();
      console.log(`Available clients: ${clientCount}, selected client: ${clientId}`);
      
      if (!clientId) {
        console.error('No available clients');
        res.status(503).json({ error: 'No available clients' });
        return;
      }

      // Add request to queue
      const requestId = this.queue.addRequest(request);
      console.log(`Request queued with ID: ${requestId}`);

      if (stream) {
        // Streaming response
        this.handleStreamingResponse(req, res, requestId, clientId, request);
      } else {
        // Non-streaming response - collect all data first
        this.handleNonStreamingResponse(req, res, requestId, clientId, request);
      }
    } catch (error) {
      console.error('Error handling chat completions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private handleStreamingResponse(req: Request, res: Response, requestId: string, clientId: string, request: ChatCompletionRequest) {
    let isCompleted = false;

    console.log(`[API] Starting streaming response for ${requestId}`);

    // Setup SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200);

    // Setup callbacks BEFORE sending any data
    this.queue.setResponseCallback(requestId, (data: string) => {
      if (!isCompleted && res.writable) {
        console.log(`[API] Sending SSE data for ${requestId}: ${data.substring(0, 50)}...`);
        // Convert to OpenAI format for litellm compatibility
        const openaiData = convertToOpenAIFormat(data, requestId, request.model || 'doubao');
        // Only send if there's actual content (skip empty deltas)
        if (openaiData) {
          try {
            res.write(`data: ${openaiData}\n\n`);
          } catch (error) {
            console.error(`[API] Error writing to response: ${error}`);
            isCompleted = true;
          }
        }
      }
    });

    this.queue.setErrorCallback(requestId, (error: string) => {
      if (!isCompleted) {
        console.error(`[API] Error for ${requestId}: ${error}`);
        isCompleted = true;
        try {
          res.write(`data: ${JSON.stringify({ error: error })}\n\n`);
          res.end();
        } catch (error) {
          console.error(`[API] Error ending response: ${error}`);
        }
      }
    });

    this.queue.setCompleteCallback(requestId, () => {
      if (!isCompleted) {
        console.log(`[API] Request ${requestId} completed`);
        isCompleted = true;
        try {
          // Send final message with finish_reason
          res.write(`data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: request.model || 'doubao',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              prompt_tokens_details: {
                cached_tokens: 0
              },
              completion_tokens_details: {
                reasoning_tokens: 0
              }
            }
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (error) {
          console.error(`[API] Error ending response: ${error}`);
        }
      }
    });
    
    // Send initial comment to flush headers immediately
    res.write(': connected\n\n');

    // Send message to client
    const message: WebSocketMessage = {
      type: 'message',
      id: requestId,
      content: request.messages[request.messages.length - 1].content,
    };

    console.log(`[API] Sending message to client ${clientId}: ${(message.content || '').substring(0, 50)}...`);
    
    this.wsManager.sendMessage(clientId, message).then(() => {
      console.log(`[API] Message sent successfully to client ${clientId}`);
    }).catch((error) => {
      console.error(`[API] Failed to send message to client: ${error}`);
      if (!isCompleted) {
        isCompleted = true;
        this.queue.handleError(requestId, 'Failed to send message to client');
        try {
          res.write(`data: {"error": "Failed to send message to client"}\n\n`);
          res.end();
        } catch (error) {
          console.error(`[API] Error ending response: ${error}`);
        }
      }
    });
  }

  private handleNonStreamingResponse(req: Request, res: Response, requestId: string, clientId: string, request: ChatCompletionRequest) {
    let fullContent = '';
    let hasError = false;
    let isCompleted = false;

    // Setup callbacks to collect all data
    this.queue.setResponseCallback(requestId, (data: string) => {
      console.log(`[API] Collecting data for ${requestId}: ${data.substring(0, 50)}...`);
      try {
        const obj = JSON.parse(data);
        
        // Extract text content from various response formats
        if (obj.text) {
          fullContent += obj.text;
        } else if (obj.content?.content_block?.[0]?.content?.text_block?.text) {
          fullContent += obj.content.content_block[0].content.text_block.text;
        } else if (obj.patch_op?.[0]?.patch_value?.content_block?.[0]?.content?.text_block?.text) {
          fullContent += obj.patch_op[0].patch_value.content_block[0].content.text_block.text;
        }
      } catch (error) {
        // Ignore parse errors, just skip this chunk
      }
    });

    this.queue.setErrorCallback(requestId, (error: string) => {
      if (!isCompleted) {
        console.error(`[API] Error for ${requestId}: ${error}`);
        isCompleted = true;
        hasError = true;
        res.status(500).json({ error: error });
      }
    });

    this.queue.setCompleteCallback(requestId, () => {
      if (!isCompleted) {
        console.log(`[API] Request ${requestId} completed with content: ${fullContent.substring(0, 50)}...`);
        isCompleted = true;
        
        if (!hasError) {
          // Return complete response in OpenAI format
          res.json({
            id: requestId,
            object: 'text_completion',
            created: Math.floor(Date.now() / 1000),
            model: request.model || 'doubao',
            choices: [
              {
                text: fullContent,
                index: 0,
                logprobs: null,
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0
            }
          });
        }
      }
    });

    // Send message to client
    const message: WebSocketMessage = {
      type: 'message',
      id: requestId,
      content: request.messages[request.messages.length - 1].content,
    };

    console.log(`[API] Sending message to client ${clientId}: ${(message.content || '').substring(0, 50)}...`);
    
    this.wsManager.sendMessage(clientId, message).then(() => {
      console.log(`[API] Message sent successfully to client ${clientId}`);
    }).catch((error) => {
      console.error(`[API] Failed to send message to client: ${error}`);
      if (!isCompleted) {
        isCompleted = true;
        this.queue.handleError(requestId, 'Failed to send message to client');
        res.status(500).json({ error: 'Failed to send message to client' });
      }
    });
  }

  public getApp(): Express {
    return this.app;
  }
}
