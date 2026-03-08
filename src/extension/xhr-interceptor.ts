export class XHRInterceptor {
  private originalFetch: typeof fetch;
  private onSSEData: (data: string) => void;
  private onSSEComplete: () => void;
  private onSSEError: (error: string) => void;

  constructor(
    onSSEData: (data: string) => void,
    onSSEComplete: () => void,
    onSSEError: (error: string) => void
  ) {
    this.originalFetch = window.fetch;
    this.onSSEData = onSSEData;
    this.onSSEComplete = onSSEComplete;
    this.onSSEError = onSSEError;
  }

  public setup() {
    window.fetch = this.interceptFetch.bind(this);
  }

  private async interceptFetch(...args: any[]): Promise<Response> {
    const url = args[0];
    const isSSERequest = typeof url === 'string' && url.includes('/chat/completion');

    const response = await (this.originalFetch as any).apply(window, args);

    if (isSSERequest && response.ok) {
      this.handleSSEResponse(response.clone());
    }

    return response;
  }

  private async handleSSEResponse(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) {
      this.onSSEError('Could not read response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.onSSEComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        this.processBuffer(buffer);
        buffer = this.getRemainingBuffer(buffer);
      }
    } catch (error) {
      console.error('Error reading SSE response:', error);
      this.onSSEError(`Error reading response: ${error}`);
    }
  }

  private processBuffer(buffer: string) {
    const lines = buffer.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          this.onSSEComplete();
        } else if (data) {
          this.onSSEData(data);
        }
      }
    }
  }

  private getRemainingBuffer(buffer: string): string {
    const lastNewlineIndex = buffer.lastIndexOf('\n');
    if (lastNewlineIndex === -1) {
      return buffer;
    }
    return buffer.slice(lastNewlineIndex + 1);
  }

  public restore() {
    window.fetch = this.originalFetch;
  }
}
