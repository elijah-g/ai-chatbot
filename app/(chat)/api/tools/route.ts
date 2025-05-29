import { auth } from '@/app/(auth)/auth';
import { getOrCreateMcpClient, disconnectMcpClient } from '@/lib/ai/mcp/client';

export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = session.user.id;
    const accessToken = (session as any)?.user?.accessToken;
    
    const mcpServerUrl = process.env.MCP_SERVER_URL;
    if (!mcpServerUrl) {
      return new Response('MCP server not configured', { status: 500 });
    }

    let mcpConnection;
    try {
      // Get MCP client connection
      mcpConnection = await getOrCreateMcpClient(mcpServerUrl, userId, undefined, accessToken);
      
      if (!mcpConnection || !mcpConnection.client) {
        throw new Error('Failed to establish MCP connection');
      }

      // Get tools from MCP server
      const serverToolsResponse = await mcpConnection.client.listTools();
      const serverTools = serverToolsResponse.tools || [];

      // Extract tool metadata with destructive hints
      const toolsMetadata = serverTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        annotations: (tool as any).annotations || {},
        isDestructive: (tool as any).annotations?.destructiveHint === true,
      }));

      return Response.json({ tools: toolsMetadata });
    } finally {
      // Clean up MCP connection
      if (mcpConnection) {
        try {
          await disconnectMcpClient(userId);
        } catch (error) {
          console.error('Error disconnecting MCP client:', error);
        }
      }
    }
  } catch (error) {
    console.error('Error fetching tools metadata:', error);
    return new Response('Internal server error', { status: 500 });
  }
} 