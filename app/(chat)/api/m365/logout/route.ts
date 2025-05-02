import { auth } from '@/app/(auth)/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateMcpClient, disconnectMcpClient, checkMcpServerTools } from '../client';

// MS 365 MCP server URL - ensure URL has proper scheme
let MS365_MCP_URL = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
// Ensure URL has proper scheme
if (!MS365_MCP_URL.match(/^https?:\/\//i)) {
  MS365_MCP_URL = `http://${MS365_MCP_URL}`;
}
console.log('[MCP Debug] Using MS365 MCP server URL:', MS365_MCP_URL);

export async function POST(req: NextRequest) {
  console.log('[MCP Debug] Logout request received');
  
  try {
    const session = await auth();
    
    // Check authentication
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if the server is available
    const { available } = await checkMcpServerTools();
    if (!available) {
      return Response.json({ 
        error: 'M365 server is not available',
        success: false
      }, { status: 503 });
    }

    // Get the client for this session user
    const { client } = await getOrCreateMcpClient(session.user.id);
    
    // Call the logout tool
    const result = await client.callTool({ name: "logout", arguments: {} });
    
    // Disconnect the client
    await disconnectMcpClient(session.user.id);
    
    return Response.json(result);
  } catch (error) {
    console.error('Error during M365 logout:', error);
    return Response.json({
      error: 'An error occurred during logout'
    }, { status: 500 });
  }
} 