# Microsoft 365 Integration

This document explains how the Microsoft 365 integration works using the Model Control Protocol (MCP) implementation.

## Setup

1. Clone the repository and install dependencies:
```
git clone https://github.com/your-org/ms-365-mcp-server.git
cd ms-365-mcp-server
npm install
```

2. Configure environment variables in `.env.local` (in the AI chatbot project):
```
MCP_SERVER_URL=http://localhost:4891
NEXT_PUBLIC_MS365_MCP_URL=http://localhost:4891
```

3. Start the MCP server:
```
cd ms-365-mcp-server
npm start
```

4. Start the AI chatbot:
```
cd ai-chatbot
npm run dev
```

## How it works

The integration uses a direct StreamableHTTP approach to connect to the MCP server:

1. The AI chatbot backend connects to the MCP server using the StreamableHTTP protocol
2. All communication between the AI chatbot and MCP server uses JSON RPC over HTTP
3. Each API endpoint in the AI chatbot uses the `getOrCreateMcpClient` function to establish and manage connections to the MCP server

## Troubleshooting

If you encounter issues with the Microsoft 365 integration:

1. Make sure the MCP server is running with `npm start` in the ms-365-mcp-server directory
2. Check your network connection to ensure the AI chatbot can reach the MCP server
3. Test connectivity using a simple ping request:
   ```
   curl http://localhost:4891/ping
   ```
   You should see a response like: `{"status":"ok","message":"M365 MCP server is running"}`
4. Check logs for [MCP Debug] messages that indicate connection issues
5. Ensure `MCP_SERVER_URL` is set correctly in your `.env.local` file with the `http://` prefix
6. Verify your Microsoft Azure AD permissions are correctly set up

## API Endpoints

The AI chatbot provides several API endpoints for interacting with Microsoft 365:

- `/api/m365/ping` - Check if the MCP server is available
- `/api/m365/login` - Authenticate with Microsoft 365
- `/api/m365/verify-login` - Check if a user is authenticated
- `/api/m365/logout` - Log out from Microsoft 365
- `/api/m365/invoke` - Invoke an M365 tool through the MCP server
- `/api/m365/call-tool` - Call a specific tool on the MCP server

## Architecture

```
┌───────────────┐     HTTP     ┌───────────────┐     ┌───────────────┐
│               │              │               │     │               │
│  AI Chatbot   │◄───────────► │  MCP Server   │◄───►│  Microsoft    │
│  (Next.js)    │  StreamHTTP  │  (Node.js)    │ API │  365 Services │
│               │              │               │     │               │
└───────────────┘              └───────────────┘     └───────────────┘
```

The StreamableHTTP protocol provides several advantages:
1. Better error handling and reconnection logic
2. Support for session management
3. Enhanced debugging capabilities
4. Improved performance compared to SSE connections

Each API endpoint in the AI chatbot uses the `getOrCreateMcpClient` function that manages connections to the MCP server. This function:
1. Creates a new connection if one doesn't exist
2. Reuses existing connections when possible
3. Handles reconnection logic if a connection is lost
4. Manages authentication tokens for Microsoft 365

## References

- [MCP Protocol Specification](https://github.com/microsoft/modelcontrol)
- [Microsoft Graph API](https://docs.microsoft.com/en-us/graph/overview) 