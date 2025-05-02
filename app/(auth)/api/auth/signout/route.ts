import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { cookies } from 'next/headers';

// Clear all auth-related cookies
const clearAuthCookies = async () => {
  const cookieStore = await cookies();
  
  // Clear standard NextAuth cookies
  cookieStore.delete('next-auth.session-token');
  cookieStore.delete('next-auth.callback-url');
  cookieStore.delete('next-auth.csrf-token');
  
  // Clear secure versions too
  cookieStore.delete('__Secure-next-auth.callback-url');
  cookieStore.delete('__Secure-next-auth.session-token');
  cookieStore.delete('__Secure-next-auth.csrf-token');
  cookieStore.delete('__Host-next-auth.csrf-token');
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  
  try {
    // Use the auth() function to get the current session
    const session = await auth();
    
    if (session) {
      // Clear cookies
      await clearAuthCookies();
    }
    
    // Set explicit headers for no-cache to prevent session persistence issues
    const headers = new Headers();
    headers.set('Cache-Control', 'no-store, max-age=0');
    headers.set('Pragma', 'no-cache');
    
    // Redirect to the callback URL
    return NextResponse.redirect(new URL(callbackUrl, request.url), {
      headers
    });
  } catch (error: any) {
    console.error('Unexpected sign out error:', error);
    return NextResponse.redirect(new URL('/', request.url));
  }
}

// NextAuth sometimes uses POST for signout
export async function POST(request: Request) {
  let callbackUrl = '/';
  
  try {
    // Try to parse the request body for a callback URL
    const body = await request.json().catch(() => ({}));
    callbackUrl = body.callbackUrl || '/';
  } catch (error) {
    // If JSON parsing fails, continue with default callback
  }
  
  try {
    // Use the auth() function to get the current session
    const session = await auth();
    
    if (session) {
      // Clear cookies
      await clearAuthCookies();
    }
    
    // Set explicit headers for no-cache to prevent session persistence issues
    const headers = new Headers();
    headers.set('Cache-Control', 'no-store, max-age=0');
    headers.set('Pragma', 'no-cache');
    
    // Redirect to the callback URL
    return NextResponse.redirect(new URL(callbackUrl, request.url), {
      headers
    });
  } catch (error: any) {
    console.error('Unexpected sign out error:', error);
    return NextResponse.redirect(new URL('/', request.url));
  }
} 