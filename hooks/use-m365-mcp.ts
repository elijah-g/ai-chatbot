import { useState, useEffect, useCallback, useRef } from 'react';

interface M365Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

interface M365Response {
  id: string;
  result?: any;
  error?: any;
}

interface UseM365McpOptions {
  enabled?: boolean;
}

interface UseM365McpReturn {
  clientId: string | null;
  tools: M365Tool[];
  isConnected: boolean;
  isLoggedIn: boolean | null;
  connectionError: string | null;
  loginInfo: any | null;
  invokeTool: (toolName: string, params?: Record<string, any>) => Promise<any>;
  login: (force?: boolean) => Promise<any>;
  logout: () => Promise<any>;
}

// Add a debug flag to enable detailed front-end logging
const DEBUG_MODE = true;

// Global state to persist across hook instances
let globalClientId: string | null = null;
let globalTools: any[] = [];
let globalConnectionStatus = false;
let globalLoginStatus: boolean | null = null;
let instanceCount = 0;

// Helper function for debug logging
function debugLog(...args: any[]) {
  if (DEBUG_MODE) {
    console.log('[M365 Debug]', ...args);
  }
}

// Default return value for when the hook is disabled
const defaultReturnValue: UseM365McpReturn = {
  clientId: null,
  tools: [],
  isConnected: false,
  isLoggedIn: null,
  connectionError: null,
  loginInfo: null,
  invokeTool: async () => { throw new Error('M365 MCP not initialized'); },
  login: async () => { throw new Error('M365 MCP not initialized'); },
  logout: async () => { throw new Error('M365 MCP not initialized'); }
};

export function useM365Mcp(options: UseM365McpOptions = {}): UseM365McpReturn {
  const { enabled = true } = options;
  const [clientId, setClientId] = useState<string | null>(globalClientId);
  const [tools, setTools] = useState<M365Tool[]>(globalTools);
  const [isConnected, setIsConnected] = useState(globalConnectionStatus);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(globalLoginStatus);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<any | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  
  // Function to check if the server is available and get tools
  const checkServerConnection = useCallback(async () => {
    if (!enabled) return;
    
    try {
      debugLog('Checking M365 server connection');
      const response = await fetch('/api/m365/verify-login');
      
      if (!response.ok) {
        debugLog('Server check failed', response.status);
        setIsConnected(false);
        globalConnectionStatus = false;
        setConnectionError('M365 server is not available');
        return;
      }
      
      // Server is connected
      const result = await response.json();
      debugLog('Server check successful', result);
      
      // Update server connection status
      if (result.serverAvailable) {
        if (!isConnected) {
          debugLog('Connected to M365 server');
          setIsConnected(true);
          globalConnectionStatus = true;
          setConnectionError(null);
          
          // Generate client ID if we don't have one
          if (!clientId) {
            const randomId = Math.random().toString(36).substring(2, 15);
            setClientId(randomId);
            globalClientId = randomId;
          }
        }
        
        // Set login status based on response
        setIsLoggedIn(result.isAuthenticated);
        globalLoginStatus = result.isAuthenticated;
        
        // If we're logged in and have user info, store it
        if (result.isAuthenticated && result.user) {
          setLoginInfo(result.user);
        }
        
        // Get the tools if available in the response
        if (result.tools && Array.isArray(result.tools)) {
          const toolObjects = result.tools.map((name: string) => ({
            name,
            description: `M365 tool: ${name}`,
            parameters: {}
          }));
          setTools(toolObjects);
          globalTools = toolObjects;
        }
      } else {
        setIsConnected(false);
        globalConnectionStatus = false;
        setConnectionError('M365 server is not available');
      }
    } catch (error) {
      debugLog('Error checking server connection:', error);
      setIsConnected(false);
      globalConnectionStatus = false;
      setConnectionError('Cannot connect to M365 server');
    }
  }, [enabled, isConnected, clientId]);
  
  // Check server connection on mount
  useEffect(() => {
    if (!enabled) return;
    
    instanceCount++;
    
    // Check connection when component mounts
    checkServerConnection();
    
    return () => {
      instanceCount--;
    };
  }, [enabled, checkServerConnection]);
  
  // Invoke a tool
  const invokeTool = useCallback(async (toolName: string, params: Record<string, any> = {}) => {
    if (!enabled) throw new Error('M365 MCP not initialized');
    debugLog(`Invoking tool: ${toolName}`);
    
    if (!clientId) {
      debugLog('Cannot invoke tool - no client ID (not connected)');
      throw new Error('Not connected to M365 MCP');
    }
    
    if (!isConnected) {
      debugLog('Not connected to server');
      throw new Error('Not connected to M365 MCP server');
    }
    
    try {
      // Use the server's invoke endpoint
      const url = '/api/m365/invoke';
      debugLog(`Sending request to ${url} with clientId ${clientId}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: toolName,
          params,
          clientId
        }),
      });
      
      if (!response.ok) {
        debugLog(`Tool invocation error: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.requiresAzureAuth) {
            debugLog('Login required - user is not authenticated with Azure AD');
            throw new Error('Azure AD authentication required');
          }
          throw new Error(errorData.error || errorData.message || 'Unknown error');
        } catch (parseError) {
          throw new Error(errorText || 'Failed to invoke tool');
        }
      }
      
      const result = await response.json();
      debugLog(`Tool invocation successful for ${toolName}`, result);
      return result;
    } catch (error) {
      debugLog(`Error invoking tool ${toolName}:`, error);
      throw error;
    }
  }, [enabled, clientId, isConnected]);
  
  // Login to Microsoft 365
  const login = useCallback(async (force: boolean = false) => {
    if (!enabled) throw new Error('M365 MCP not initialized');
    debugLog('Attempting to login to M365', { force });
    
    // Check server connection before attempting login
    await checkServerConnection();
    
    try {
      const response = await fetch('/api/m365/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          force,
          clientId 
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Login failed:', errorText);
        throw new Error(`Login failed: ${errorText}`);
      }
      
      const result = await response.json();
      debugLog('Login response:', result);
      
      if (result.success) {
        // Update login status directly
        setIsLoggedIn(true);
        globalLoginStatus = true;
        // Store login info
        setLoginInfo(result.user || result);
      }
      
      return result;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }, [enabled, clientId, checkServerConnection]);
  
  // Logout from Microsoft 365
  const logout = useCallback(async () => {
    if (!enabled) throw new Error('M365 MCP not initialized');
    debugLog('Attempting to logout from M365');
    
    try {
      const response = await fetch('/api/m365/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clientId })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Logout failed:', errorText);
        throw new Error(`Logout failed: ${errorText}`);
      }
      
      const result = await response.json();
      debugLog('Logout response:', result);
      
      if (result.success) {
        // Update login status
        setIsLoggedIn(false);
        globalLoginStatus = false;
        // Clear login info
        setLoginInfo(null);
      }
      
      return result;
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }, [enabled, clientId]);
  
  // If the hook is disabled, return the default values
  if (!enabled) {
    return defaultReturnValue;
  }
  
  // Return the real values when enabled
  return {
    clientId,
    tools,
    isConnected,
    isLoggedIn,
    connectionError,
    loginInfo,
    invokeTool,
    login,
    logout
  };
} 