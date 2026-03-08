import { WebSocketManager } from '../server/websocket';
import { RequestQueue } from '../server/queue';
import { WebSocketMessage } from '../types';

describe('Integration Tests', () => {
  let wsManager: WebSocketManager;
  let queue: RequestQueue;

  beforeAll(() => {
    wsManager = new WebSocketManager(8081);
    queue = new RequestQueue();
  });

  afterAll(() => {
    wsManager.close();
  });

  test('should handle complete request-response flow', async () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
    };

    const requestId = queue.addRequest(request);
    expect(requestId).toBeDefined();

    let receivedData = '';
    let completed = false;

    queue.setResponseCallback(requestId, (data: string) => {
      receivedData += data;
    });

    queue.setCompleteCallback(requestId, () => {
      completed = true;
    });

    // Simulate client response
    queue.handleSSEData(requestId, 'test data');
    queue.handleComplete(requestId);

    expect(receivedData).toBe('test data');
    expect(completed).toBe(true);
  });

  test('should handle multiple concurrent requests', async () => {
    const requests = [
      { messages: [{ role: 'user' as const, content: 'Request 1' }] },
      { messages: [{ role: 'user' as const, content: 'Request 2' }] },
      { messages: [{ role: 'user' as const, content: 'Request 3' }] },
    ];

    const requestIds = requests.map((req) => queue.addRequest(req));
    expect(requestIds.length).toBe(3);
    expect(new Set(requestIds).size).toBe(3); // All unique
  });

  test('should handle request timeout', async () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'Timeout test' }],
    };

    const requestId = queue.addRequest(request);
    let errorReceived = false;

    queue.setErrorCallback(requestId, (error: string) => {
      errorReceived = true;
    });

    // Wait for timeout (30 seconds)
    await new Promise((resolve) => setTimeout(resolve, 31000));

    expect(errorReceived).toBe(true);
  });

  test('should handle client disconnect', async () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'Disconnect test' }],
    };

    const requestId = queue.addRequest(request);
    queue.removeRequest(requestId);

    const retrievedRequest = queue.getRequest(requestId);
    expect(retrievedRequest).toBeUndefined();
  });

  test('should handle error messages from client', async () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'Error test' }],
    };

    const requestId = queue.addRequest(request);
    let errorMessage = '';

    queue.setErrorCallback(requestId, (error: string) => {
      errorMessage = error;
    });

    queue.handleError(requestId, 'Test error');

    expect(errorMessage).toBe('Test error');
  });
});
