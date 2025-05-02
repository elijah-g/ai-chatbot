import { 
  Client, 
  McpClient,
  StreamableHTTPClientTransport, 
  SSEClientTransport,
  createMcpClient,
  type McpClientOptions,
  type McpTool,
  type ClientOptions
} from './client';

// Create and export a singleton client for easy access
let defaultClient: McpClient | null = null;

/**
 * Get or create the default MCP client
 * @param options Optional client options
 * @returns The MCP client instance
 */
export function getDefaultMcpClient(options?: McpClientOptions): McpClient {
  if (!defaultClient) {
    defaultClient = createMcpClient(options || {
      baseUrl: process.env.MCP_SERVER_URL || 'http://localhost:8080'
    });
  }
  return defaultClient;
}

/**
 * Create a new MCP client session 
 * @param options Optional client options
 * @returns The session information
 */
export async function initializeMcpSession(options?: McpClientOptions) {
  const client = getDefaultMcpClient(options);
  return await client.initialize();
}

/**
 * List the available tools from the MCP server
 * @param options Optional client options
 * @returns The list of available tools
 */
export async function listMcpTools(options?: McpClientOptions): Promise<McpTool[]> {
  const client = getDefaultMcpClient(options);
  return await client.listTools();
}

/**
 * Invoke a tool on the MCP server
 * @param toolName The name of the tool to invoke
 * @param params The parameters to pass to the tool
 * @param options Optional client options
 * @returns The result of the tool invocation
 */
export async function invokeMcpTool<T = unknown>(
  toolName: string, 
  params: Record<string, unknown>,
  options?: McpClientOptions
): Promise<T> {
  const client = getDefaultMcpClient(options);
  return await client.invokeTool<T>(toolName, params);
}

// Export the client classes and interfaces
export {
  Client,
  McpClient,
  StreamableHTTPClientTransport,
  SSEClientTransport,
  createMcpClient
}; 