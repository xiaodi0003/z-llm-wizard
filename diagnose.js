#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');

console.log('=== LLM Proxy Service Diagnostic ===\n');

// Test 1: Check if HTTP server is running
console.log('Test 1: Checking HTTP server on port 3107...');
const httpReq = http.get('http://localhost:3107/health', (res) => {
  console.log('✓ HTTP server is running (status: ' + res.statusCode + ')');
  testWebSocket();
}).on('error', (err) => {
  console.log('✗ HTTP server is not responding:', err.message);
  console.log('  Make sure to run: npm start\n');
  testWebSocket();
});

// Test 2: Check if WebSocket server is running
function testWebSocket() {
  console.log('\nTest 2: Checking WebSocket server on port 8107...');
  try {
    const ws = new WebSocket('ws://localhost:8107');
    
    ws.on('open', () => {
      console.log('✓ WebSocket server is running');
      console.log('✓ Successfully connected to WebSocket');
      
      // Send a test message
      ws.send(JSON.stringify({
        type: 'test',
        id: 'test-123',
        data: 'test'
      }));
      
      ws.close();
      testAPI();
    });
    
    ws.on('error', (err) => {
      console.log('✗ WebSocket server error:', err.message);
      testAPI();
    });
    
    // Timeout after 3 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.log('✗ WebSocket connection timeout');
        ws.close();
        testAPI();
      }
    }, 3000);
  } catch (err) {
    console.log('✗ WebSocket error:', err.message);
    testAPI();
  }
}

// Test 3: Test API endpoint
function testAPI() {
  console.log('\nTest 3: Testing /v1/chat/completions endpoint...');
  
  const options = {
    hostname: 'localhost',
    port: 3107,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  const req = http.request(options, (res) => {
    console.log('✓ API endpoint responded with status:', res.statusCode);
    console.log('  Headers:', JSON.stringify(res.headers, null, 2));
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      if (data) {
        console.log('✓ Received response data:', data.substring(0, 100));
      } else {
        console.log('✗ No response data received (stream may be waiting for client)');
      }
      
      console.log('\n=== Diagnostic Summary ===');
      console.log('If you see "No response data received", it means:');
      console.log('1. The server is waiting for a Chrome extension client to connect');
      console.log('2. Make sure the Chrome extension is loaded and connected');
      console.log('3. Check the Chrome extension console for errors');
      console.log('4. Verify the extension is pointing to ws://localhost:8080');
    });
  });
  
  req.on('error', (err) => {
    console.log('✗ API request failed:', err.message);
    console.log('  Make sure the server is running: npm start');
  });
  
  const payload = JSON.stringify({
    messages: [
      {
        role: 'user',
        content: 'Test message'
      }
    ]
  });
  
  req.write(payload);
  req.end();
  
  // Timeout after 5 seconds
  setTimeout(() => {
    process.exit(0);
  }, 5000);
}
