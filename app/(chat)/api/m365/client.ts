import { 
  getOrCreateMcpClient as getOrCreateBaseClient, 
  disconnectMcpClient as disconnectBaseClient,
  checkMcpServerTools as checkBaseServerTools
} from '@/lib/ai/mcp/client';
import { z } from 'zod';

// Define schema for MCP responses
const ToolResultSchema = z.object({
  content: z.array(
    z.union([
      z.object({
        type: z.literal('text'),
        text: z.string()
      }),
      z.object({
        type: z.string(),
        data: z.any()
      })
    ])
  )
});

// MS 365 MCP server URL - ensure URL has proper scheme
let MS365_MCP_URL = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
// Ensure URL has proper scheme
if (!MS365_MCP_URL.match(/^https?:\/\//i)) {
  MS365_MCP_URL = `http://${MS365_MCP_URL}`;
}
console.log('[MCP Debug] Using MS365 MCP server URL:', MS365_MCP_URL);

// Simplified wrapper functions that provide the same interface but use the base client

/**
 * Gets or creates an MCP client for a specific user
 */
export async function getOrCreateMcpClient(userId: string, sessionId?: string, accessToken?: string) {
  try {
    console.log(`[DEBUG-CLIENT] Starting getOrCreateMcpClient for user ${userId}`);
    console.log(`[DEBUG-CLIENT] Using MCP URL: ${MS365_MCP_URL}`);
    console.log(`[DEBUG-CLIENT] Session ID provided: ${sessionId || 'none'}`);
    console.log(`[DEBUG-CLIENT] Access token available: ${!!accessToken}`);
    
    const result = await getOrCreateBaseClient(MS365_MCP_URL, userId, sessionId, accessToken);
    
    console.log(`[DEBUG-CLIENT] getOrCreateBaseClient result:`, JSON.stringify({
      clientAvailable: !!result?.client,
      transportAvailable: !!result?.transport,
      sessionId: result?.sessionId || 'none'
    }));
    
    return result;
  } catch (error) {
    console.error(`[DEBUG-CLIENT] Error in getOrCreateMcpClient:`, error);
    if (error instanceof Error) {
      console.error(`[DEBUG-CLIENT] Error message: ${error.message}`);
      console.error(`[DEBUG-CLIENT] Error stack: ${error.stack}`);
    } else {
      console.error(`[DEBUG-CLIENT] Non-error thrown:`, error);
    }
    throw error; // Rethrow to handle in the calling code
  }
}

/**
 * Disconnects an MCP client for a specific user
 */
export async function disconnectMcpClient(userId: string) {
  return disconnectBaseClient(userId);
}

/**
 * Checks MCP server tools and returns available ones
 */
export async function checkMcpServerTools(): Promise<{ available: boolean, tools: string[], sessionId?: string }> {
  try {
    console.log('[DEBUG-CLIENT] Starting checkMcpServerTools');
    console.log('[DEBUG-CLIENT] Using MCP URL:', MS365_MCP_URL);
    
    return await checkBaseServerTools(MS365_MCP_URL).catch(error => {
      console.error('[DEBUG-CLIENT] Error in checkBaseServerTools:', error);
      if (error instanceof Error) {
        console.error('[DEBUG-CLIENT] Error message:', error.message);
        console.error('[DEBUG-CLIENT] Error stack:', error.stack);
      } else {
        console.error('[DEBUG-CLIENT] Non-error thrown:', error);
      }
      return { available: false, tools: [] };
    });
  } catch (error) {
    console.error('[DEBUG-CLIENT] Top-level error in checkMcpServerTools:', error);
    if (error instanceof Error) {
      console.error('[DEBUG-CLIENT] Error message:', error.message);
      console.error('[DEBUG-CLIENT] Error stack:', error.stack);
    } else {
      console.error('[DEBUG-CLIENT] Non-error thrown:', error);
    }
    return { available: false, tools: [] };
  }
} 