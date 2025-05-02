#!/usr/bin/env node

// This script runs the MCP client example

// First check if we're in development mode with TypeScript
try {
  // Try to require ts-node and register it for TypeScript support
  require('ts-node').register();
  console.log('Running with ts-node for TypeScript support');
  
  // Now require and run the TypeScript example
  const { runMcpExample } = require('./example.ts');
  runMcpExample().catch(error => {
    console.error('Error running MCP example:', error);
    process.exit(1);
  });
} catch (e) {
  // If ts-node isn't available, try to load the compiled JavaScript
  try {
    console.log('Running compiled JavaScript version');
    const { runMcpExample } = require('./example.js');
    runMcpExample().catch(error => {
      console.error('Error running MCP example:', error);
      process.exit(1);
    });
  } catch (jsError) {
    console.error('Failed to run example in either TypeScript or JavaScript mode:');
    console.error('Original error:', e);
    console.error('JavaScript load error:', jsError);
    console.error('\nMake sure you have either:');
    console.error('1. Installed ts-node for running TypeScript directly: npm install -g ts-node');
    console.error('2. Compiled the TypeScript to JavaScript: tsc');
    process.exit(1);
  }
} 