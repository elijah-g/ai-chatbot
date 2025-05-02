import { checkMcpServerTools } from '../client';
import { auth } from '@/app/(auth)/auth';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    // Check if the server is available
    const { available, tools } = await checkMcpServerTools();
    
    // Get authentication status
    const session = await auth();
    const isAuthenticated = !!session;
    
    return Response.json({
      serverAvailable: available,
      isAuthenticated,
      user: session?.user || null,
      tools: tools || []
    });
  } catch (error) {
    console.error('Error verifying login status:', error);
    return Response.json({
      serverAvailable: false,
      isAuthenticated: false,
      error: 'Error checking server status'
    }, { status: 500 });
  }
} 