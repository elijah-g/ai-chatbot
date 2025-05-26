import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpClientOptions {
  baseUrl: string;
  clientName?: string;
  clientVersion?: string;
}

export interface McpSessionInfo {
  sessionId: string;
  expiresAt?: Date;
}

export interface McpToolSchema {
  type: string;
  properties: Record<string, {
    type: string;
    description: string;
  }>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
}

export interface McpToolsListResponse {
  tools: McpTool[];
}

// Session management functionality
// Track active connections by user ID for cleanup
const activeConnections = new Map<string, { 
  client: Client, 
  transport: StreamableHTTPClientTransport,
  sessionId?: string,
  cleanupFetch?: () => void // Track cleanup function for persistent patching
}>();

/**
 * Creates a custom fetch function that adds authorization headers
 * This is a workaround since StreamableHTTPClientTransport doesn't support custom headers directly
 */
function createAuthorizedFetch(originalFetch: typeof fetch, accessToken?: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    
    // Add authorization header if access token is provided
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    
    // Ensure content-type is set for POST requests
    if (!headers.has('Content-Type') && init?.method === 'POST') {
      headers.set('Content-Type', 'application/json');
    }
    
    // Call the original fetch to avoid infinite recursion
    return originalFetch(input, {
      ...init,
      headers
    });
  };
}

/**
 * Monkey patch the global fetch to add authorization headers
 * This is a temporary workaround until the official SDK supports custom headers
 */
function patchFetchForAuth(accessToken?: string) {
  if (!accessToken) return () => {}; // No-op cleanup function
  
  const originalFetch = globalThis.fetch;
  const authorizedFetch = createAuthorizedFetch(originalFetch, accessToken);
  
  globalThis.fetch = authorizedFetch;
  
  // Return cleanup function
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * Creates a new MCP session with the server using the official SDK
 */
export async function createMcpSession(mcpUrl: string, accessToken?: string): Promise<string | undefined> {
  // Temporarily patch fetch to include authorization headers
  const cleanupFetch = patchFetchForAuth(accessToken);
  
  try {
    console.log(`[MCP Debug] Creating new MCP session with official SDK`);
    
    // Create a temporary client to initialize the session
    const client = new Client({
      name: "m365-client",
      version: "1.0.0"
    });

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

    await client.connect(transport);
    
    // The session ID should be available after connection
    const sessionId = transport.sessionId;
    if (sessionId) {
      console.log(`[MCP Debug] Initialization successful, received session ID: ${sessionId}`);
      await client.close();
      return sessionId;
    } else {
      console.log(`[MCP Debug] No session ID received from server`);
      await client.close();
      return undefined;
    }
  } catch (error) {
    console.error(`[MCP Debug] Session creation failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  } finally {
    // Always restore original fetch
    cleanupFetch();
  }
}

/**
 * Gets or creates an MCP client using the official SDK with Streamable HTTP transport
 */
export async function getOrCreateMcpClient(
  mcpUrl: string, 
  userId: string, 
  sessionId?: string, 
  accessToken?: string
) {
  console.log(`[MCP Debug] Attempting to get/create MCP client for user ${userId} ${sessionId ? `with session ${sessionId}` : 'with new session'}`);

  // Check if we have an existing connection for this user
  const existingConnection = activeConnections.get(userId);
  if (existingConnection) {
    try {
      // Test if the connection is still valid by listing tools
      await existingConnection.client.listTools();
      console.log(`[MCP Debug] Reusing existing connection for user ${userId}`);
      return existingConnection;
    } catch (error) {
      console.log(`[MCP Debug] Existing connection invalid, creating new one: ${error instanceof Error ? error.message : String(error)}`);
      // Clean up the invalid connection
      try {
        await existingConnection.client.close();
        // Clean up the fetch patch if it exists
        if (existingConnection.cleanupFetch) {
          existingConnection.cleanupFetch();
        }
      } catch (closeError) {
        console.warn(`[MCP Debug] Error closing invalid connection: ${closeError}`);
      }
      activeConnections.delete(userId);
    }
  }

  // Apply persistent fetch patch for this connection
  const cleanupFetch = patchFetchForAuth(accessToken);
  
  try {
    console.log(`[MCP Debug] Creating new MCP client with official SDK`);
    
    const client = new Client({
      name: "m365-client",
      version: "1.0.0"
    });

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    
    // Connect to the MCP server
    console.log(`[MCP Debug] Attempting to connect with Streamable HTTP transport`);
    await client.connect(transport);
    
    const finalSessionId = transport.sessionId || sessionId || 'none';
    console.log(`[MCP Debug] Connected to M365 server using official SDK (sessionId: ${finalSessionId})`);
    
    // Store the connection for future use with persistent fetch patch
    const connection = { 
      client, 
      transport, 
      sessionId: finalSessionId,
      cleanupFetch // Keep the patch active for this connection
    };
    activeConnections.set(userId, connection);
    
    return connection;
  } catch (error) {
    console.error(`[MCP Debug] Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[MCP Debug] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    // Clean up fetch patch on error
    cleanupFetch();
    throw error;
  }
  // Note: We don't call cleanupFetch() here because we want the patch to persist for the connection
}

function setupNotificationHandlers(client: Client) {
  // The official SDK handles notifications internally
  // We can add custom notification handlers here if needed
  console.log('[MCP Debug] Notification handlers set up (using official SDK)');
}

/**
 * Disconnects an MCP client for a specific user
 */
export async function disconnectMcpClient(userId: string): Promise<boolean> {
  const connection = activeConnections.get(userId);
  if (!connection) {
    console.log(`[MCP Debug] No active connection found for user ${userId}`);
    return false;
  }

  try {
    console.log(`[MCP Debug] Disconnecting MCP client for user ${userId}`);
    await connection.client.close();
    
    // Clean up the fetch patch if it exists
    if (connection.cleanupFetch) {
      connection.cleanupFetch();
      console.log(`[MCP Debug] Cleaned up fetch patch for user ${userId}`);
    }
    
    activeConnections.delete(userId);
    console.log(`[MCP Debug] Successfully disconnected MCP client for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`[MCP Debug] Error disconnecting MCP client for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    
    // Clean up the fetch patch even if close failed
    if (connection.cleanupFetch) {
      connection.cleanupFetch();
    }
    
    // Remove from active connections even if close failed
    activeConnections.delete(userId);
    return false;
  }
}

/**
 * Checks if MCP server tools are available using the official SDK
 */
export async function checkMcpServerTools(mcpUrl: string, accessToken?: string): Promise<{ available: boolean, tools: string[], sessionId?: string }> {
  // Temporarily patch fetch to include authorization headers
  const cleanupFetch = patchFetchForAuth(accessToken);
  
  try {
    console.log(`[MCP Debug] Checking MCP server tools availability with official SDK`);
    
    const client = new Client({
      name: "m365-client",
      version: "1.0.0"
    });

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    
    try {
      await client.connect(transport);
      
      const sessionId = transport.sessionId;
      console.log(`[MCP Debug] Connected with session ID: ${sessionId || 'none'}`);
      
      // List available tools
      console.log('[MCP Debug] Listing tools with official SDK');
      const toolsResult = await client.listTools();
      
      const tools = toolsResult.tools || [];
      const toolNames = tools.map(tool => tool.name);
      console.log(`[MCP Debug] Found ${toolNames.length} tools: ${toolNames.join(', ')}`);
      
      await client.close();
      
      return {
        available: true,
        tools: toolNames,
        sessionId: sessionId
      };
    } catch (error) {
      console.error(`[MCP Debug] Error checking tools: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await client.close();
      } catch (closeError) {
        console.warn(`[MCP Debug] Error closing client: ${closeError}`);
      }
      throw error;
    }
  } catch (error) {
    console.error(`[MCP Debug] Failed to check MCP server tools: ${error instanceof Error ? error.message : String(error)}`);
    return {
      available: false,
      tools: [],
      sessionId: undefined
    };
  } finally {
    // Always restore original fetch
    cleanupFetch();
  }
}
