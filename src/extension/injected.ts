// This script is injected into the page's main context to intercept fetch calls
// It communicates with the content script via window.postMessage

console.log('=== Injected Script Loaded ===');

// Store original fetch
const originalFetch = window.fetch;
console.log('Original fetch stored');

// Override fetch
window.fetch = function (this: any, ...args: any[]) {
  const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
  console.log('[INJECTED] Fetch called:', url);
  
  // Call original fetch
  const fetchPromise = (originalFetch as any).apply(this, args);
  
  // If this is the SSE endpoint, handle it
  if (url.includes('/chat/completion')) {
    console.log('[INJECTED] SSE endpoint detected!');
    
    return fetchPromise.then((response: Response) => {
      console.log('[INJECTED] Got response, status:', response.status);
      
      // Clone the response so we can read it
      const clonedResponse = response.clone();
      
      // Read the body as a stream
      const reader = clonedResponse.body?.getReader();
      if (reader) {
        console.log('[INJECTED] Starting to read SSE stream');
        const decoder = new TextDecoder();
        let buffer = '';
        
        const readChunk = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              console.log('[INJECTED] SSE stream ended');
              // Send completion signal
              window.postMessage({
                type: 'llm-proxy-sse-done'
              }, '*');
              return;
            }
            
            console.log('[INJECTED] Read chunk, size:', value?.length);
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            console.log('[INJECTED] Processing', lines.length, 'lines');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                console.log('[INJECTED] SSE data:', data.substring(0, 50));
                // Send to content script via postMessage
                window.postMessage({
                  type: 'llm-proxy-sse-data',
                  data: data
                }, '*');
              }
            }
            
            readChunk();
          }).catch((error: any) => {
            console.error('[INJECTED] Error reading SSE stream:', error);
            // Send error signal
            window.postMessage({
              type: 'llm-proxy-sse-error',
              error: String(error)
            }, '*');
          });
        };
        
        readChunk();
      } else {
        console.log('[INJECTED] No reader available for response body');
      }
      
      // Return the original response
      return response;
    }).catch((error: any) => {
      console.error('[INJECTED] Fetch error:', error);
      throw error;
    });
  }
  
  return fetchPromise;
} as any;

console.log('[INJECTED] Fetch interception setup complete');
