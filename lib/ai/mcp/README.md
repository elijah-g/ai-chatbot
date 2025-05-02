# MCP Client

This module provides a TypeScript client for interacting with an MCP (Model Context Protocol) server, which provides tools for Microsoft 365 integration.

## Features

- Session initialization and management
- Tool discovery through the `tools/list` endpoint
- Tool invocation through the `tools/invoke` endpoint
- Typed response handling

## Usage

### Basic Example

```typescript
import { createMcpClient } from './client';

// Create a client
const mcpClient = createMcpClient({
  baseUrl: 'http://localhost:8080',
  clientName: 'your-app-name',
  clientVersion: '1.0.0'
});

// Initialize a session
const sessionInfo = await mcpClient.initialize();
console.log(`Session initialized with ID: ${sessionInfo.sessionId}`);

// List available tools
const tools = await mcpClient.listTools();
console.log(`Found ${tools.length} tools`);

// Invoke a tool
const result = await mcpClient.invokeTool('example_tool', {
  message: 'Hello world!'
});
console.log('Tool result:', result);
```

### Microsoft 365 Tools

The client supports Microsoft 365 tools exposed by the MCP server, including:

- Authentication (login, verify-login, logout)
- Calendar operations (get-calendar-view, list-calendar-events, etc.)
- Mail operations (list-mail-messages, get-mail-message)

See the example.ts file for more examples of invoking specific tools.

## Running the Example

To run the included example:

```
# With ts-node installed
node run-example.js

# Or after compiling TypeScript
tsc
node run-example.js
```

## Protocol Details

The MCP client implements the JSON-RPC 2.0 protocol for communication with the server. The session ID is stored in the client and automatically reused for subsequent requests.

The communication flow is:

1. Initialize a session with `/mcp` and the `initialize` method
2. Extract the session ID from the response headers
3. Use this session ID in subsequent requests by setting the `Mcp-Session-Id` header
4. The server validates the session and processes the request

If the session expires, a new one will be automatically created on the next request. 