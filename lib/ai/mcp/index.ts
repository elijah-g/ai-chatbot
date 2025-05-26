import { 
  getOrCreateMcpClient,
  createMcpSession,
  checkMcpServerTools,
  disconnectMcpClient,
  type McpClientOptions,
  type McpTool,
  type McpToolsListResponse
} from './client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Track default client connection info
let defaultClientInfo: {
  mcpUrl: string;
  userId: string;
  accessToken?: string;
} | null = null;

/**
 * Initialize the default MCP client configuration
 * @param options Client configuration options
 * @param userId User identifier for connection management
 * @param accessToken Optional M365 access token
 */
export function initializeDefaultMcpClient(
  options: McpClientOptions,
  userId: string,
  accessToken?: string
) {
  defaultClientInfo = {
    mcpUrl: options.baseUrl,
    userId,
    accessToken
  };
}

/**
 * Get or create the default MCP client
 * @param sessionId Optional session ID for reconnection
 * @returns The MCP client connection
 */
export async function getDefaultMcpClient(sessionId?: string) {
  if (!defaultClientInfo) {
    throw new Error('Default MCP client not initialized. Call initializeDefaultMcpClient() first.');
  }
  
  return await getOrCreateMcpClient(
    defaultClientInfo.mcpUrl,
    defaultClientInfo.userId,
    sessionId,
    defaultClientInfo.accessToken
  );
}

/**
 * Create a new MCP client session 
 * @param options Optional client options
 * @param accessToken Optional M365 access token
 * @returns The session ID if successful
 */
export async function initializeMcpSession(options?: McpClientOptions, accessToken?: string): Promise<string | undefined> {
  const mcpUrl = options?.baseUrl || process.env.MCP_SERVER_URL || 'http://localhost:8080';
  return await createMcpSession(mcpUrl, accessToken);
}

/**
 * List the available tools from the MCP server
 * @param options Optional client options
 * @param accessToken Optional M365 access token
 * @returns The list of available tools
 */
export async function listMcpTools(options?: McpClientOptions, accessToken?: string): Promise<string[]> {
  const mcpUrl = options?.baseUrl || process.env.MCP_SERVER_URL || 'http://localhost:8080';
  const result = await checkMcpServerTools(mcpUrl, accessToken);
  return result.tools;
}

/**
 * Invoke a tool on the MCP server using the default client
 * @param toolName The name of the tool to invoke
 * @param params The parameters to pass to the tool
 * @param sessionId Optional session ID
 * @returns The result of the tool invocation
 */
export async function invokeMcpTool<T = unknown>(
  toolName: string, 
  params: Record<string, unknown>,
  sessionId?: string
): Promise<T> {
  const { client } = await getDefaultMcpClient(sessionId);
  
  const result = await client.callTool({
    name: toolName,
    arguments: params
  });
  
  return result.content as T;
}

/**
 * Disconnect the default MCP client
 * @returns True if successfully disconnected
 */
export async function disconnectDefaultMcpClient(): Promise<boolean> {
  if (!defaultClientInfo) {
    return false;
  }
  
  const success = await disconnectMcpClient(defaultClientInfo.userId);
  if (success) {
    defaultClientInfo = null;
  }
  return success;
}

// Export the main functions and types
export {
  getOrCreateMcpClient,
  createMcpSession,
  checkMcpServerTools,
  disconnectMcpClient,
  type McpClientOptions,
  type McpTool,
  type McpToolsListResponse,
  Client,
  StreamableHTTPClientTransport
}; 