import { useSession } from 'next-auth/react';
import { useM365Mcp } from './use-m365-mcp';
import { toast } from '@/components/toast';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function useM365WithAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  
  // Get the M365 client
  const m365Client = useM365Mcp();
  
  // Determine authentication status
  const isAuthenticated = status === 'authenticated';
  const isAzureUser = session?.user?.type === 'azuread' && !!session?.user?.accessToken;
  
  // Function to invoke a tool with authentication handling
  const invokeM365Tool = async (toolName: string, params: Record<string, any> = {}) => {
    // User is not authenticated at all
    if (!isAuthenticated) {
      toast({
        type: 'error',
        description: 'You need to be signed in to use Microsoft 365 features'
      });
      return null;
    }
    
    // User is authenticated but not with Azure AD
    if (!isAzureUser) {
      toast({
        type: 'error',
        description: 'Microsoft 365 features require Azure AD authentication'
      });
      
      // Prompt for Azure AD authentication
      try {
        setIsAuthenticating(true);
        
        // Redirect to Azure AD login
        router.push('/api/auth/signin/azure-ad');
        return null;
      } catch (error) {
        console.error('Azure AD authentication error:', error);
        toast({
          type: 'error',
          description: 'Failed to authenticate with Microsoft 365'
        });
        return null;
      } finally {
        setIsAuthenticating(false);
      }
    }
    
    // User is authenticated with Azure AD, proceed with tool invocation
    try {
      const result = await m365Client.invokeTool(toolName, params);
      return result;
    } catch (error) {
      console.error(`Error invoking M365 tool ${toolName}:`, error);
      
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes('Azure AD authentication required')) {
        toast({
          type: 'error',
          description: 'Your Microsoft 365 session has expired. Please sign in again.'
        });
        router.push('/api/auth/signin/azure-ad');
        return null;
      }
      
      toast({
        type: 'error',
        description: `Failed to use Microsoft 365 tool: ${error instanceof Error ? error.message : String(error)}`
      });
      return null;
    }
  };
  
  return {
    invokeM365Tool,
    isAuthenticated,
    isAzureUser,
    isAuthenticating,
    m365Client,
    session,
  };
} 