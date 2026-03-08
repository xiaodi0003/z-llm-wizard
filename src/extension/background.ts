const SERVER_URL = 'ws://localhost:8107';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface PendingMessage {
  type: string;
  id: string;
  [key: string]: any;
}

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
const pendingMessages: Map<string, PendingMessage> = new Map();

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttempts = 0;
      // Send any pending messages
      pendingMessages.forEach((msg) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      attemptReconnect();
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    attemptReconnect();
  }
}

function attemptReconnect() {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(() => {
      connectWebSocket();
    }, RECONNECT_DELAY);
  } else {
    console.error('Max reconnection attempts reached');
  }
}

function handleServerMessage(message: any) {
  console.log('Server sent message:', message.type, 'id:', message.id);
  if (message.type === 'message') {
    console.log('Forwarding message to content script');
    // Forward message to content script
    chrome.tabs.query({ url: 'https://www.doubao.com/*' }, (tabs) => {
      console.log('Found', tabs.length, 'tabs matching URL');
      tabs.forEach((tab) => {
        if (tab.id) {
          console.log('Sending message to tab', tab.id);
          chrome.tabs.sendMessage(tab.id, message).catch((error) => {
            console.error('Failed to send message to content script:', error);
          });
        }
      });
    });
  }
}

function sendToServer(message: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    // Store message for later
    pendingMessages.set(message.id, message);
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, 'from', sender?.url);
  if (message.type === 'sse' || message.type === 'done' || message.type === 'error') {
    console.log('Forwarding to server:', message.type);
    sendToServer(message);
    sendResponse({ success: true });
  } else {
    console.log('Ignoring message type:', message.type);
  }
});

// Initialize connection
connectWebSocket();

// Periodic heartbeat check
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
}, 30000);
