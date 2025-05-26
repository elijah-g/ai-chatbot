# Azure AD Authentication Integration

This document provides an overview of the Azure Active Directory (Azure AD) authentication implementation in the AI Chatbot application.

## Overview

Azure AD authentication has been implemented using NextAuth.js to enable secure access to Microsoft 365 resources. This implementation provides:

1. Azure AD authentication with OpenID Connect
2. Session management with access token persistence
3. **Automatic token refresh** to handle token expiration
4. Protected routes requiring Azure AD authentication
5. Integration with the existing M365 MCP client

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
AZURE_AD_TENANT_ID=your-azure-ad-tenant-id

# MCP Server Configuration
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:8080
```

### Azure AD App Registration

1. Create an App Registration in Azure AD Portal
2. Configure Web platform with redirect URI: `http://localhost:3000/api/auth/callback/azure-ad`
3. Create a client secret
4. Configure API permissions:
   - Microsoft Graph: User.Read, openid, profile, email, offline_access
   - **Recommended**: Grant admin consent for your organization

## Implementation Details

### Authentication Provider

The Azure AD authentication provider is configured in `app/(auth)/auth.ts` with the following enhanced scopes:
- openid
- profile
- email
- User.Read
- offline_access
- https://graph.microsoft.com/.default (for comprehensive Graph API access)

### Token Management

**NEW: Automatic Token Refresh**

Access tokens from Azure AD are now automatically refreshed:
1. Obtained during authentication with refresh tokens
2. Stored in the JWT session with expiration timestamps
3. **Automatically refreshed** when they expire or are close to expiring
4. Proactively checked before MCP tool calls
5. Used for API requests to Microsoft 365 services

#### Token Refresh Process

1. **Proactive Refresh**: Tokens are refreshed 5 minutes before expiration
2. **Automatic Refresh**: The JWT callback automatically handles expired tokens
3. **Error Handling**: Failed refresh attempts redirect users to re-authenticate
4. **Session Updates**: The `useSession().update()` function triggers token refresh

### Middleware

The middleware (`middleware.ts`) protects routes that require authentication:
- General protected routes allow guest access
- Azure-specific routes require Azure AD authentication
- Unauthenticated requests are redirected to the appropriate login flow

### React Hooks

Several hooks have been implemented to facilitate Azure AD authentication:

1. `useAzureAuth`: Extracts access tokens from the session
2. `useM365WithAuth`: Combines Azure AD authentication with M365 client and **automatic token refresh**
3. `useM365Mcp`: **NEW** - Direct MCP client hook with connection management

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
- **NEW**: Support automatic token refresh

## Usage

### Authenticating Users

```tsx
import { AzureLoginButton } from '@/components/azure-login-button';

function LoginPage() {
  return (
    <div>
      <h1>Sign in to access Microsoft 365</h1>
      <AzureLoginButton />
    </div>
  );
}
```

### Using M365 Features with Auto-Refresh

```tsx
import { useM365WithAuth } from '@/hooks/use-m365-with-auth';

function M365Component() {
  const { invokeM365Tool, isAzureUser, isAuthenticated } = useM365WithAuth();
  
  const handleGetEmails = async () => {
    // Token refresh is handled automatically
    const result = await invokeM365Tool('get_emails', { limit: 10 });
    console.log('Emails:', result);
  };
  
  if (!isAuthenticated) {
    return <div>Please sign in</div>;
  }
  
  if (!isAzureUser) {
    return <div>Azure AD authentication required</div>;
  }
  
  return (
    <button onClick={handleGetEmails}>
      Get Recent Emails
    </button>
  );
}
```

### Manual Token Refresh

```tsx
import { useM365WithAuth } from '@/hooks/use-m365-with-auth';

function TokenStatus() {
  const { checkAndRefreshToken, session } = useM365WithAuth();
  
  const handleRefresh = async () => {
    const success = await checkAndRefreshToken();
    if (success) {
      console.log('Token refreshed successfully');
    } else {
      console.log('Token refresh failed');
    }
  };
  
  const tokenExpiry = session?.user?.accessTokenExpires;
  const isExpiringSoon = tokenExpiry && (Date.now() + 5 * 60 * 1000) > tokenExpiry;
  
  return (
    <div>
      <p>Token Status: {isExpiringSoon ? 'Expiring Soon' : 'Valid'}</p>
      <button onClick={handleRefresh}>Refresh Token</button>
    </div>
  );
}
```

## Token Lifecycle

### Access Token Expiration

- **Default Lifetime**: 1 hour (Microsoft Graph API standard)
- **Maximum Lifetime**: 24 hours (configurable in Azure AD)
- **Refresh Window**: Tokens are refreshed 5 minutes before expiration
- **Refresh Token Lifetime**: 90 days (or until revoked)

### Error Handling

The implementation handles various token-related scenarios:

1. **Token Expired**: Automatic refresh using refresh token
2. **Refresh Token Expired**: Redirect to re-authentication
3. **Network Errors**: Retry logic with fallback to re-authentication
4. **Invalid Tokens**: Clear session and redirect to login

## Troubleshooting

### Common Issues

1. **Token Refresh Fails**
   - Check Azure AD app registration permissions
   - Verify `offline_access` scope is granted
   - Ensure `AZURE_AD_TENANT_ID` is correctly set

2. **MCP Authentication Errors**
   - Verify MCP server supports Bearer token authentication
   - Check network connectivity to MCP server
   - Review browser console for detailed error messages

3. **Session Persistence Issues**
   - Verify `NEXTAUTH_SECRET` is set and consistent
   - Check browser cookie settings
   - Ensure HTTPS in production environments

### Debug Logging

Enable debug logging by checking browser console for:
- `[MCP Hook]` - MCP client operations
- `[MCP Debug]` - Detailed MCP protocol messages
- NextAuth debug messages for authentication flow

## Security Considerations

1. **Token Storage**: Access tokens are stored in encrypted JWT sessions
2. **Refresh Tokens**: Securely stored and rotated on each refresh
3. **HTTPS**: Required for production deployments
4. **Token Scope**: Limited to necessary Microsoft Graph permissions
5. **Session Timeout**: Configurable session and token lifetimes 