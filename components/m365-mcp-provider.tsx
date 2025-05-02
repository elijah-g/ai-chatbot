'use client';

import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useM365Mcp } from '@/hooks/use-m365-mcp';

// Define the context type
interface M365McpContextType {
  clientId: string | null;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
  isConnected: boolean;
  isLoggedIn: boolean | null;
  connectionError: string | null;
  loginInfo: any | null;
  invokeTool: (toolName: string, params?: Record<string, any>) => Promise<any>;
  login: (force?: boolean) => Promise<any>;
  logout: () => Promise<any>;
}

// Create the context with default values
const M365McpContext = createContext<M365McpContextType | null>(null);

// Provider component
export function M365McpProvider({ children }: { children: ReactNode }) {
  // Always call all hooks, regardless of conditions
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Use the MCP hook with the enabled parameter
  const m365McpConnection = useM365Mcp({ enabled: isInitialized });
  
  // Delayed initialization to prevent double connections in React StrictMode
  useEffect(() => {
    // Use setTimeout to ensure this happens after the first render cycle
    const timer = setTimeout(() => {
      setIsInitialized(true);
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <M365McpContext.Provider value={m365McpConnection}>
      {children}
    </M365McpContext.Provider>
  );
}

// Hook for using the context
export function useM365McpContext() {
  const context = useContext(M365McpContext);
  
  if (!context) {
    throw new Error('useM365McpContext must be used within a M365McpProvider');
  }
  
  return context;
} 