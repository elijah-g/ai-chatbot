import { NextRequest, NextResponse } from 'next/server';

// This endpoint helps diagnose where ping requests are coming from
export async function GET(req: NextRequest) {
  // Extract useful information
  const headers = Object.fromEntries(req.headers);
  const referer = req.headers.get('referer') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  
  // Log diagnostic information to help track the source
  console.log('============= M365 PING DIAGNOSTIC LOG =============');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Referer: ${referer}`);
  console.log(`User-Agent: ${userAgent}`);
  console.log(`URL: ${req.url}`);
  
  // Respond with a message including instructions
  return NextResponse.json({ 
    message: 'pong',
    diagnostic: true,
    note: 'This endpoint is receiving periodic calls that should have been removed. Check the server logs for details.'
  });
} 