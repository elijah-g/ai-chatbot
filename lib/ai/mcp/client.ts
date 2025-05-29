import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from '../../utils/logger';
import { z } from 'zod';

export interface McpClientOptions {
  baseUrl: string;
  clientName?: string;
  clientVersion?: string;
  timeout?: number;
}

export interface McpSessionInfo {
  sessionId: string;
  expiresAt?: Date;
}

export interface McpToolSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: McpToolSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpToolsListResponse {
  tools: McpTool[];
}

export interface ProcessedTool {
  name: string;
  description: string;
  zodSchema: z.ZodType<any>;
  isDestructive: boolean;
  originalTool: McpTool;
}

// Configuration constants
const DEFAULT_TIMEOUT = 60000; // 60 seconds instead of default
const CONNECTION_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Tool cache to avoid reprocessing tools and schemas
const toolCache = new Map<string, {
  tools: ProcessedTool[];
  lastUpdated: number;
  cacheKey: string;
}>();

// Cache TTL in milliseconds (10 minutes - increased from 5)
const TOOL_CACHE_TTL = 10 * 60 * 1000;

// Session management functionality
// Track active connections by user ID for cleanup
const activeConnections = new Map<string, { 
  client: Client, 
  transport: StreamableHTTPClientTransport,
  sessionId?: string,
  cleanupFetch?: () => void,
  toolsHash?: string // Track tools hash for cache invalidation
}>();

// Connection health tracking
const connectionHealth = new Map<string, {
  lastHealthCheck: number;
  isHealthy: boolean;
  consecutiveFailures: number;
}>();

/**
 * Convert MCP tool input schema to Zod schema (cached version)
 */
function convertMcpSchemaToZod(inputSchema: any): z.ZodType<any> {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return z.object({}).passthrough();
  }

  if (inputSchema.type === 'object' && inputSchema.properties) {
    const zodObject: Record<string, z.ZodType<any>> = {};
    
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const property = prop as any;
      
      switch (property.type) {
        case 'string':
          zodObject[key] = z.string();
          break;
        case 'number':
          zodObject[key] = z.number();
          break;
        case 'boolean':
          zodObject[key] = z.boolean();
          break;
        case 'array':
          zodObject[key] = z.array(z.any());
          break;
        default:
          zodObject[key] = z.any();
      }
      
      // Handle optional vs required fields
      if (!inputSchema.required || !inputSchema.required.includes(key)) {
        zodObject[key] = zodObject[key].optional();
      }
    }
    
    return z.object(zodObject);
  }
  
  // Fallback to passthrough for unknown schemas
  return z.object({}).passthrough();
}

/**
 * Generate a hash for tools to detect changes
 */
function generateToolsHash(tools: McpTool[]): string {
  const toolsString = JSON.stringify(tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations
  })));
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < toolsString.length; i++) {
    const char = toolsString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

/**
 * Process and cache tools with their Zod schemas
 */
function processAndCacheTools(userId: string, tools: McpTool[]): ProcessedTool[] {
  const toolsHash = generateToolsHash(tools);
  const cacheKey = `${userId}-${toolsHash}`;
  const now = Date.now();
  
  // Check if we have a valid cache entry
  const cached = toolCache.get(cacheKey);
  if (cached && (now - cached.lastUpdated) < TOOL_CACHE_TTL) {
    logger.info(`[MCP Debug] Using cached tools for user ${userId} (${tools.length} tools)`);
    return cached.tools;
  }
  
  logger.info(`[MCP Debug] Processing and caching tools for user ${userId} (${tools.length} tools)`);
  
  // Process tools
  const processedTools: ProcessedTool[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    zodSchema: convertMcpSchemaToZod(tool.inputSchema),
    isDestructive: (tool as any).annotations?.destructiveHint === true,
    originalTool: tool
  }));
  
  // Cache the processed tools
  toolCache.set(cacheKey, {
    tools: processedTools,
    lastUpdated: now,
    cacheKey
  });
  
  // Clean up old cache entries
  for (const [key, entry] of toolCache.entries()) {
    if ((now - entry.lastUpdated) > TOOL_CACHE_TTL) {
      toolCache.delete(key);
    }
  }
  
  return processedTools;
}

/**
 * Get processed tools from cache or process them
 */
export async function getProcessedTools(userId: string, client: Client): Promise<ProcessedTool[]> {
  try {
    // Get the connection to check if tools hash has changed
    const connection = activeConnections.get(userId);
    
    // List tools from server with retry logic
    const serverToolsResponse = await withRetry(async () => {
      return await client.listTools();
    }, 'list tools');
    
    const serverTools = serverToolsResponse.tools || [];
    
    if (!Array.isArray(serverTools)) {
      logger.warn('[WARN] serverTools is not an array. Returning empty array.');
      return [];
    }
    
    const currentToolsHash = generateToolsHash(serverTools);
    
    // Check if tools have changed since last time
    if (connection && connection.toolsHash === currentToolsHash) {
      // Tools haven't changed, try to get from cache
      const cacheKey = `${userId}-${currentToolsHash}`;
      const cached = toolCache.get(cacheKey);
      if (cached && (Date.now() - cached.lastUpdated) < TOOL_CACHE_TTL) {
        logger.info(`[MCP Debug] Using cached tools for user ${userId} (${cached.tools.length} tools)`);
        return cached.tools;
      }
    }
    
    // Update the connection's tools hash
    if (connection) {
      connection.toolsHash = currentToolsHash;
    }
    
    // Process and cache the tools
    logger.info(`[MCP Debug] Processing ${serverTools.length} tools for user ${userId}`);
    return processAndCacheTools(userId, serverTools);
    
  } catch (error) {
    logger.error(`[MCP Debug] Error getting processed tools for user ${userId}:`, error);
    
    // Try to return cached tools as fallback
    const cacheEntries = Array.from(toolCache.entries());
    const userCacheEntry = cacheEntries.find(([key]) => key.startsWith(`${userId}-`));
    
    if (userCacheEntry) {
      logger.info(`[MCP Debug] Returning cached tools as fallback for user ${userId}`);
      return userCacheEntry[1].tools;
    }
    
    return [];
  }
}

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
    logger.info(`[MCP Debug] Creating new MCP session with official SDK`);
    
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
      logger.info(`[MCP Debug] Initialization successful, received session ID: ${sessionId}`);
      await client.close();
      return sessionId;
    } else {
      logger.info(`[MCP Debug] No session ID received from server`);
      await client.close();
      return undefined;
    }
  } catch (error) {
    logger.error(`[MCP Debug] Session creation failed: ${error instanceof Error ? error.message : String(error)}`);
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
  accessToken?: string,
  options?: { timeout?: number }
) {
  logger.info(`[MCP Debug] Attempting to get/create MCP client for user ${userId} ${sessionId ? `with session ${sessionId}` : 'with new session'}`);

  // Check if we have an existing connection for this user
  const existingConnection = activeConnections.get(userId);
  if (existingConnection) {
    try {
      // Use improved health check instead of always calling listTools
      const isHealthy = await isConnectionHealthy(userId, existingConnection.client);
      if (isHealthy) {
        logger.info(`[MCP Debug] Reusing existing healthy connection for user ${userId}`);
        return existingConnection;
      } else {
        logger.info(`[MCP Debug] Existing connection unhealthy, creating new one for user ${userId}`);
      }
    } catch (error) {
      logger.info(`[MCP Debug] Existing connection invalid, creating new one: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Clean up the invalid connection
    try {
      await existingConnection.client.close();
      // Clean up the fetch patch if it exists
      if (existingConnection.cleanupFetch) {
        existingConnection.cleanupFetch();
      }
    } catch (closeError) {
      logger.warn(`[MCP Debug] Error closing invalid connection: ${closeError}`);
    }
    activeConnections.delete(userId);
    connectionHealth.delete(userId);
  }

  // Apply persistent fetch patch for this connection
  const cleanupFetch = patchFetchForAuth(accessToken);
  
  try {
    logger.info(`[MCP Debug] Creating new MCP client with official SDK`);
    
    const client = new Client({
      name: "m365-client",
      version: "1.0.0"
    });

    // Create transport with timeout configuration
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    
    // Apply timeout if specified
    const timeout = options?.timeout || DEFAULT_TIMEOUT;
    if (timeout !== DEFAULT_TIMEOUT) {
      logger.info(`[MCP Debug] Using custom timeout: ${timeout}ms`);
    }
    
    // Connect to the MCP server with retry logic
    logger.info(`[MCP Debug] Attempting to connect with Streamable HTTP transport (timeout: ${timeout}ms)`);
    await withRetry(async () => {
      await client.connect(transport);
    }, 'client connection');
    
    const finalSessionId = transport.sessionId || sessionId || 'none';
    logger.info(`[MCP Debug] Connected to M365 server using official SDK (sessionId: ${finalSessionId})`);
    
    // Initialize connection health
    connectionHealth.set(userId, {
      lastHealthCheck: Date.now(),
      isHealthy: true,
      consecutiveFailures: 0
    });
    
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
    logger.error(`[MCP Debug] Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(`[MCP Debug] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    // Clean up fetch patch on error
    cleanupFetch();
    throw error;
  }
  // Note: We don't call cleanupFetch() here because we want the patch to persist for the connection
}

function setupNotificationHandlers(client: Client) {
  // The official SDK handles notifications internally
  // We can add custom notification handlers here if needed
  logger.info('[MCP Debug] Notification handlers set up (using official SDK)');
}

/**
 * Disconnects an MCP client for a specific user
 */
export async function disconnectMcpClient(userId: string): Promise<boolean> {
  const connection = activeConnections.get(userId);
  if (!connection) {
    logger.info(`[MCP Debug] No active connection found for user ${userId}`);
    return false;
  }

  try {
    logger.info(`[MCP Debug] Disconnecting MCP client for user ${userId}`);
    await connection.client.close();
    
    // Clean up the fetch patch if it exists
    if (connection.cleanupFetch) {
      connection.cleanupFetch();
      logger.info(`[MCP Debug] Cleaned up fetch patch for user ${userId}`);
    }
    
    activeConnections.delete(userId);
    connectionHealth.delete(userId); // Clean up health tracking
    logger.info(`[MCP Debug] Successfully disconnected MCP client for user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[MCP Debug] Error disconnecting MCP client for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    
    // Clean up the fetch patch even if close failed
    if (connection.cleanupFetch) {
      connection.cleanupFetch();
    }
    
    // Remove from active connections and health tracking even if close failed
    activeConnections.delete(userId);
    connectionHealth.delete(userId);
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
    logger.info(`[MCP Debug] Checking MCP server tools availability with official SDK`);
    
    const client = new Client({
      name: "m365-client",
      version: "1.0.0"
    });

    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    
    try {
      await client.connect(transport);
      
      const sessionId = transport.sessionId;
      logger.info(`[MCP Debug] Connected with session ID: ${sessionId || 'none'}`);
      
      // List available tools
      logger.info('[MCP Debug] Listing tools with official SDK');
      const toolsResult = await client.listTools();
      
      const tools = toolsResult.tools || [];
      const toolNames = tools.map(tool => tool.name);
      logger.info(`[MCP Debug] Found ${toolNames.length} tools: ${toolNames.join(', ')}`);
      
      await client.close();
      
      return {
        available: true,
        tools: toolNames,
        sessionId: sessionId
      };
    } catch (error) {
      logger.error(`[MCP Debug] Error checking tools: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await client.close();
      } catch (closeError) {
        logger.warn(`[MCP Debug] Error closing client: ${closeError}`);
      }
      throw error;
    }
  } catch (error) {
    logger.error(`[MCP Debug] Failed to check MCP server tools: ${error instanceof Error ? error.message : String(error)}`);
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

/**
 * Clear the tool cache (useful for testing or when tools change)
 */
export function clearToolCache(): void {
  toolCache.clear();
  logger.info('[MCP Debug] Tool cache cleared');
}

/**
 * Get cache statistics
 */
export function getToolCacheStats(): { size: number; entries: string[] } {
  return {
    size: toolCache.size,
    entries: Array.from(toolCache.keys())
  };
}

/**
 * Get connection health statistics
 */
export function getConnectionHealthStats(): Array<{
  userId: string;
  isHealthy: boolean;
  lastHealthCheck: Date;
  consecutiveFailures: number;
  hasActiveConnection: boolean;
}> {
  const stats: Array<{
    userId: string;
    isHealthy: boolean;
    lastHealthCheck: Date;
    consecutiveFailures: number;
    hasActiveConnection: boolean;
  }> = [];
  
  for (const [userId, health] of connectionHealth.entries()) {
    stats.push({
      userId,
      isHealthy: health.isHealthy,
      lastHealthCheck: new Date(health.lastHealthCheck),
      consecutiveFailures: health.consecutiveFailures,
      hasActiveConnection: activeConnections.has(userId)
    });
  }
  
  return stats;
}

/**
 * Force refresh connection health for a user
 */
export async function refreshConnectionHealth(userId: string): Promise<boolean> {
  const connection = activeConnections.get(userId);
  if (!connection) {
    logger.warn(`[MCP Debug] No active connection found for user ${userId} to refresh health`);
    return false;
  }
  
  // Reset health check timestamp to force a fresh check
  connectionHealth.delete(userId);
  
  try {
    const isHealthy = await isConnectionHealthy(userId, connection.client);
    logger.info(`[MCP Debug] Forced health refresh for user ${userId}: ${isHealthy ? 'healthy' : 'unhealthy'}`);
    return isHealthy;
  } catch (error) {
    logger.error(`[MCP Debug] Error during forced health refresh for user ${userId}:`, error);
    return false;
  }
}

/**
 * Retry wrapper for MCP operations
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = MAX_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      logger.warn(`[MCP Debug] ${operationName} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
      
      if (attempt < maxAttempts) {
        const delay = RETRY_DELAY * attempt; // Exponential backoff
        logger.info(`[MCP Debug] Retrying ${operationName} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

/**
 * Check connection health without full tool listing
 */
async function isConnectionHealthy(userId: string, client: Client): Promise<boolean> {
  const health = connectionHealth.get(userId);
  const now = Date.now();
  
  // If we recently checked and it was healthy, skip the check
  if (health && health.isHealthy && (now - health.lastHealthCheck) < CONNECTION_HEALTH_CHECK_INTERVAL) {
    return true;
  }
  
  try {
    // Use a lighter operation than listTools if available
    await withRetry(async () => {
      const result = await client.listTools();
      return result;
    }, 'health check', 2); // Fewer retries for health checks
    
    connectionHealth.set(userId, {
      lastHealthCheck: now,
      isHealthy: true,
      consecutiveFailures: 0
    });
    
    return true;
  } catch (error) {
    const currentHealth = connectionHealth.get(userId) || { lastHealthCheck: 0, isHealthy: true, consecutiveFailures: 0 };
    connectionHealth.set(userId, {
      lastHealthCheck: now,
      isHealthy: false,
      consecutiveFailures: currentHealth.consecutiveFailures + 1
    });
    
    logger.warn(`[MCP Debug] Connection health check failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
