#!/usr/bin/env node

// This script runs the MCP client example

// Add timestamp utility function
const formatTimestamp = () => {
  return new Date().toISOString();
};

const timestampedLog = (...args) => {
  console.log(`[${formatTimestamp()}]`, ...args);
};

const timestampedError = (...args) => {
  console.error(`[${formatTimestamp()}]`, ...args);
};

// First check if we're in development mode with TypeScript
try {
  // Try to require ts-node and register it for TypeScript support
  require('ts-node').register();
  timestampedLog('Running with ts-node for TypeScript support');
  
  // Now require and run the TypeScript example
  const { runMcpExample } = require('./example.ts');
  runMcpExample().catch(error => {
    timestampedError('Error running MCP example:', error);
    process.exit(1);
  });
} catch (e) {
  // If ts-node isn't available, try to load the compiled JavaScript
  try {
    timestampedLog('Running compiled JavaScript version');
    const { runMcpExample } = require('./example.js');
    runMcpExample().catch(error => {
      timestampedError('Error running MCP example:', error);
      process.exit(1);
    });
  } catch (jsError) {
    timestampedError('Failed to run example in either TypeScript or JavaScript mode:');
    timestampedError('Original error:', e);
    timestampedError('JavaScript load error:', jsError);
    timestampedError('\nMake sure you have either:');
    timestampedError('1. Installed ts-node for running TypeScript directly: npm install -g ts-node');
    timestampedError('2. Compiled the TypeScript to JavaScript: tsc');
    process.exit(1);
  }
} 