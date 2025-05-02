# Azure AD Authentication Integration

This document provides an overview of the Azure Active Directory (Azure AD) authentication implementation in the AI Chatbot application.

## Overview

Azure AD authentication has been implemented using NextAuth.js to enable secure access to Microsoft 365 resources. This implementation provides:

1. Azure AD authentication with OpenID Connect
2. Session management with access token persistence
3. Protected routes requiring Azure AD authentication
4. Integration with the existing M365 MCP client

## Configuration

### Environment Variables

The following environment variables are required:

```env
# Next Auth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-key

# Azure AD Configuration
AZURE_AD_CLIENT_ID=your-azure-ad-client-id
AZURE_AD_CLIENT_SECRET=your-azure-ad-client-secret
```

### Azure AD App Registration

1. Create an App Registration in Azure AD Portal
2. Configure Web platform with redirect URI: `http://localhost:3000/api/auth/callback/azure-ad`
3. Create a client secret
4. Configure API permissions:
   - Microsoft Graph: User.Read, openid, profile, email, offline_access

## Implementation Details

### Authentication Provider

The Azure AD authentication provider is configured in `app/(auth)/auth.ts` with the following scopes:
- openid
- profile
- email
- User.Read
- offline_access

### Token Management

Access tokens from Azure AD are:
1. Obtained during authentication
2. Stored in the JWT session
3. Made available via the session object
4. Used for API requests to Microsoft 365 services

### Middleware

The middleware (`middleware.ts`) protects routes that require authentication:
- General protected routes allow guest access
- Azure-specific routes require Azure AD authentication
- Unauthenticated requests are redirected to the appropriate login flow

### React Hooks

Several hooks have been implemented to facilitate Azure AD authentication:

1. `useAzureAuth`: Extracts access tokens from the session
2. `useM365WithAuth`: Combines Azure AD authentication with M365 client

### Components

The `AzureLoginButton` component provides a UI element for:
- Signing in with Azure AD
- Displaying authentication status
- Signing out

### API Integration

The M365 API routes have been updated to:
- Verify Azure AD authentication
- Include access tokens with requests
- Handle authentication errors

## Usage

### Authenticating Users

```tsx
import { AzureLoginButton } from '@/components/azure-login-button';

export default function LoginPage() {
  return (
    <div>
      <h1>Login</h1>
      <AzureLoginButton />
    </div>
  );
}
```

### Making Authenticated API Requests

```tsx
import { useM365WithAuth } from '@/hooks/use-m365-with-auth';

export default function M365Component() {
  const { invokeM365Tool, isAzureUser } = useM365WithAuth();
  
  const handleFetchEmails = async () => {
    const result = await invokeM365Tool('getMail', { count: 10 });
    // Process result
  };
  
  return (
    <div>
      {isAzureUser ? (
        <button onClick={handleFetchEmails}>Fetch Emails</button>
      ) : (
        <p>Please log in with Microsoft to access this feature</p>
      )}
    </div>
  );
}
```

## Security Considerations

1. Access tokens are stored securely in the session
2. Protected routes enforce authentication
3. Token expiration is handled gracefully
4. API requests validate authentication before processing 