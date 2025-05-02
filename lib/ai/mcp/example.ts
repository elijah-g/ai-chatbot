import { createMcpClient } from './client';

async function runMcpExample() {
  try {
    // Create a new MCP client
    const mcpClient = createMcpClient({
      baseUrl: 'http://localhost:8080', // Adjust this to match your MCP server URL
    });

    // Initialize a session with the MCP server
    console.log('Initializing MCP session...');
    const sessionInfo = await mcpClient.initialize();
    console.log(`Session initialized with ID: ${sessionInfo.sessionId}`);

    // List available tools
    console.log('Listing available tools...');
    const tools = await mcpClient.listTools();
    console.log(`Found ${tools.length} tools:`);
    
    // Print tool names and descriptions
    tools.forEach((tool, index) => {
      console.log(`${index + 1}. ${tool.name}: ${tool.description}`);
    });

    // Example: Try the verify-login tool
    console.log('\nVerifying M365 login status...');
    try {
      const loginStatus = await mcpClient.invokeTool('mcp_ms365_verify-login', {
        random_string: 'test'
      });
      console.log('Login status:', loginStatus);
    } catch (error) {
      console.log('Not logged in or error checking login status:', error);
      
      // If not logged in, demonstrate login tool
      console.log('\nAttempting to log in to M365...');
      try {
        const loginResult = await mcpClient.invokeTool('mcp_ms365_login', {
          force: 'true'
        });
        console.log('Login initiated:', loginResult);
      } catch (loginError) {
        console.error('Error initiating login:', loginError);
      }
    }

    // Example: Try a simple example tool
    console.log('\nTrying the example_tool...');
    try {
      const exampleResult = await mcpClient.invokeTool('example_tool', {
        message: 'Hello from MCP client!'
      });
      console.log('Example tool result:', exampleResult);
    } catch (exampleError) {
      console.error('Error with example tool:', exampleError);
    }

  } catch (error) {
    console.error('Error in MCP example:', error);
  }
}

// Run the example
if (require.main === module) {
  runMcpExample().catch(console.error);
}

export { runMcpExample }; 