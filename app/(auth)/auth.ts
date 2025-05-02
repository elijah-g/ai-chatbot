import { compare } from 'bcrypt-ts';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import AzureADProvider from "next-auth/providers/azure-ad";
import { getUser, findOrCreateAzureADUser } from '@/lib/db/queries';
import { authConfig } from './auth.config';
import { DUMMY_PASSWORD } from '@/lib/constants';
import type { DefaultJWT } from 'next-auth/jwt';
import { createClient } from '@supabase/supabase-js';

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
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid profile email User.Read offline_access',
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
              console.log(`Azure AD user with email ${user.email} has database ID: ${userId}`);
            } catch (error) {
              console.error('Error ensuring user exists in database:', error);
              // Continue with the existing ID as fallback
            }
          }
          
          return {
            ...token,
            id: userId as string,
            type: 'azuread',
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0, // Convert to ms
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

      // Token has expired, try to refresh it (future enhancement)
      // For now, just return the existing token
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        // Include the access token in the session for API calls
        session.user.accessToken = token.accessToken;
      }

      return session;
    },
  },
});
