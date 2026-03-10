const SERVER_URL = 'ws://localhost:8107';
const INITIAL_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const STORAGE_KEY = 'pending_messages';

// Import types from tab-pool
interface TabInfo {
  tabId: number;
  url: string;
  isIdle: boolean;
  currentRequestId: string | null;
  createdAt: number;
  lastActivityAt: number;
  isExtensionManaged: boolean;
}

interface PoolStatus {
  totalTabs: number;
  idleTabs: number;
  busyTabs: number;
  tabs: Array<{
    tabId: number;
    isIdle: boolean;
    currentRequestId: string | null;
    lastActivityAt: number;
  }>;
}

// Active request tracking
interface ActiveRequestInfo {
  id: string;
  tabId: number;
  startTime: number;
}

// Tab pool manager for handling concurrent requests
class TabPoolManager {
  private tabPool: Map<number, TabInfo> = new Map();
  private idleQueue: number[] = [];
  private readonly MAX_TABS = 10;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly DOUYIN_URL = 'https://www.doubao.com/';
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private waitingRequests: Array<{
    resolve: (tabId: number) => void;
    reject: (error: Error) => void;
  }> = [];

  // Get available tab (reuse idle tab or create new one)
  async getAvailableTab(): Promise<number> {
    // 1. Check if there's an idle tab
    if (this.idleQueue.length > 0) {
      const tabId = this.idleQueue.shift()!;
      const tabInfo = this.tabPool.get(tabId)!;
      tabInfo.isIdle = false;
      console.log(`[TabPool] Using idle tab: ${tabId}`);
      return tabId;
    }

    // 2. If no idle tab, check if we can create a new one
    if (this.tabPool.size < this.MAX_TABS) {
      const tabId = await this.createNewTab();
      console.log(`[TabPool] Created new tab: ${tabId}`);
      return tabId;
    }

    // 3. If max tabs reached, wait for an idle tab
    console.log(`[TabPool] Max tabs reached, waiting for idle tab...`);
    return new Promise((resolve, reject) => {
      this.waitingRequests.push({ resolve, reject });
    });
  }

  // Create a new Douyin tab
  private async createNewTab(): Promise<number> {
    try {
      const tab = await chrome.tabs.create({
        url: this.DOUYIN_URL,
        active: false
      });

      if (!tab.id) {
        throw new Error('Failed to create tab: no tab ID');
      }

      const tabInfo: TabInfo = {
        tabId: tab.id,
        url: this.DOUYIN_URL,
        isIdle: false,
        currentRequestId: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        isExtensionManaged: true
      };

      this.tabPool.set(tab.id, tabInfo);
      return tab.id;
    } catch (error) {
      console.error('[TabPool] Failed to create tab:', error);
      throw error;
    }
  }

  // Mark tab as idle
  markTabAsIdle(tabId: number): void {
    const tabInfo = this.tabPool.get(tabId);
    if (tabInfo) {
      tabInfo.isIdle = true;
      tabInfo.currentRequestId = null;
      tabInfo.lastActivityAt = Date.now();
      this.idleQueue.push(tabId);
      console.log(`[TabPool] Tab ${tabId} marked as idle`);

      // Process waiting requests
      if (this.waitingRequests.length > 0) {
        const { resolve } = this.waitingRequests.shift()!;
        const nextTabId = this.idleQueue.shift()!;
        const nextTabInfo = this.tabPool.get(nextTabId)!;
        nextTabInfo.isIdle = false;
        console.log(`[TabPool] Assigned idle tab ${nextTabId} to waiting request`);
        resolve(nextTabId);
      }
    }
  }

  // Mark tab as busy
  markTabAsBusy(tabId: number, requestId: string): void {
    const tabInfo = this.tabPool.get(tabId);
    if (tabInfo) {
      tabInfo.isIdle = false;
      tabInfo.currentRequestId = requestId;
      tabInfo.lastActivityAt = Date.now();
      // Remove from idle queue
      const index = this.idleQueue.indexOf(tabId);
      if (index > -1) {
        this.idleQueue.splice(index, 1);
      }
      console.log(`[TabPool] Tab ${tabId} marked as busy with request ${requestId}`);
    }
  }

  // Start idle tab cleanup
  startIdleTabCleanup(): void {
    if (this.cleanupIntervalId !== null) {
      return;
    }

    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      const tabsToClose: number[] = [];

      this.tabPool.forEach((tabInfo, tabId) => {
        if (
          tabInfo.isIdle &&
          tabInfo.isExtensionManaged &&
          now - tabInfo.lastActivityAt > this.IDLE_TIMEOUT
        ) {
          tabsToClose.push(tabId);
        }
      });

      tabsToClose.forEach((tabId) => {
        chrome.tabs.remove(tabId).catch((error) => {
          console.error(`[TabPool] Failed to close tab ${tabId}:`, error);
        });
        this.tabPool.delete(tabId);
        const index = this.idleQueue.indexOf(tabId);
        if (index > -1) {
          this.idleQueue.splice(index, 1);
        }
        console.log(`[TabPool] Closed idle tab: ${tabId}`);
      });
    }, 60000); // Check every minute
  }

  // Stop idle tab cleanup
  stopIdleTabCleanup(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  // Get pool status
  getPoolStatus(): PoolStatus {
    return {
      totalTabs: this.tabPool.size,
      idleTabs: this.idleQueue.length,
      busyTabs: this.tabPool.size - this.idleQueue.length,
      tabs: Array.from(this.tabPool.values()).map((info) => ({
        tabId: info.tabId,
        isIdle: info.isIdle,
        currentRequestId: info.currentRequestId,
        lastActivityAt: info.lastActivityAt
      }))
    };
  }

  // Handle tab closed event
  handleTabClosed(tabId: number): void {
    const tabInfo = this.tabPool.get(tabId);
    if (tabInfo && tabInfo.isExtensionManaged) {
      this.tabPool.delete(tabId);
      const index = this.idleQueue.indexOf(tabId);
      if (index > -1) {
        this.idleQueue.splice(index, 1);
      }
      console.log(`[TabPool] Tab ${tabId} closed`);
    }
  }

  // Get tab info
  getTabInfo(tabId: number): TabInfo | undefined {
    return this.tabPool.get(tabId);
  }

  // Get all tabs
  getAllTabs(): TabInfo[] {
    return Array.from(this.tabPool.values());
  }
}

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
const tabPoolManager = new TabPoolManager();
const activeRequests: Map<string, ActiveRequestInfo> = new Map();

// Load pending messages from storage on startup
async function loadPendingMessages() {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      console.log('[Storage] Chrome storage not available');
      return;
    }
    
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
    if (!chrome.storage || !chrome.storage.local) {
      console.log('[Storage] Chrome storage not available');
      return;
    }
    
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
    // Get available tab from pool
    tabPoolManager.getAvailableTab().then((tabId) => {
      // Mark tab as busy
      tabPoolManager.markTabAsBusy(tabId, message.id);
      // Store request info
      activeRequests.set(message.id, {
        id: message.id,
        tabId: tabId,
        startTime: Date.now()
      });
      
      // Wait for Content Script to be ready before sending message
      waitForContentScriptReady(tabId, message).catch((error) => {
        console.error('[Server] Failed to send message to content script:', error);
        // Mark tab as idle if send failed
        tabPoolManager.markTabAsIdle(tabId);
        activeRequests.delete(message.id);
      });
    }).catch((error) => {
      console.error('[Server] Failed to get available tab:', error);
    });
  }
}

// Wait for Content Script to be ready and send message
async function waitForContentScriptReady(tabId: number, message: any, maxWaitTime: number = 20000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 300; // Check more frequently
  
  // Step 1: Wait for Content Script to be ready
  console.log(`[Server] Waiting for Content Script on tab ${tabId}...`);
  let contentScriptReady = false;
  while (Date.now() - startTime < maxWaitTime && !contentScriptReady) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (response && response.pong) {
        console.log(`[Server] Content Script is ready on tab ${tabId}`);
        contentScriptReady = true;
        break;
      }
    } catch (error) {
      console.log(`[Server] Content Script not ready yet on tab ${tabId}, waiting...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  if (!contentScriptReady) {
    throw new Error(`Content Script not ready on tab ${tabId} after ${maxWaitTime}ms`);
  }
  
  // Step 2: Wait for page to be fully loaded and elements to be ready
  console.log(`[Server] Waiting for page elements on tab ${tabId}...`);
  const pageReadyStartTime = Date.now();
  let pageReady = false;
  let retryCount = 0;
  
  while (Date.now() - pageReadyStartTime < maxWaitTime && !pageReady) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'check_page_ready' });
      if (response && response.ready) {
        console.log(`[Server] Page elements are ready on tab ${tabId} (retry ${retryCount})`);
        pageReady = true;
        break;
      } else {
        retryCount++;
        if (retryCount % 10 === 0) {
          console.log(`[Server] Page elements not ready yet on tab ${tabId}, retry ${retryCount}...`);
        }
      }
    } catch (error) {
      console.log(`[Server] Error checking page ready on tab ${tabId}:`, error);
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  if (!pageReady) {
    throw new Error(`Page elements not ready on tab ${tabId} after ${maxWaitTime}ms`);
  }
  
  // Step 3: Send the actual message
  console.log(`[Server] Sending message to tab ${tabId}...`);
  try {
    await chrome.tabs.sendMessage(tabId, message);
    console.log(`[Server] Message sent successfully to tab ${tabId}`);
  } catch (error) {
    throw new Error(`Failed to send message to tab ${tabId}: ${error}`);
  }
}

function sendToServer(message: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[Send] Sending message to server:', message.type);
    ws.send(JSON.stringify(message));
    // Remove from pending if it was there
    pendingMessages.delete(message.id);
    savePendingMessages();
    
    // If this is a done or error message, mark tab as idle
    if (message.type === 'done' || message.type === 'error') {
      const requestInfo = activeRequests.get(message.id);
      if (requestInfo) {
        tabPoolManager.markTabAsIdle(requestInfo.tabId);
        activeRequests.delete(message.id);
        console.log(`[Send] Tab ${requestInfo.tabId} marked as idle after request ${message.id}`);
      }
    }
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
  } else if (message.type === 'get_pool_status') {
    const poolStatus = tabPoolManager.getPoolStatus();
    console.log('[Message] Pool status:', poolStatus);
    sendResponse({ poolStatus });
  } else {
    console.log('[Message] Ignoring message type:', message.type);
  }
});

// Initialize connection and load pending messages
loadPendingMessages().then(() => {
  connectWebSocket();
});

// Initialize tab pool manager
tabPoolManager.startIdleTabCleanup();

// Handle tab closed event
chrome.tabs.onRemoved.addListener((tabId) => {
  tabPoolManager.handleTabClosed(tabId);
  // Also remove from active requests if this tab was handling a request
  activeRequests.forEach((requestInfo, requestId) => {
    if (requestInfo.tabId === tabId) {
      activeRequests.delete(requestId);
      console.log(`[TabPool] Removed request ${requestId} due to tab closure`);
    }
  });
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
