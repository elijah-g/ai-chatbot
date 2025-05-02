/**
 * MCP Client Adapter
 * 
 * This module provides compatibility with the old client implementation
 * but uses the new, improved MCP client under the hood.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  Client, 
  StreamableHTTPClientTransport,
  SSEClientTransport 
} from './client';

// MS 365 MCP server URL - ensure URL has proper scheme
let MS365_MCP_URL = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
// Ensure URL has proper scheme
if (!MS365_MCP_URL.match(/^https?:\/\//i)) {
  MS365_MCP_URL = `http://${MS365_MCP_URL}`;
}
console.log('[MCP Debug] Using MS365 MCP server URL:', MS365_MCP_URL);

// Track active connections by user ID for cleanup
const activeConnections = new Map<string, { 
  client: Client, 
  transport: StreamableHTTPClientTransport | SSEClientTransport,
  sessionId?: string
}>();

/**
 * Get or create an MCP client for a user
 */
export async function getOrCreateMcpClient(userId: string, sessionId?: string, accessToken?: string) {
  console.log(`[MCP Debug] Attempting to get/create MCP client for user ${userId} ${sessionId ? `with session ${sessionId}` : 'with new session'}`);
  console.log(`[MCP Debug] Access token available: ${!!accessToken}`);
  
  // Check if there's already an active connection for this user
  if (activeConnections.has(userId)) {
    console.log(`[MCP Debug] Found existing connection for user ${userId}`);
    const existing = activeConnections.get(userId)!;
    
    // Verify the session is still valid
    if (existing.sessionId) {
      console.log(`[MCP Debug] Using existing session: ${existing.sessionId}`);
    } else {
      console.log(`[MCP Debug] Existing connection has no session ID`);
    }
    
    return existing;
  }

  console.log(`[MCP Debug] Creating new client connection for user ${userId}`);
  
  // Create a new client
  const client = new Client({
    name: 'm365-client',
    version: '1.0.0'
  });

  // Keep track of the provided sessionId for reconnection attempts
  let providedSessionId = sessionId;
  console.log(`[MCP Debug] Provided session ID: ${providedSessionId || 'none'}`);
  
  // If no session ID was provided, create a new one
  if (!providedSessionId) {
    providedSessionId = await createMcpSession();
    console.log(`[MCP Debug] Created new session ID: ${providedSessionId || 'failed to create'}`);
  }
  
  try {
    // Create StreamableHTTP transport with proper implementation
    const mcpUrl = new URL('/mcp', MS365_MCP_URL);
    console.log(`[MCP Debug] Connecting to MCP URL: ${mcpUrl.toString()}`);
    
    // Configure the transport with headers for session management
    const transportOptions = {
      requestOptions: {
        headers: {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
        }
      },
      // Include sessionId if we have one
      ...(providedSessionId ? { sessionId: providedSessionId } : {}),
      onSessionIdChanged: (newSessionId: string) => {
        // Store the new session ID in case it was changed by the server
        console.log(`[MCP Debug] Received new MCP session ID: ${newSessionId}`);
        const connection = activeConnections.get(userId);
        if (connection) {
          connection.sessionId = newSessionId;
        }
      },
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 3
      }
    };

    const transport = new StreamableHTTPClientTransport(mcpUrl, transportOptions);
    
    // Set up notification handlers for logging
    client.setNotificationHandler(
      { describe: () => 'logging/message' }, 
      (notification) => {
        console.log(`[MCP Server Log] [${notification.level}] ${notification.message}`);
      }
    );
    
    // Connect to the MCP server with StreamableHTTP
    console.log(`[MCP Debug] Attempting to connect with StreamableHTTP transport`);
    await client.connect(transport);
    
    // Verify session establishment
    if (!transport.sessionId) {
      console.warn(`[MCP Debug] No session ID obtained after connection`);
    } else {
      console.log(`[MCP Debug] Connected to M365 server using StreamableHTTP transport (sessionId: ${transport.sessionId})`);
    }
    
    // Store the connection for future use
    activeConnections.set(userId, { 
      client, 
      transport, 
      sessionId: transport.sessionId
    });
    
    return { client, transport, sessionId: transport.sessionId };
  } catch (error) {
    console.error(`[MCP Debug] StreamableHTTP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[MCP Debug] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    console.log(`[MCP Debug] Falling back to SSE transport`);
    
    // If StreamableHTTP fails, try SSE transport (legacy approach)
    try {
      const sseUrl = new URL(MS365_MCP_URL);
      console.log(`[MCP Debug] Creating SSE transport to ${sseUrl.toString()}`);
      const transport = new SSEClientTransport(sseUrl, {
        // Add authorization header for SSE transport if access token is provided
        headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : undefined
      });
      
      // Connect to the MCP server with SSE
      console.log(`[MCP Debug] Attempting to connect with SSE transport`);
      await client.connect(transport);
      
      console.log(`[MCP Debug] Connected to M365 server using SSE transport (sessionId: ${providedSessionId || 'none'})`);
      
      // Store the connection for future use
      activeConnections.set(userId, { client, transport, sessionId: providedSessionId || 'none' });
      
      return { client, transport, sessionId: providedSessionId || 'none' };
    } catch (sseError) {
      console.error(`[MCP Debug] SSE connection failed: ${sseError instanceof Error ? sseError.message : String(sseError)}`);
      console.error(`[MCP Debug] SSE error stack: ${sseError instanceof Error ? sseError.stack : 'No stack trace'}`);
      console.error(`[MCP Debug] Failed to connect to MCP server with both transports`);
      throw sseError;
    }
  }
}

/**
 * Disconnect an MCP client
 */
export async function disconnectMcpClient(userId: string) {
  const connection = activeConnections.get(userId);
  
  if (connection) {
    try {
      // Try to terminate the session first if the transport supports it
      if ('terminateSession' in connection.transport) {
        try {
          await (connection.transport as StreamableHTTPClientTransport).terminateSession();
        } catch (error: unknown) {
          const err = error as Error;
          console.log(`Session termination failed (this might be expected): ${err.message}`);
        }
      }
      
      // Close the client (which will handle transport disconnect internally)
      await connection.client.close();
      activeConnections.delete(userId);
      return true;
    } catch (error) {
      console.error(`Error disconnecting MCP client: ${error}`);
      // Remove from tracking even if disconnect fails
      activeConnections.delete(userId);
      return false;
    }
  }
  
  return false;
}

/**
 * Create a new MCP session
 */
async function createMcpSession(): Promise<string | undefined> {
  // Implementation removed - handled elsewhere
  return undefined;
}

/**
 * Check if the MCP server has tools available
 */
export async function checkMcpServerTools(): Promise<{ available: boolean, tools: string[], sessionId?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    console.log(`[MCP Debug] Checking MCP server tools`);
    
    try {
      // Create a new client
      const client = new Client({
        name: 'm365-client',
        version: '1.0.0'
      });
      
      // Get a session ID - try to reuse an existing one or create a new one
      let sessionId: string | undefined;
      
      // Get first active connection if any exists to reuse session
      if (activeConnections.size > 0) {
        const firstConnection = Array.from(activeConnections.values())[0];
        sessionId = firstConnection.sessionId;
        console.log(`[MCP Debug] Reusing existing session ID: ${sessionId}`);
      } 
      
      // If no existing session, create a new one
      if (!sessionId) {
        sessionId = await createMcpSession();
        console.log(`[MCP Debug] Created new session ID: ${sessionId || 'none'}`);
      }
      
      // Create a transport to connect to the MCP server
      const mcpUrl = new URL('/mcp', MS365_MCP_URL);
      console.log(`[MCP Debug] Connecting to MCP URL: ${mcpUrl.toString()}`);
      
      // Set up transport with session ID
      const transportOptions = {
        requestOptions: {
          headers: {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json'
          }
        },
        // Include the session ID if we have one
        ...(sessionId ? { sessionId } : {}),
        onSessionIdChanged: (newSessionId: string) => {
          console.log(`[MCP Debug] Server assigned session ID: ${newSessionId}`);
          sessionId = newSessionId;
        },
        reconnectionOptions: {
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 10000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 1
        }
      };
      
      const transport = new StreamableHTTPClientTransport(mcpUrl, transportOptions);
      
      // Connect to the MCP server
      console.log(`[MCP Debug] Attempting to connect with transport, current session ID: ${transport.sessionId || 'none'}`);
      await client.connect(transport);
      
      // Check if we have a session ID after connection
      if (!transport.sessionId) {
        console.warn('[MCP Debug] Warning: No session ID received after connection');
      } else {
        console.log(`[MCP Debug] Connected with session ID: ${transport.sessionId}`);
        
        // Store this session for future use if not already stored
        if (activeConnections.size === 0 && transport.sessionId) {
          console.log('[MCP Debug] Storing session for future use with temporary user ID');
          activeConnections.set('mcp-check', { 
            client, 
            transport, 
            sessionId: transport.sessionId 
          });
        }
      }
      
      // List available tools
      console.log('[MCP Debug] Listing tools with session ID:', transport.sessionId);
      const tools = await client.listTools();
      
      // Close the connection only if we're not saving it
      if (!activeConnections.has('mcp-check')) {
        await client.close();
      }
      
      clearTimeout(timeoutId);
      
      console.log(`[MCP Debug] Server check successful, found ${Array.isArray(tools) ? tools.length : 0} tools`);
      
      if (Array.isArray(tools)) {
        return { 
          available: true, 
          tools: tools.map((tool: any) => tool.name),
          sessionId: transport.sessionId
        };
      }
      
      return { available: true, tools: [], sessionId: transport.sessionId };
    } catch (innerError) {
      console.error(`[MCP Debug] Error checking MCP server tools: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
      console.error(`[MCP Debug] Error stack: ${innerError instanceof Error ? innerError.stack : 'No stack trace'}`);
      return { available: false, tools: [] };
    }
  } catch (error) {
    console.error(`[MCP Debug] Failed to check MCP server: ${error instanceof Error ? error.message : String(error)}`);
    return { available: false, tools: [] };
  }
} 