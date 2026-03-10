interface MessageData {
  type: string;
  id: string;
  content?: string;
  [key: string]: any;
}

console.log('=== LLM Proxy Content Script Loaded ===');

let currentRequestId: string | null = null;
let isWaitingForResponse = false;
const sseDataBuffer: string[] = [];
let isBackgroundConnected = false;

// Check background worker connection status periodically
async function checkBackgroundConnection() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'get_connection_status'
    });
    isBackgroundConnected = response.status === 'connected';
    console.log('[Connection] Background worker status:', response.status);
  } catch (error) {
    isBackgroundConnected = false;
    console.log('[Connection] Background worker not responding');
  }
}

// Check connection every 5 seconds
setInterval(checkBackgroundConnection, 5000);
checkBackgroundConnection();

// Inject the fetch interceptor script into the page context
console.log('About to inject script from file');
try {
  const scriptUrl = chrome.runtime.getURL('injected.js');
  console.log('Script URL:', scriptUrl);
  
  const script = document.createElement('script');
  script.src = scriptUrl;
  script.type = 'text/javascript';
  script.onload = function() {
    console.log('Injected script loaded successfully');
    (this as HTMLScriptElement).remove();
  };
  script.onerror = function(error) {
    console.error('Failed to load injected script:', error);
  };
  
  if (document.head) {
    document.head.appendChild(script);
  } else if (document.documentElement) {
    document.documentElement.appendChild(script);
  }
  console.log('Script appended to document');
} catch (error) {
  console.error('Error injecting script:', error);
}

// Listen for messages from the injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'llm-proxy-sse-data') {
    console.log('Received SSE data from injected script:', event.data.data.substring(0, 50));
    if (currentRequestId) {
      sendSSEDataToBackground(event.data.data);
    }
  } else if (event.data.type === 'llm-proxy-sse-done') {
    console.log('Received SSE done signal from injected script');
    if (currentRequestId) {
      sendDoneToBackground();
    }
  } else if (event.data.type === 'llm-proxy-sse-error') {
    console.log('Received SSE error signal from injected script:', event.data.error);
    if (currentRequestId) {
      sendErrorToBackground(`SSE error: ${event.data.error}`);
    }
  }
});

// Setup fetch interception immediately when script loads
console.log('About to setup fetch interception');
setupXHRInterception();
console.log('Fetch interception setup complete');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: MessageData, sender, sendResponse) => {
  console.log('Content Script received message:', message);
  if (message.type === 'message') {
    currentRequestId = message.id;
    isWaitingForResponse = true;
    console.log('Processing incoming message with ID:', currentRequestId);
    
    // Handle async message processing
    handleIncomingMessage(message.content || '')
      .then(() => {
        console.log('Message handling completed');
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error handling message:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send response asynchronously
    return true;
  } else if (message.type === 'ping') {
    console.log('Ping received, responding with pong');
    sendResponse({ pong: true });
  }
});

async function handleIncomingMessage(content: string) {
  console.log('handleIncomingMessage called with:', content);
  
  // Wait for page to load (max 10 seconds)
  const inputBox = await waitForElement(() => findInputBox(), 10000);
  if (!inputBox) {
    console.error('Could not find input box after waiting');
    console.log('Available elements:', document.querySelectorAll('textarea, input[type="text"]').length);
    sendErrorToBackground('Could not find input box - page may not have loaded');
    return;
  }

  console.log('Found input box:', inputBox.tagName);

  // Set the input value
  setInputValue(inputBox, content);
  console.log('Input value set');

  // Wait for send button to load
  const sendButton = await waitForElement(() => findSendButton(), 10000);
  if (!sendButton) {
    console.error('Could not find send button after waiting');
    console.log('Available buttons:', document.querySelectorAll('button').length);
    sendErrorToBackground('Could not find send button - page may not have loaded');
    return;
  }

  console.log('Found send button:', sendButton.textContent);

  // Click the send button
  console.log('About to click send button');
  sendButton.click();
  console.log('Send button clicked - waiting for response');
  
  // Wait a bit and check if fetch was called
  setTimeout(() => {
    console.log('Waited 2 seconds - if no fetch logs appeared, fetch was not called');
  }, 2000);
}

// Helper function to wait for an element to appear
async function waitForElement(
  findFn: () => HTMLElement | null,
  maxWaitTime: number = 10000,
  checkInterval: number = 500
): Promise<HTMLElement | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const element = findFn();
    if (element) {
      console.log('[WaitForElement] Element found after', Date.now() - startTime, 'ms');
      return element;
    }
    
    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  console.log('[WaitForElement] Element not found after', maxWaitTime, 'ms');
  return null;
}

function findInputBox(): HTMLTextAreaElement | HTMLInputElement | null {
  console.log('Searching for input box...');
  
  // Try specific selectors for Douyin chat
  const selectors = [
    'textarea[data-testid="chat_input_input"]',
    'textarea[class*="semi-input-textarea"]',
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    'input[placeholder*="发消息"]',
    'input[placeholder*="message"]',
    'input[placeholder*="Message"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    console.log(`Selector "${selector}" found ${elements.length} elements`);
    
    for (const element of elements) {
      if (isVisible(element)) {
        console.log(`Found visible input with selector: ${selector}`);
        return element as HTMLTextAreaElement | HTMLInputElement;
      }
    }
  }

  // If no selector worked, try to find any visible textarea or input
  const allTextareas = document.querySelectorAll('textarea');
  for (const textarea of allTextareas) {
    if (isVisible(textarea)) {
      console.log('Found visible textarea');
      return textarea as HTMLTextAreaElement;
    }
  }

  const allInputs = document.querySelectorAll('input[type="text"]');
  for (const input of allInputs) {
    if (isVisible(input)) {
      console.log('Found visible text input');
      return input as HTMLInputElement;
    }
  }

  return null;
}

function findSendButton(): HTMLButtonElement | null {
  console.log('Searching for send button...');
  
  // Try specific selectors for Douyin chat
  const selectors = [
    '#flow-end-msg-send',
    'button[data-testid="chat_input_send_button"]',
    'button[id*="send"]',
    'button[data-dbx-name="button"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'button[title*="发送"]',
    'button[title*="Send"]',
    'button[class*="send"]',
    'button[class*="Send"]',
    'button[class*="submit"]',
    'button[class*="Submit"]',
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    console.log(`Selector "${selector}" found ${elements.length} elements`);
    
    for (const element of elements) {
      if (isVisible(element)) {
        console.log(`Found visible button with selector: ${selector}`);
        return element as HTMLButtonElement;
      }
    }
  }

  // Try to find by text content
  const buttons = document.querySelectorAll('button');
  console.log(`Found ${buttons.length} total buttons`);
  
  // Log first 10 buttons for debugging
  for (let i = 0; i < Math.min(10, buttons.length); i++) {
    const btn = buttons[i];
    console.log(`Button ${i}: id="${btn.id}", text="${btn.textContent?.substring(0, 20)}", class="${btn.className}", aria-label="${btn.getAttribute('aria-label')}", title="${btn.getAttribute('title')}", data-testid="${btn.getAttribute('data-testid')}"`);
  }
  
  for (const button of buttons) {
    const text = button.textContent || '';
    if ((text.includes('发送') || text.includes('Send') || text.includes('submit')) && isVisible(button)) {
      console.log(`Found button by text: "${text}"`);
      return button;
    }
  }

  return null;
}

function setInputValue(element: HTMLTextAreaElement | HTMLInputElement | Element, value: string) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.value = value;
    // Trigger input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (element.hasAttribute('contenteditable')) {
    element.textContent = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function setupXHRInterception() {
  console.log('Setting up fetch interception');
  
  // Store original fetch
  const originalFetch = window.fetch;
  console.log('Original fetch stored:', typeof originalFetch);
  
  let fetchCallCount = 0;
  
  // Override fetch
  window.fetch = function (this: any, ...args: any[]) {
    fetchCallCount++;
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    console.log(`[FETCH #${fetchCallCount}] URL:`, url);
    
    // Call original fetch
    const fetchPromise = (originalFetch as any).apply(this, args);
    
    // If this is the SSE endpoint, handle it
    if (url.includes('/chat/completion')) {
      console.log('SSE endpoint detected! URL:', url);
      
      return fetchPromise.then((response: Response) => {
        console.log('Got response, status:', response.status, 'content-type:', response.headers.get('content-type'));
        
        // Clone the response so we can read it
        const clonedResponse = response.clone();
        
        // Read the body as a stream
        const reader = clonedResponse.body?.getReader();
        if (reader) {
          console.log('Starting to read SSE stream');
          const decoder = new TextDecoder();
          let buffer = '';
          
          const readChunk = () => {
            reader.read().then(({ done, value }) => {
              if (done) {
                console.log('SSE stream ended');
                sendDoneToBackground();
                return;
              }
              
              console.log('Read chunk, size:', value?.length);
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              
              console.log('Processing', lines.length, 'lines');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  console.log('SSE data:', data.substring(0, 50));
                  if (data === '[DONE]') {
                    sendDoneToBackground();
                  } else if (data) {
                    sendSSEDataToBackground(data);
                  }
                }
              }
              
              readChunk();
            }).catch((error: any) => {
              console.error('Error reading SSE stream:', error);
              sendErrorToBackground(`Error reading stream: ${error}`);
            });
          };
          
          readChunk();
        } else {
          console.log('No reader available for response body');
        }
        
        // Return the original response
        return response;
      }).catch((error: any) => {
        console.error('Fetch error:', error);
        sendErrorToBackground(`Fetch error: ${error}`);
        throw error;
      });
    }
    
    return fetchPromise;
  } as any;
}

async function handleSSEResponse(response: Response) {
  console.log('handleSSEResponse called');
  
  if (!currentRequestId) {
    console.log('No current request ID');
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    console.error('Could not read response body');
    sendErrorToBackground('Could not read response body');
    return;
  }

  console.log('Starting to read SSE response');
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('SSE stream completed');
        sendDoneToBackground();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          console.log('SSE data received:', data.substring(0, 50));
          if (data === '[DONE]') {
            console.log('SSE stream done marker received');
            sendDoneToBackground();
          } else {
            sendSSEDataToBackground(data);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error reading SSE response:', error);
    sendErrorToBackground(`Error reading response: ${error}`);
  }
}

function sendSSEDataToBackground(data: string) {
  if (!currentRequestId) return;

  // Buffer the data if background worker is not connected
  if (!isBackgroundConnected) {
    console.log('[Buffer] Background not connected, buffering SSE data');
    sseDataBuffer.push(data);
    return;
  }

  // Send buffered data first if any
  if (sseDataBuffer.length > 0) {
    console.log('[Buffer] Sending', sseDataBuffer.length, 'buffered messages');
    sseDataBuffer.forEach(bufferedData => {
      chrome.runtime.sendMessage({
        type: 'sse',
        id: currentRequestId,
        data: bufferedData,
      }).catch((error) => {
        console.error('[Buffer] Failed to send buffered SSE data:', error);
      });
    });
    sseDataBuffer.length = 0;
  }

  // Send current data
  chrome.runtime.sendMessage({
    type: 'sse',
    id: currentRequestId,
    data: data,
  }).catch((error) => {
    console.error('Failed to send SSE data to background:', error);
    // Re-buffer if send fails
    sseDataBuffer.push(data);
  });
}

function sendDoneToBackground() {
  if (!currentRequestId) return;

  // Send any remaining buffered data
  if (sseDataBuffer.length > 0) {
    console.log('[Buffer] Sending', sseDataBuffer.length, 'buffered messages before done');
    sseDataBuffer.forEach(bufferedData => {
      chrome.runtime.sendMessage({
        type: 'sse',
        id: currentRequestId,
        data: bufferedData,
      }).catch((error) => {
        console.error('[Buffer] Failed to send buffered SSE data:', error);
      });
    });
    sseDataBuffer.length = 0;
  }

  chrome.runtime.sendMessage({
    type: 'done',
    id: currentRequestId,
  }).catch((error) => {
    console.error('Failed to send done signal to background:', error);
  });

  currentRequestId = null;
  isWaitingForResponse = false;
}

function sendErrorToBackground(error: string) {
  if (!currentRequestId) return;

  chrome.runtime.sendMessage({
    type: 'error',
    id: currentRequestId,
    error: error,
  }).catch((error) => {
    console.error('Failed to send error to background:', error);
  });

  currentRequestId = null;
  isWaitingForResponse = false;
  sseDataBuffer.length = 0;
}
