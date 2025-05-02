import { signIn } from '@/app/(auth)/auth';
import { isDevelopmentEnvironment } from '@/lib/constants';
import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirectUrl') || '/';

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  try {
    // Redirect to Azure AD login instead of guest login
    return signIn('azure-ad', { redirect: true, redirectTo: redirectUrl });
  } catch (error) {
    console.error('Azure AD sign-in error:', error);
    return NextResponse.redirect(new URL(`/login?error=SignInFailed`, request.url));
  }
}

// Handle POST requests too
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const redirectUrl = body.redirectUrl || '/';
    
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });

    if (token) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    // Redirect to Azure AD login
    return signIn('azure-ad', { redirect: true, redirectTo: redirectUrl });
  } catch (error) {
    console.error('Azure AD sign-in error (POST):', error);
    return NextResponse.redirect(new URL(`/login?error=SignInFailed`, request.url));
  }
}
