import { auth } from '@/app/(auth)/auth';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';
import { getOrCreateMcpClient, checkMcpServerTools } from '../client';
import { z } from 'zod';

// Define schema for tool response validation
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
  ).optional(),
  isError: z.boolean().optional()
});

// MS 365 MCP server URL - ensure URL has proper scheme
let MS365_MCP_URL = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
// Ensure URL has proper scheme
if (!MS365_MCP_URL.match(/^https?:\/\//i)) {
  MS365_MCP_URL = `http://${MS365_MCP_URL}`;
}
console.log('[MCP Debug] Using MS365 MCP server URL:', MS365_MCP_URL);

export async function POST(req: NextRequest) {
  console.log('[MCP Debug] Tool invocation request received');
  
  try {
    // Get request body
    const { tool, params, clientId }: { tool: string, params?: Record<string, any>, clientId?: string } = await req.json();
    
    // Validate required parameters
    if (!tool) {
      return Response.json({ error: 'Missing required parameter: tool' }, { status: 400 });
    }
    
    // Get authenticated user (if any)
    const session = await auth();
    
    // Check authentication
    if (!session?.user?.id) {
      console.log('[Invoke Debug] Unauthorized request - no valid session');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('[Invoke Debug] Checking MCP server');
    const { available, tools } = await checkMcpServerTools();
    
    if (!available) {
      console.error('[Invoke Debug] MCP server is not available');
      return Response.json({ error: 'M365 server is not available' }, { status: 503 });
    }

    console.log(`[Invoke Debug] Processing request for user ${session.user.id}`);

    // Check if user has Azure AD authentication with proper access token
    if (session.user.type !== 'azuread' || !session.user.accessToken) {
      console.log('[Invoke Debug] User does not have Azure AD auth or access token');
      return Response.json({ 
        error: 'Azure AD authentication required for M365 access',
        requiresAzureAuth: true
      }, { status: 403 });
    }

    try {
      console.log(`[Invoke Debug] Invoking tool: ${tool} with clientId: ${clientId}`);

      // Get or create MCP client - we'll use the session user ID as the client ID
      // If the clientId from the request is important, we can use it as the session ID
      // Pass the access token to the client for authentication with the MCP server
      console.log(`[Invoke Debug] Calling getOrCreateMcpClient for user ${session.user.id} with session ${clientId}`);
      const { client } = await getOrCreateMcpClient(session.user.id, clientId, session.user.accessToken);

      console.log(`[Invoke Debug] Successfully created/fetched client, invoking M365 tool: ${tool}`);
      
      // Call the tool with original parameters (no need to include azureAccessToken as it's now handled by the client)
      const result = await client.callTool({
        name: tool,
        arguments: params
      });
      
      console.log(`[Invoke Debug] Tool invocation completed successfully`);
      return Response.json(result);
    } catch (error) {
      console.error('[Invoke Debug] Error invoking M365 tool:', error);
      
      return Response.json({
        error: 'An error occurred while invoking the tool',
        details: error instanceof Error ? error.message : String(error)
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[Invoke Debug] Error processing request:', error);
    
    return Response.json({
      error: 'An error occurred while processing the request',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 