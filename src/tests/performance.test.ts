import { RequestQueue } from '../server/queue';

describe('Performance and Stability Tests', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  test('should handle large message processing', async () => {
    const largeContent = 'x'.repeat(1000000); // 1MB message
    const request = {
      messages: [{ role: 'user' as const, content: largeContent }],
    };

    const requestId = queue.addRequest(request);
    expect(requestId).toBeDefined();

    let receivedData = '';
    queue.setResponseCallback(requestId, (data: string) => {
      receivedData += data;
    });

    // Simulate large response
    const largeResponse = 'y'.repeat(1000000);
    queue.handleSSEData(requestId, largeResponse);

    expect(receivedData.length).toBe(1000000);
  });

  test('should maintain stability with long-running operations', async () => {
    const requests = [];
    for (let i = 0; i < 100; i++) {
      const request = {
        messages: [{ role: 'user' as const, content: `Request ${i}` }],
      };
      requests.push(queue.addRequest(request));
    }

    expect(queue.getQueueSize()).toBe(100);

    // Process all requests
    requests.forEach((requestId) => {
      queue.handleSSEData(requestId, 'response');
      queue.handleComplete(requestId);
    });

    expect(queue.getQueueSize()).toBe(0);
  });

  test('should not leak memory with repeated operations', async () => {
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const request = {
        messages: [{ role: 'user' as const, content: `Request ${i}` }],
      };
      const requestId = queue.addRequest(request);
      queue.handleSSEData(requestId, 'response');
      queue.handleComplete(requestId);
    }

    expect(queue.getQueueSize()).toBe(0);
  });

  test('should handle rapid request creation and completion', async () => {
    const startTime = Date.now();
    const requestCount = 500;

    for (let i = 0; i < requestCount; i++) {
      const request = {
        messages: [{ role: 'user' as const, content: `Request ${i}` }],
      };
      const requestId = queue.addRequest(request);
      queue.handleComplete(requestId);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should complete 500 requests in reasonable time (< 5 seconds)
    expect(duration).toBeLessThan(5000);
    expect(queue.getQueueSize()).toBe(0);
  });
});
