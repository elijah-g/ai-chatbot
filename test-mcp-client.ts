/**
 * Test script for MCP client implementation
 * 
 * Run with: npx tsx test-mcp-client.ts
 */

import { Client, StreamableHTTPClientTransport } from './lib/ai/mcp/client';
import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Create MCP client
  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  });

  // Get MCP server URL from environment variables or use default
  let mcpServerUrl = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:4891';
  
  // Ensure URL has proper scheme
  if (!mcpServerUrl.match(/^https?:\/\//i)) {
    mcpServerUrl = `http://${mcpServerUrl}`;
  }
  
  console.log('Using MCP server URL:', mcpServerUrl);
  
  // Configure URL for the MCP server
  const url = new URL('/mcp', mcpServerUrl);
  
  // Create transport with session management
  const transport = new StreamableHTTPClientTransport(url, {
    requestOptions: {
      headers: {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      }
    },
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 3
    }
  });

  // Set up notification handler for logging messages
  client.setNotificationHandler(
    z.object({
      level: z.string(),
      message: z.string()
    }).describe('logging/message'),
    (notification) => {
      console.log(`[Server Log] ${notification.level}: ${notification.message}`);
    }
  );

  try {
    console.log('Connecting to MCP server...');
    await client.connect(transport);
    console.log('Connected successfully! Session ID:', transport.sessionId);

    // List available tools
    console.log('\nListing available tools:');
    const tools = await client.listTools();
    console.log(JSON.stringify(tools, null, 2));

    // If there are tools available, try calling the first one
    if (tools && tools.length > 0) {
      const firstTool = tools[0];
      console.log(`\nCalling tool: ${firstTool.name}`);
      
      // For this test we'll just pass empty arguments
      const result = await client.callTool({
        name: firstTool.name,
        arguments: {}
      });
      
      console.log('Tool result:', JSON.stringify(result, null, 2));
    }

    // Try to list resources if available
    try {
      console.log('\nListing available resources:');
      const resources = await client.listResources();
      console.log(JSON.stringify(resources, null, 2));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Resources not supported or error:', errorMessage);
    }

    // Try to list prompts if available
    try {
      console.log('\nListing available prompts:');
      const prompts = await client.listPrompts();
      console.log(JSON.stringify(prompts, null, 2));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Prompts not supported or error:', errorMessage);
    }

    // Test session termination
    if (transport.sessionId) {
      console.log('\nTerminating session...');
      try {
        await transport.terminateSession();
        console.log('Session terminated successfully');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log('Session termination not supported or error:', errorMessage);
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error:', errorMessage);
  } finally {
    // Close the connection
    await client.close();
    console.log('\nConnection closed');
  }
}

main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Unhandled error:', errorMessage);
}); 