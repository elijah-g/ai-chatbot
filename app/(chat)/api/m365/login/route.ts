import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/app/(auth)/auth';
import { v4 as uuidv4 } from 'uuid';

// MCP server URL
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8080';

interface DeviceCodeResponse {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export async function POST(req: NextRequest) {
  console.log('[MCP Debug] Login request received');
  const session = await auth();
  
  // Check authentication
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get the session ID from the headers
    const sessionId = req.headers.get('mcp-session-id') || req.headers.get('Mcp-Session-Id');
    if (!sessionId) {
      return Response.json({ error: 'Missing session ID' }, { status: 400 });
    }

    // Get force parameter from request body
    const { force } = await req.json().catch(() => ({ force: false }));

    // Prepare the login request
    const loginRequest = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tools/call",
      params: {
        name: "mcp_ms365_login",
        arguments: {
          force: force || false
        }
      }
    };
    
    // Call the login tool directly
    console.log(`[MCP Debug] Calling MS365 login tool with session ID: ${sessionId}`);
    const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId
      },
      body: JSON.stringify(loginRequest)
    });
    
    // Check if the response is OK
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[MCP Debug] Error from MCP server: ${response.status} ${errorText}`);
      return Response.json({ 
        error: `HTTP error ${response.status}: ${errorText}` 
      }, { status: response.status });
    }
    
    // Parse the response
    const data = await response.json();
    
    // Check for errors in the response
    if (data.error) {
      return Response.json({
        error: `JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`
      }, { status: 500 });
    }
    
    const loginResult = data.result;

    if (!loginResult || !loginResult.loginInfo) {
      return Response.json({
        error: 'Invalid response from Microsoft 365 login',
        details: 'The login response is missing required information.'
      }, { status: 500 });
    }

    const loginInfo = loginResult.loginInfo as DeviceCodeResponse;

    // Store the device_code in a secure cookie for later use
    const cookieResponse = NextResponse.json({
      user_code: loginInfo.user_code,
      verification_uri: loginInfo.verification_uri,
      expires_in: loginInfo.expires_in,
      interval: loginInfo.interval,
      message: loginInfo.message,
    });
    
    // Set the cookie on the response
    cookieResponse.cookies.set('m365_device_code', loginInfo.device_code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: loginInfo.expires_in,
      path: '/',
    });

    return cookieResponse;
  } catch (error) {
    console.error('Error during M365 login:', error);
    return NextResponse.json({
      error: 'An error occurred during login'
    }, { status: 500 });
  }
} 