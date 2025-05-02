'use client';

import { useState } from 'react';
import { useM365McpContext } from './m365-mcp-provider';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';

// Ensure URL has proper scheme
function getServerUrl() {
  let serverUrl = process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
  if (!serverUrl.match(/^https?:\/\//i)) {
    serverUrl = `http://${serverUrl}`;
  }
  return serverUrl;
}

export function M365LoginButton() {
  const { isLoggedIn, isConnected, connectionError, loginInfo, login, logout } = useM365McpContext();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      const result = await login();
      
      if (result.loginInfo) {
        // Show device code info
        toast.info(
          <div>
            <p className="font-semibold mb-2">Microsoft 365 Login Required</p>
            <p>To sign in, use a web browser to open the page <a href={result.loginInfo.verificationUri} target="_blank" rel="noopener noreferrer" className="underline text-blue-500">{result.loginInfo.verificationUri}</a> and enter the code {result.loginInfo.userCode} to authenticate.</p>
          </div>,
          {
            duration: 60000, // 1 minute
          }
        );
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Failed to login to Microsoft 365');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out from Microsoft 365');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Failed to logout from Microsoft 365');
    }
  };

  const showConnectionHelp = () => {
    toast(
      <div>
        <p className="font-semibold mb-2">M365 Connection Troubleshooting</p>
        <p className="mb-2">Possible solutions:</p>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Make sure the M365 MCP server is running on port 4891</li>
          <li>Check your environment variables are set correctly</li>
          <li>Verify that the MCP server URL is correctly set to: {getServerUrl()}</li>
          <li>Restart both the ai-chatbot and ms-365-mcp-server</li>
        </ol>
      </div>,
      {
        duration: 15000,
      }
    );
  };

  if (!isConnected) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        className="flex items-center gap-1 text-red-500"
        onClick={showConnectionHelp}
      >
        <AlertCircle className="h-4 w-4" />
        <span className="max-w-[160px] truncate">
          {connectionError || 'M365 Connection Error'}
        </span>
      </Button>
    );
  }

  if (isLoggedIn === null) {
    return (
      <Button variant="outline" size="sm" disabled={true}>
        Checking M365 login...
      </Button>
    );
  }

  if (isLoggedIn) {
    return (
      <Button variant="outline" size="sm" onClick={handleLogout}>
        Logout from M365
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogin} disabled={isLoggingIn}>
      {isLoggingIn ? 'Logging in...' : 'Login to M365'}
    </Button>
  );
} 