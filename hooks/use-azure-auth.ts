import { useSession } from 'next-auth/react';

export function useAzureAuth() {
  const { data: session, status } = useSession();
  
  const isAuthenticated = status === 'authenticated';
  const isLoading = status === 'loading';
  
  // Determine if the user is authenticated via Azure AD
  const isAzureADUser = session?.user?.type === 'azuread';
  
  // Get the access token from the session
  const accessToken = session?.user?.accessToken;
  
  // Function to create Authorization header for API requests
  const getAuthHeader = (): Record<string, string> => {
    if (!accessToken) return {};
    return {
      Authorization: `Bearer ${accessToken}`
    };
  };
  
  // Function to make an authenticated API request
  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    
    // Add authorization header if we have a token
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      
      // Handle token expiration (401 Unauthorized)
      if (response.status === 401) {
        // In a more advanced implementation, you could try to refresh the token here
        throw new Error('Authentication token expired or invalid');
      }
      
      return response;
    } catch (error) {
      console.error('Error making authenticated request:', error);
      throw error;
    }
  };
  
  return {
    isAuthenticated,
    isLoading,
    isAzureADUser,
    accessToken,
    getAuthHeader,
    fetchWithAuth,
    session,
  };
} 