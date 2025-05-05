import { auth } from '@/app/(auth)/auth';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
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
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8080';

export async function POST(req: NextRequest) {
  console.log('[Call-Tool Debug] Request received');
  
  const session = await auth();
  if (!session?.user?.id || !session.user.accessToken) {
    const error = session?.user?.id ? 'Missing access token in session' : 'Unauthorized';
    console.error(`[Call-Tool Error] Authorization failed: ${error}`);
    return Response.json({ error: error }, { status: 401 });
  }
  
  try {
    // Parse request to get tool info
    const { tool, params } = await req.json();
    
    if (!tool) {
      return Response.json({ error: 'Missing required parameter: tool' }, { status: 400 });
    }
    
    // Get the session ID from the headers
    const sessionId = req.headers.get('mcp-session-id') || req.headers.get('Mcp-Session-Id');
    if (!sessionId) {
      console.error('[Call-Tool Error] Missing Mcp-Session-Id header');
      return Response.json({ error: 'Missing session ID' }, { status: 400 });
    }
    
    console.log(`[Call-Tool Debug] Calling M365 tool: ${tool} with session ID: ${sessionId}`);
    
    // Prepare the direct tool call request
    const toolCallPayload = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/call",
      params: {
        name: tool,
        arguments: params || {}
      }
    };
    
    // Make the direct request to the MCP server
    const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId,
        'Authorization': `Bearer ${session.user.accessToken}`
      },
      body: JSON.stringify(toolCallPayload)
    });
    
    // Get the session ID from the response headers in case it changed
    const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id');
    
    // Check if the response is OK
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Call-Tool Debug] Error from MCP server: ${response.status} ${errorText}`);
      return Response.json(
        { error: `HTTP error ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }
    
    // Parse the response
    const data = await response.json();
    
    // Check for errors in the response
    if (data.error) {
      return Response.json(
        { error: `JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}` },
        { status: 500 }
      );
    }
    
    // Create the response with the result
    const clientResponse = Response.json(data.result);
    
    // Add the session ID to the response headers if available
    if (responseSessionId) {
      clientResponse.headers.set('Mcp-Session-Id', responseSessionId);
    }
    
    return clientResponse;
  } catch (error: any) {
    console.error('Error calling M365 tool:', error);
    
    return Response.json({ 
      error: 'An error occurred while processing your request',
      details: error.message
    }, { status: 500 });
  }
} 