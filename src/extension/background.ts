const SERVER_URL = 'ws://localhost:8107';
const INITIAL_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const STORAGE_KEY = 'pending_messages';

interface PendingMessage {
  type: string;
  id: string;
  [key: string]: any;
}

let ws: WebSocket | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let reconnectTimeout: NodeJS.Timeout | null = null;
const pendingMessages: Map<string, PendingMessage> = new Map();
let isConnecting = false;

// Load pending messages from storage on startup
async function loadPendingMessages() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (data[STORAGE_KEY]) {
      const messages = JSON.parse(data[STORAGE_KEY]);
      messages.forEach((msg: PendingMessage) => {
        pendingMessages.set(msg.id, msg);
      });
      console.log(`[Storage] Loaded ${messages.length} pending messages`);
    }
  } catch (error) {
    console.error('[Storage] Failed to load pending messages:', error);
  }
}

// Save pending messages to storage
async function savePendingMessages() {
  try {
    const messages = Array.from(pendingMessages.values());
    await chrome.storage.local.set({
      [STORAGE_KEY]: JSON.stringify(messages)
    });
  } catch (error) {
    console.error('[Storage] Failed to save pending messages:', error);
  }
}

function connectWebSocket() {
  if (isConnecting) {
    console.log('[WebSocket] Connection attempt already in progress');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[WebSocket] Already connected');
    return;
  }

  isConnecting = true;
  console.log(`[WebSocket] Connecting to ${SERVER_URL}...`);

  try {
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('[WebSocket] Connected successfully');
      isConnecting = false;
      reconnectDelay = INITIAL_RECONNECT_DELAY;
      
      // Send any pending messages
      const messagesToSend = Array.from(pendingMessages.values());
      if (messagesToSend.length > 0) {
        console.log(`[WebSocket] Sending ${messagesToSend.length} pending messages`);
        messagesToSend.forEach((msg) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        });
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      isConnecting = false;
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      isConnecting = false;
      attemptReconnect();
    };
  } catch (error) {
    console.error('[WebSocket] Failed to create connection:', error);
    isConnecting = false;
    attemptReconnect();
  }
}

function attemptReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  console.log(`[Reconnect] Scheduling reconnection in ${reconnectDelay}ms`);
  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
    // Increase delay with exponential backoff, capped at MAX_RECONNECT_DELAY
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

function handleServerMessage(message: any) {
  console.log('[Server] Received message:', message.type, 'id:', message.id);
  if (message.type === 'message') {
    console.log('[Server] Forwarding message to content script');
    // Forward message to content script
    chrome.tabs.query({ url: 'https://www.doubao.com/*' }, (tabs) => {
      console.log('[Server] Found', tabs.length, 'tabs matching URL');
      tabs.forEach((tab) => {
        if (tab.id) {
          console.log('[Server] Sending message to tab', tab.id);
          chrome.tabs.sendMessage(tab.id, message).catch((error) => {
            console.error('[Server] Failed to send message to content script:', error);
          });
        }
      });
    });
  }
}

function sendToServer(message: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[Send] Sending message to server:', message.type);
    ws.send(JSON.stringify(message));
    // Remove from pending if it was there
    pendingMessages.delete(message.id);
    savePendingMessages();
  } else {
    // Store message for later
    console.log('[Send] WebSocket not connected, queuing message:', message.type);
    pendingMessages.set(message.id, message);
    savePendingMessages();
    
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Message] Background received:', message.type, 'from', sender?.url);
  if (message.type === 'sse' || message.type === 'done' || message.type === 'error') {
    console.log('[Message] Forwarding to server:', message.type);
    sendToServer(message);
    sendResponse({ success: true });
  } else if (message.type === 'get_connection_status') {
    const status = ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
    console.log('[Message] Connection status:', status);
    sendResponse({ status });
  } else {
    console.log('[Message] Ignoring message type:', message.type);
  }
});

// Initialize connection and load pending messages
loadPendingMessages().then(() => {
  connectWebSocket();
});

// Periodic heartbeat check to keep service worker alive
setInterval(() => {
  console.log('[Heartbeat] Checking WebSocket connection...');
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[Heartbeat] WebSocket not connected, attempting to reconnect');
    connectWebSocket();
  } else {
    console.log('[Heartbeat] WebSocket is connected');
  }
}, 10000);

// Send ping to keep the connection alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[Ping] Sending ping to server');
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch (error) {
      console.error('[Ping] Failed to send ping:', error);
    }
  }
}, 15000);
