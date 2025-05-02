import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface McpClientOptions {
  baseUrl: string;
  clientName?: string;
  clientVersion?: string;
}

export interface McpSessionInfo {
  sessionId: string;
  expiresAt?: Date;
}

export interface McpToolSchema {
  type: string;
  properties: Record<string, {
    type: string;
    description: string;
  }>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
}

export interface McpToolsListResponse {
  tools: McpTool[];
}

interface McpJsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: {
    tools?: McpTool[];
    [key: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
  };
}

// Transport interfaces and classes

export interface ClientTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendRequest(method: string, params: any): Promise<any>;
  onNotification(callback: (method: string, params: any) => void): void;
  sessionId?: string;
}

export interface StreamableHTTPClientTransportOptions {
  requestOptions?: {
    headers?: Record<string, string>;
  };
  sessionId?: string;
  onSessionIdChanged?: (sessionId: string) => void;
  reconnectionOptions?: {
    initialReconnectionDelay: number;
    maxReconnectionDelay: number;
    reconnectionDelayGrowFactor: number;
    maxRetries: number;
  };
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: any;
}

interface JsonRpcResponseData {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

// For SSE responses that may be notifications instead of standard responses
interface JsonRpcNotification {
  jsonrpc: string;
  method: string;
  params: any;
}

export class StreamableHTTPClientTransport implements ClientTransport {
  private url: URL;
  private options: StreamableHTTPClientTransportOptions;
  private notificationCallbacks: ((method: string, params: any) => void)[] = [];
  sessionId?: string;
  private requestId = 0;

  constructor(url: URL, options: StreamableHTTPClientTransportOptions = {}) {
    this.url = url;
    this.options = options;
    this.sessionId = options.sessionId;
  }

  async connect(): Promise<void> {
    // In HTTP transport, connection is implicit with first request
    // We'll validate the connection with an initial ping if needed
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    // Clean up any resources
    return Promise.resolve();
  }

  async terminateSession(): Promise<void> {
    if (!this.sessionId) {
      return Promise.resolve();
    }

    try {
      await fetch(`${this.url.origin}/mcp/sessions/${this.sessionId}`, {
        method: 'DELETE',
        headers: {
          ...this.getHeaders(),
          'Mcp-Session-Id': this.sessionId
        }
      });
    } finally {
      this.sessionId = undefined;
    }
  }

  async sendRequest(method: string, params: any): Promise<any> {
    const id = `req-${++this.requestId}`;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const headers = this.getHeaders();
    
    // Don't include session ID for initialize requests
    if (this.sessionId && method !== 'initialize') {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    console.log('Sending request:', payload);
    const response = await fetch(this.url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    // Check for new session ID before consuming the body
    const responseSessionId = response.headers.get('Mcp-Session-Id');
    if (responseSessionId && responseSessionId !== this.sessionId) {
      this.sessionId = responseSessionId;
      if (this.options.onSessionIdChanged) {
        this.options.onSessionIdChanged(responseSessionId);
      }
    }

    // Get the response data before logging
    const responseData = await response.json() as JsonRpcResponseData;
    console.log('Response data:', responseData);
    


    if (!response.ok) {
      try {
        // Try to get more detailed error information from the response body
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status}: ${response.statusText}${errorText ? ` (${errorText})` : ''}`);
      } catch (err) {
        // If we can't get the response text, just use the status
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
    }

    if (responseData.error) {
      throw new Error(`RPC error ${responseData.error.code}: ${responseData.error.message}`);
    }

    // Handle array responses (needed for tools/list)
    if (Array.isArray(responseData) && responseData.length > 0) {
      if (responseData[0].error) {
        throw new Error(`RPC error ${responseData[0].error.code}: ${responseData[0].error.message}`);
      }
      
      // For tools/list, return the tools array directly
      if (method === 'tools/list' && responseData[0]?.result?.tools) {
        return responseData[0].result.tools;
      }
      
      // For other methods with array response, return the first result
      return responseData[0].result;
    }

    return responseData.result;
  }

  onNotification(callback: (method: string, params: any) => void): void {
    this.notificationCallbacks.push(callback);
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.options.requestOptions?.headers
    };
  }
}

export interface SSEClientTransportOptions {
  headers?: Record<string, string>;
  sessionId?: string;
}

// Extended EventSourceInit that includes headers for custom implementations
interface ExtendedEventSourceInit extends EventSourceInit {
  headers?: Record<string, string>;
}

export class SSEClientTransport implements ClientTransport {
  private url: URL;
  private options: SSEClientTransportOptions;
  private eventSource: EventSource | null = null;
  private notificationCallbacks: ((method: string, params: any) => void)[] = [];
  sessionId?: string;
  private connected = false;
  private connectionPromise: Promise<void> | null = null;
  private eventEmitter = new EventEmitter();

  constructor(url: URL, options: SSEClientTransportOptions = {}) {
    this.url = url;
    this.options = options;
    this.sessionId = options.sessionId;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      const urlWithParams = new URL(this.url.toString());
      urlWithParams.searchParams.append('transport', 'sse');
      
      if (this.sessionId) {
        urlWithParams.searchParams.append('sessionId', this.sessionId);
      }

      // Create EventSource options with headers
      const eventSourceInit: ExtendedEventSourceInit = {};
      if (this.options.headers) {
        eventSourceInit.headers = this.options.headers;
      }

      try {
        // @ts-ignore - EventSource in browser doesn't support headers, but some polyfills do
        this.eventSource = new EventSource(urlWithParams.toString(), eventSourceInit);
      } catch (error) {
        reject(new Error(`Failed to create EventSource: ${error}`));
        this.connectionPromise = null;
        return;
      }

      this.eventSource.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.eventSource.onerror = (error) => {
        if (!this.connected) {
          reject(new Error(`EventSource connection failed: ${error}`));
          this.connectionPromise = null;
        } else {
          console.error('SSE transport error:', error);
          this.eventEmitter.emit('error', error);
        }
      };

      this.eventSource.onmessage = (event) => {
        try {
          // Parse the incoming data - could be a notification or response
          const parsedData = JSON.parse(event.data);
          
          // Check if it's a notification (has method and params but no id)
          if (parsedData.method && parsedData.params) {
            const notification = parsedData as JsonRpcNotification;
            this.notificationCallbacks.forEach(callback => {
              try {
                callback(notification.method, notification.params);
              } catch (callbackError) {
                console.error('Error in notification callback:', callbackError);
              }
            });
          } 
          // Otherwise it's a response (has id)
          else if (parsedData.id) {
            const response = parsedData as JsonRpcResponseData;
            this.eventEmitter.emit(`response-${response.id}`, response);
          }
        } catch (parseError) {
          console.error('Error parsing SSE message:', parseError, event.data);
        }
      };
    });

    return this.connectionPromise;
  }

  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
    this.connectionPromise = null;
    return Promise.resolve();
  }

  async sendRequest(method: string, params: any): Promise<any> {
    await this.connect();

    const id = `sse-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const requestData: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    // For SSE, we send the request over a separate HTTP POST
    const response = await fetch(this.url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Don't include session ID for initialize requests
        ...(this.sessionId && method !== 'initialize' ? { 'Mcp-Session-Id': this.sessionId } : {}),
        ...this.options.headers
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const responseData = await response.json() as JsonRpcResponseData;
    if (responseData.error) {
      throw new Error(`RPC error ${responseData.error.code}: ${responseData.error.message}`);
    }

    return responseData.result;
  }

  onNotification(callback: (method: string, params: any) => void): void {
    this.notificationCallbacks.push(callback);
  }
}

// Client implementation
export interface ClientOptions {
  name: string;
  version: string;
}

type NotificationHandler = (params: any) => void | Promise<void>;
type NotificationSchema = {
  describe: (name: string) => any;
};

export class Client {
  private options: ClientOptions;
  private transport: ClientTransport | null = null;
  private notificationHandlers: Map<string, NotificationHandler[]> = new Map();
  private notificationSchemas: Map<string, any> = new Map();

  constructor(options: ClientOptions) {
    this.options = options;
  }

  async connect(transport: ClientTransport): Promise<void> {
    this.transport = transport;
    
    // Set up notification handling
    transport.onNotification((method, params) => {
      const handlers = this.notificationHandlers.get(method) || [];
      handlers.forEach(handler => {
        try {
          handler(params);
        } catch (error) {
          console.error(`Error in notification handler for ${method}:`, error);
        }
      });
    });
    
    await transport.connect();
    
    // Initialize the client with the server
    await this.initialize();
  }

  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
      this.transport = null;
    }
  }

  setNotificationHandler<T extends NotificationSchema>(
    schema: T,
    handler: (params: any) => void | Promise<void>
  ): void {
    // Extract method name from schema
    const methodName = schema.describe('');
    
    // Register the schema
    this.notificationSchemas.set(methodName, schema);
    
    // Register the handler
    if (!this.notificationHandlers.has(methodName)) {
      this.notificationHandlers.set(methodName, []);
    }
    this.notificationHandlers.get(methodName)!.push(handler);
  }

  async callMethod(method: string, params: any): Promise<any> {
    if (!this.transport) {
      throw new Error('Client not connected');
    }
    
    return this.transport.sendRequest(method, params);
  }

  async listTools(): Promise<any[]> {
    if (!this.transport) {
      throw new Error('Client not connected');
    }
    
    try {
      const tools = await this.transport.sendRequest('tools/list', {});
      // console.log('Tools received by listTools:', tools);
      return Array.isArray(tools) ? tools : [];
    } catch (error) {
      console.error('Failed to list tools:', error);
      return [];
    }
  }

  /**
   * Call a tool on the MCP server
   * @param params The tool call parameters
   * @returns The result of the tool call
   */
  async callTool(params: { name: string, arguments: any }): Promise<any> {
    if (!this.transport) {
      throw new Error('Client not connected');
    }
    
    try {
      return await this.transport.sendRequest('tools/call', params);
    } catch (error) {
      console.error(`Failed to call tool ${params.name}:`, error);
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }
    
    // Skip initialization if we already have a session ID
    if (this.transport.sessionId) {
      console.log(`[MCP Client] Skipping initialization as we already have session ID: ${this.transport.sessionId}`);
      
      // Even with existing session, we'll check tools to verify the session is valid
      try {
        const tools = await this.listTools();
        console.log(`[MCP Client] Verified session with ${tools.length} available tools`);
      } catch (error) {
        console.error('[MCP Client] Error verifying tools with existing session:', error);
        // Session might be invalid - clear it and reinitialize
        console.log('[MCP Client] Session appears invalid, reinitializing...');
        this.transport.sessionId = undefined;
        // Continue with initialization below
      }
      
      // If we still have a valid session ID, return early
      if (this.transport.sessionId) {
        return;
      }
    }
    
    try {
      // Initialize with proper protocol version
      const response = await this.transport.sendRequest('initialize', {
        clientInfo: {
          name: this.options.name,
          version: this.options.version
        },
        protocolVersion: "2024-11-05",
        capabilities: {
          sampling: {},
          roots: {
            listChanged: true
          }
        }
      });
      
      console.log('[MCP Client] Initialization successful:', response);
      
      // List tools after successful initialization
      try {
        const tools = await this.listTools();
        console.log(`[MCP Client] Server has ${tools.length} available tools`);
      } catch (toolsError) {
        console.warn('[MCP Client] Error listing tools after initialization:', toolsError);
        // Continue anyway - the connection is established
      }
    } catch (error) {
      console.error('[MCP Client] Error initializing:', error);
      throw error; // Rethrow to signal failed initialization
    }
  }
}

// Session management functionality
// Track active connections by user ID for cleanup
const activeConnections = new Map<string, { 
  client: Client, 
  transport: StreamableHTTPClientTransport | SSEClientTransport,
  sessionId?: string
}>();

/**
 * Creates a new MCP session with the server
 */
export async function createMcpSession(mcpUrl: string): Promise<string | undefined> {
  try {
    console.log(`[MCP Debug] Creating new MCP session`);
    
    // Generate a unique request ID for the initialization
    const requestId = uuidv4();

    // Try direct initialization without a session ID (the proper way)
    console.log(`[MCP Debug] Trying direct initialize request`);
    const initResponse = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {
            sampling: {},
            roots: {
              listChanged: true
            }
          },
          clientInfo: {
            name: "m365-client",
            version: "1.0.0"
          }
        }
      })
    });
    
    if (initResponse.ok) {
      // Get the session ID from the response headers
      const initSessionId = initResponse.headers.get('mcp-session-id') || initResponse.headers.get('Mcp-Session-Id');
      if (initSessionId) {
        console.log(`[MCP Debug] Initialization successful, received session ID: ${initSessionId}`);
        return initSessionId;
      }
    } else {
      console.log(`[MCP Debug] Direct initialize failed: ${await initResponse.text()}`);
    }
    
    // If direct initialize fails, try legacy approach
    // Generate a new session ID for older server versions that might need it
    const sessionId = uuidv4();
    console.log(`[MCP Debug] Trying legacy approaches with generated session ID: ${sessionId}`);
    
    // Make a direct HTTP request to the server to establish the session
    const response = await fetch(`${mcpUrl}/mcp/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId
      },
      body: JSON.stringify({ clientId: 'm365-client' })
    });
    
    if (!response.ok) {
      // If the /mcp/sessions endpoint doesn't exist, try alternative approaches
      if (response.status === 404) {
        console.log(`[MCP Debug] Session creation endpoint not found, trying direct CREATE request`);
        // Try a different approach - direct CREATE request
        const createResponse = await fetch(`${mcpUrl}/mcp`, {
          method: 'POST', 
          headers: {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': sessionId
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'session/create',
            params: { clientId: 'm365-client' }
          })
        });
        
        if (createResponse.ok) {
          console.log(`[MCP Debug] Successfully created session with ID: ${sessionId}`);
          return sessionId;
        } else {
          console.error(`[MCP Debug] Failed to create session with direct method: ${await createResponse.text()}`);
        }
      } else {
        console.error(`[MCP Debug] Failed to create session: ${await response.text()}`);
      }
      
      // No more fallback attempts - all standard approaches failed
      console.log(`[MCP Debug] All session creation methods failed`);
      return undefined;
    }
    
    // Check for session ID in response
    const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id');
    if (responseSessionId) {
      console.log(`[MCP Debug] Server provided session ID: ${responseSessionId}`);
      return responseSessionId;
    }
    
    console.log(`[MCP Debug] Using generated session ID: ${sessionId}`);
    return sessionId;
  } catch (error) {
    console.error(`[MCP Debug] Error creating session: ${error}`);
    return undefined;
  }
}

/**
 * Gets or creates an MCP client for a specific user
 */
export async function getOrCreateMcpClient(
  mcpUrl: string, 
  userId: string, 
  sessionId?: string, 
  accessToken?: string
) {
  console.log(`[MCP Debug] Attempting to get/create MCP client for user ${userId} ${sessionId ? `with session ${sessionId}` : 'with new session'}`);
  console.log(`[MCP Debug] Access token available: ${!!accessToken}`);
  
  // Check if there's already an active connection for this user
  if (activeConnections.has(userId)) {
    console.log(`[MCP Debug] Found existing connection for user ${userId}`);
    const existing = activeConnections.get(userId)!;
    
    // Verify the session is still valid
    if (existing.sessionId) {
      console.log(`[MCP Debug] Using existing session: ${existing.sessionId}`);
    } else {
      console.log(`[MCP Debug] Existing connection has no session ID`);
    }
    
    return existing;
  }

  console.log(`[MCP Debug] Creating new client connection for user ${userId}`);
  
  // Create a new client
  const client = new Client({
    name: 'm365-client',
    version: '1.0.0'
  });

  // Keep track of the provided sessionId for reconnection attempts
  let providedSessionId = sessionId;
  console.log(`[MCP Debug] Provided session ID: ${providedSessionId || 'none'}`);
  
  // If no session ID was provided, create a new one
  if (!providedSessionId) {
    providedSessionId = await createMcpSession(mcpUrl);
    console.log(`[MCP Debug] Created new session ID: ${providedSessionId || 'failed to create'}`);
  }
  
  try {
    // Create StreamableHTTP transport with proper implementation
    const mcpEndpointUrl = new URL('/mcp', mcpUrl);
    console.log(`[MCP Debug] Connecting to MCP URL: ${mcpEndpointUrl.toString()}`);
    
    // Configure the transport with headers for session management
    const transportOptions = {
      requestOptions: {
        headers: {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
        }
      },
      // Include sessionId if we have one
      ...(providedSessionId ? { sessionId: providedSessionId } : {}),
      onSessionIdChanged: (newSessionId: string) => {
        // Store the new session ID in case it was changed by the server
        console.log(`[MCP Debug] Received new MCP session ID: ${newSessionId}`);
        const connection = activeConnections.get(userId);
        if (connection) {
          connection.sessionId = newSessionId;
        }
      },
      reconnectionOptions: {
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 3
      }
    };

    console.log(`[MCP Debug] Creating StreamableHTTP transport with options:`, JSON.stringify({
      url: mcpEndpointUrl.toString(),
      headers: Object.keys(transportOptions.requestOptions.headers),
      sessionId: providedSessionId || undefined,
      reconnectionOptions: transportOptions.reconnectionOptions
    }));

    const transport = new StreamableHTTPClientTransport(mcpEndpointUrl, transportOptions);
    
    // Set up notification handlers for logging and resource changes
    console.log(`[MCP Debug] Setting up notification handlers`);
    setupNotificationHandlers(client);
    
    // Connect to the MCP server with StreamableHTTP
    console.log(`[MCP Debug] Attempting to connect with StreamableHTTP transport`);
    await client.connect(transport);
    
    // Verify session establishment
    if (!transport.sessionId) {
      console.warn(`[MCP Debug] No session ID obtained after connection`);
    } else {
      console.log(`[MCP Debug] Connected to M365 server using StreamableHTTP transport (sessionId: ${transport.sessionId})`);
    }
    
    // Store the connection for future use
    activeConnections.set(userId, { 
      client, 
      transport, 
      sessionId: transport.sessionId
    });
    
    return { client, transport, sessionId: transport.sessionId };
  } catch (error) {
    console.error(`[MCP Debug] StreamableHTTP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[MCP Debug] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    console.log(`[MCP Debug] Falling back to SSE transport`);
    
    // If StreamableHTTP fails, try SSE transport (legacy approach)
    try {
      const sseUrl = new URL(mcpUrl);
      console.log(`[MCP Debug] Creating SSE transport to ${sseUrl.toString()}`);
      const transport = new SSEClientTransport(sseUrl, {
        // Add authorization header for SSE transport if access token is provided
        headers: accessToken ? { 'Authorization': `Bearer ${accessToken}` } : undefined
      });
      
      // Connect to the MCP server with SSE
      console.log(`[MCP Debug] Attempting to connect with SSE transport`);
      await client.connect(transport);
      
      console.log(`[MCP Debug] Connected to M365 server using SSE transport (sessionId: ${providedSessionId || 'none'})`);
      
      // Store the connection for future use
      activeConnections.set(userId, { client, transport, sessionId: providedSessionId || 'none' });
      
      return { client, transport, sessionId: providedSessionId || 'none' };
    } catch (sseError) {
      console.error(`[MCP Debug] SSE connection failed: ${sseError instanceof Error ? sseError.message : String(sseError)}`);
      console.error(`[MCP Debug] SSE error stack: ${sseError instanceof Error ? sseError.stack : 'No stack trace'}`);
      console.error(`[MCP Debug] Failed to connect to MCP server with both transports`);
      throw sseError;
    }
  }
}

/**
 * Set up notification handlers for the MCP client
 */
function setupNotificationHandlers(client: Client) {
  // Set up handler for logging messages from the server
  client.setNotificationHandler(
    { describe: () => 'logging/message' },
    (notification) => {
      console.log(`[MCP Server Log] [${notification.level}] ${notification.message}`);
    }
  );
  
  // Set up handler for resource list changed notifications
  client.setNotificationHandler(
    { describe: () => 'resources/listChanged' },
    async (notification) => {
      console.log(`Resource list changed: ${notification.changedResources.join(', ')}`);
    }
  );
}

/**
 * Disconnects an MCP client for a specific user
 */
export async function disconnectMcpClient(userId: string): Promise<boolean> {
  const connection = activeConnections.get(userId);
  
  if (connection) {
    try {
      // Try to terminate the session first if the transport supports it
      if ('terminateSession' in connection.transport) {
        try {
          await (connection.transport as StreamableHTTPClientTransport).terminateSession();
        } catch (error: unknown) {
          const err = error as Error;
          console.log(`Session termination failed (this might be expected): ${err.message}`);
        }
      }
      
      // Close the client (which will handle transport disconnect internally)
      await connection.client.close();
      activeConnections.delete(userId);
      return true;
    } catch (error) {
      console.error(`Error disconnecting MCP client: ${error}`);
      // Remove from tracking even if disconnect fails
      activeConnections.delete(userId);
      return false;
    }
  }
  
  return false;
}

/**
 * Checks MCP server tools and returns available ones
 */
export async function checkMcpServerTools(mcpUrl: string): Promise<{ available: boolean, tools: string[], sessionId?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    console.log(`[MCP Debug] Checking MCP server tools`);
    
    try {
      // Create a new client
      const client = new Client({
        name: 'm365-client',
        version: '1.0.0'
      });
      
      // Get a session ID - try to reuse an existing one or create a new one
      let sessionId: string | undefined;
      
      // Get first active connection if any exists to reuse session
      if (activeConnections.size > 0) {
        const firstConnection = Array.from(activeConnections.values())[0];
        sessionId = firstConnection.sessionId;
        console.log(`[MCP Debug] Reusing existing session ID: ${sessionId}`);
      } 
      
      // If no existing session, create a new one
      if (!sessionId) {
        sessionId = await createMcpSession(mcpUrl);
        console.log(`[MCP Debug] Created new session ID: ${sessionId || 'none'}`);
      }
      
      // Create a transport to connect to the MCP server
      const mcpEndpointUrl = new URL('/mcp', mcpUrl);
      console.log(`[MCP Debug] Connecting to MCP URL: ${mcpEndpointUrl.toString()}`);
      
      // Set up transport with session ID
      const transportOptions = {
        requestOptions: {
          headers: {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json'
          }
        },
        // Include the session ID if we have one
        ...(sessionId ? { sessionId } : {}),
        onSessionIdChanged: (newSessionId: string) => {
          console.log(`[MCP Debug] Server assigned session ID: ${newSessionId}`);
          sessionId = newSessionId;
        },
        reconnectionOptions: {
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 10000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 1
        }
      };
      
      const transport = new StreamableHTTPClientTransport(mcpEndpointUrl, transportOptions);
      
      // Connect to the MCP server - this will perform the initialization
      // and the server will assign a sessionId during this process
      console.log(`[MCP Debug] Attempting to connect with transport, current session ID: ${transport.sessionId || 'none'}`);
      await client.connect(transport);
      
      // Check if we have a session ID after connection
      if (!transport.sessionId) {
        console.warn('[MCP Debug] Warning: No session ID received after connection');
      } else {
        console.log(`[MCP Debug] Connected with session ID: ${transport.sessionId}`);
        
        // Store this session for future use if not already stored
        if (activeConnections.size === 0 && transport.sessionId) {
          console.log('[MCP Debug] Storing session for future use with temporary user ID');
          activeConnections.set('mcp-check', { 
            client, 
            transport, 
            sessionId: transport.sessionId 
          });
        }
      }
      
      // List available tools
      console.log('[MCP Debug] Listing tools with session ID:', transport.sessionId);
      const tools = await client.listTools();
      
      // Close the connection only if we're not saving it
      if (!activeConnections.has('mcp-check')) {
        await client.close();
      }
      
      clearTimeout(timeoutId);
      
      console.log(`[MCP Debug] Server check successful, found ${tools.length} tools`);
      
      if (Array.isArray(tools)) {
        return { 
          available: true, 
          tools: tools.map((tool: any) => tool.name),
          sessionId: transport.sessionId
        };
      }
      
      return { available: true, tools: [], sessionId: transport.sessionId };
    } catch (innerError) {
      console.error(`[MCP Debug] Error checking MCP server tools: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
      console.error(`[MCP Debug] Error stack: ${innerError instanceof Error ? innerError.stack : 'No stack trace'}`);
      return { available: false, tools: [] };
    }
  } catch (error) {
    console.error(`[MCP Debug] Failed to check MCP server: ${error instanceof Error ? error.message : String(error)}`);
    return { available: false, tools: [] };
  }
}
