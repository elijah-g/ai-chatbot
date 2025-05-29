import { compare } from 'bcrypt-ts';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getUser, findOrCreateAzureADUser } from '@/lib/db/queries';
import { authConfig } from './auth.config';
import { DUMMY_PASSWORD } from '@/lib/constants';
import type { DefaultJWT } from 'next-auth/jwt';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export type UserType = 'regular' | 'azuread';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
      accessToken?: string;
      accessTokenExpires?: number;
    } & DefaultSession['user'];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    scope?: string;
  }
}

/**
 * Refreshes an expired access token using the refresh token
 */
async function refreshAccessToken(token: any) {
  try {
    logger.info("Attempting to refresh access token...");
    const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;
    
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        scope: 'openid profile email offline_access Calendars.ReadWrite ChannelMessage.ReadWrite Chat.ReadWrite Contacts.ReadWrite Files.ReadWrite.All Group.Read.All Mail.ReadWrite People.Read Sites.Read.All Tasks.ReadWrite Team.ReadBasic.All User.Read',
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      method: "POST",
    });

    const tokens = await response.json();

    if (!response.ok) {
      logger.error("Token refresh failed:", tokens);
      throw tokens;
    }

    logger.info("Access token refreshed successfully");
    logger.info(`Refreshed token scope: ${tokens.scope}`);
    
    return {
      ...token,
      accessToken: tokens.access_token,
      accessTokenExpires: Date.now() + tokens.expires_in * 1000,
      refreshToken: tokens.refresh_token ?? token.refreshToken, // Fall back to old refresh token
      scope: tokens.scope, // Store the refreshed scope
    };
  } catch (error) {
    logger.error("Error refreshing access token:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid profile email offline_access Calendars.ReadWrite ChannelMessage.ReadWrite Chat.ReadWrite Contacts.ReadWrite Files.ReadWrite.All Group.Read.All Mail.ReadWrite People.Read Sites.Read.All Tasks.ReadWrite Team.ReadBasic.All User.Read',
          prompt: 'consent',
          access_type: 'offline',
        },
        url: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/authorize`,
      },
      token: {
        url: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      },
      userinfo: { 
        url: 'https://graph.microsoft.com/oidc/userinfo' 
      },
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
    }),
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) return null;

        return { ...user, type: 'regular' };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // Initial sign-in
      if (account && user) {
        // If it's Azure AD authentication
        if (account.provider === 'azure-ad') {
          let userId = user.id;
          
          // Check if user exists in database using their email
          if (user.email) {
            try {
              // Find or create user in the database
              const dbUser = await findOrCreateAzureADUser(user.email);
              userId = dbUser.id;
              logger.info(`Azure AD user with email ${user.email} has database ID: ${userId}`);
            } catch (error) {
              logger.error('Error ensuring user exists in database:', error);
              // Continue with the existing ID as fallback
            }
          }
          
          logger.info(`Initial Azure AD token received with scope: ${account.scope}`);
          logger.info(`Token expires at: ${new Date(account.expires_at ? account.expires_at * 1000 : 0)}`);
          
          return {
            ...token,
            id: userId as string,
            type: 'azuread',
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0, // Convert to ms
            scope: account.scope, // Store the scope for debugging
          };
        }
        
        // For regular authentication
        return {
          ...token,
          id: user.id as string,
          type: user.type,
        };
      }

      // Return previous token if the access token has not expired yet
      if (token.accessToken && token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // Access token has expired, try to refresh it
      if (token.refreshToken) {
        logger.info("Access token expired, attempting refresh...");
        return refreshAccessToken(token);
      }

      // No refresh token available, return existing token (user will need to re-authenticate)
      logger.warn("No refresh token available, user will need to re-authenticate");
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        // Include the access token and expiry in the session for API calls
        session.user.accessToken = token.accessToken;
        session.user.accessTokenExpires = token.accessTokenExpires;
      }

      return session;
    },
  },
});
