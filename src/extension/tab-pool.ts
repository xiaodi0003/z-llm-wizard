// Tab pool manager for handling concurrent requests
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

export class TabPoolManager {
  private tabPool: Map<number, TabInfo> = new Map();
  private idleQueue: number[] = [];
  private readonly MAX_TABS = 10;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly DOUYIN_URL = 'https://www.doubao.com/';
  private cleanupIntervalId: number | null = null;
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

    this.cleanupIntervalId = window.setInterval(() => {
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
