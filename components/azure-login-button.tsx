'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import { Button } from './ui/button';
import { Loader2 } from 'lucide-react';

export function AzureLoginButton() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { data: session, status } = useSession();
  
  const isAzureUser = session?.user?.type === 'azuread';
  const isAuthenticated = status === 'authenticated';
  
  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      await signIn('azure-ad', { callbackUrl: window.location.href });
    } catch (error) {
      console.error('Azure AD login error:', error);
    } finally {
      setIsLoggingIn(false);
    }
  };
  
  const handleLogout = async () => {
    try {
      await signOut({ callbackUrl: '/' });
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };
  
  // User is logged in with Azure AD
  if (isAuthenticated && isAzureUser) {
    return (
      <Button 
        variant="outline" 
        onClick={handleLogout}
        className="flex items-center gap-2"
      >
        {session.user?.image && (
          <img 
            src={session.user.image} 
            alt={session.user.name || 'User'} 
            className="w-5 h-5 rounded-full" 
          />
        )}
        Sign Out from Azure
      </Button>
    );
  }
  
  // User is not logged in or not with Azure AD
  return (
    <Button 
      variant="outline" 
      onClick={handleLogin}
      disabled={isLoggingIn}
      className="flex items-center gap-2"
    >
      {isLoggingIn ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" width="20" height="20">
          <path fill="#f25022" d="M1 1h10v10H1z" />
          <path fill="#00a4ef" d="M1 12h10v10H1z" />
          <path fill="#7fba00" d="M12 1h10v10H12z" />
          <path fill="#ffb900" d="M12 12h10v10H12z" />
        </svg>
      )}
      {isLoggingIn ? 'Signing in...' : 'Sign in with Microsoft'}
    </Button>
  );
} 