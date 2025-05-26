import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getOrCreateMcpClient } from '@/lib/ai/mcp/client';

interface McpClient {
  invokeTool: (toolName: string, params: Record<string, any>) => Promise<any>;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useM365Mcp(): McpClient {
  const { data: session } = useSession();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<any>(null);

  const mcpUrl = process.env.NEXT_PUBLIC_MCP_SERVER_URL || 'http://localhost:8080';

  // Initialize MCP client when session is available
  useEffect(() => {
    if (session?.user?.id && session?.user?.type === 'azuread' && session?.user?.accessToken) {
      initializeClient();
    } else {
      setIsConnected(false);
      setClient(null);
    }
  }, [session?.user?.id, session?.user?.accessToken]);

  const initializeClient = useCallback(async () => {
    if (!session?.user?.id || !session?.user?.accessToken) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      console.log('[MCP Hook] Initializing MCP client...');
      const connection = await getOrCreateMcpClient(
        mcpUrl,
        session.user.id,
        undefined, // sessionId
        session.user.accessToken
      );

      setClient(connection);
      setIsConnected(true);
      console.log('[MCP Hook] MCP client initialized successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[MCP Hook] Failed to initialize MCP client:', errorMessage);
      setError(errorMessage);
      setIsConnected(false);
      setClient(null);
    } finally {
      setIsConnecting(false);
    }
  }, [session?.user?.id, session?.user?.accessToken, mcpUrl]);

  const invokeTool = useCallback(async (toolName: string, params: Record<string, any> = {}) => {
    if (!client || !isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      console.log(`[MCP Hook] Invoking tool: ${toolName}`, params);
      const result = await client.client.callTool({
        name: toolName,
        arguments: params
      });

      console.log(`[MCP Hook] Tool ${toolName} completed successfully`);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[MCP Hook] Error invoking tool ${toolName}:`, errorMessage);
      
      // If it's an authentication error, reset the connection
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        setIsConnected(false);
        setClient(null);
        setError('Authentication failed');
      }
      
      throw err;
    }
  }, [client, isConnected]);

  return {
    invokeTool,
    isConnected,
    isConnecting,
    error,
  };
} 