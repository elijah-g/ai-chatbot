import { Session } from 'next-auth';

/**
 * Creates an authenticated fetch function for MS365 API requests.
 * @param session The NextAuth session containing authentication information
 * @param baseUrl Optional base URL for the MS365 API
 * @returns A function for making authenticated requests
 */
export function createM365Api(session: Session | null, baseUrl = '/api/m365') {
  // Function to create headers with authorization token
  const createHeaders = (additionalHeaders = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    };

    // Add auth token if available
    if (session?.user?.accessToken) {
      headers['Authorization'] = `Bearer ${session.user.accessToken}`;
    }

    return headers;
  };

  // Generic request function
  const request = async <T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> => {
    const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    
    const response = await fetch(url, {
      ...options,
      headers: createHeaders(options.headers),
    });

    // Handle 401 Unauthorized errors (token expired or invalid)
    if (response.status === 401) {
      throw new Error('Authentication token expired or invalid');
    }

    // Handle other non-2xx responses
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MS365 API error (${response.status}): ${errorText}`);
    }

    // Parse JSON response
    const data = await response.json();
    return data as T;
  };

  // Helper methods for common HTTP verbs
  return {
    get: <T>(endpoint: string, options: Omit<RequestInit, 'method'> = {}) => 
      request<T>(endpoint, { ...options, method: 'GET' }),
    
    post: <T>(endpoint: string, data: any, options: Omit<RequestInit, 'method' | 'body'> = {}) => 
      request<T>(endpoint, { 
        ...options, 
        method: 'POST',
        body: JSON.stringify(data),
      }),
    
    put: <T>(endpoint: string, data: any, options: Omit<RequestInit, 'method' | 'body'> = {}) => 
      request<T>(endpoint, { 
        ...options, 
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    
    delete: <T>(endpoint: string, options: Omit<RequestInit, 'method'> = {}) => 
      request<T>(endpoint, { ...options, method: 'DELETE' }),
  };
} 