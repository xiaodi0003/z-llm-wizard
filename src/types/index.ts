// WebSocket message types
export interface WebSocketMessage {
  type: 'message' | 'sse' | 'done' | 'error';
  id: string;
  content?: string;
  data?: string;
  error?: string;
}

// HTTP request types
export interface ChatCompletionRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

// Queue request types
export interface QueuedRequest {
  id: string;
  request: ChatCompletionRequest;
  createdAt: number;
  responseCallback?: (data: string) => void;
  errorCallback?: (error: string) => void;
  completeCallback?: () => void;
}
