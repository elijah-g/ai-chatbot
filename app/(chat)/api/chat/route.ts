import {
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from 'ai';
import { getOrCreateMcpClient, disconnectMcpClient } from '@/lib/ai/mcp/client';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getStreamIdsByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId, geolocation } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';

// For type definitions
interface UIMessage {
  id: string;
  role: "user" | "system" | "assistant" | "data"; // Restrict role to valid values
  content: string;
  parts: any[];
  experimental_attachments?: any[];
}

type Chat = {
  id: string;
  userId: string;
  visibility: string;
};

// Define a createDataStreamResponse function using createDataStream
function createDataStreamResponse({ execute, onError }: { 
  execute: (dataStream: any) => Promise<void>,
  onError: (error: any) => string 
}) {
  const dataStream = createDataStream({ 
    execute: execute,
    onError: onError,
  });
  return new Response(dataStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    }
  });
}

// Helper function to get the most recent user message
function getMostRecentUserMessage(messages: UIMessage[]): UIMessage | undefined {
  if (!messages || !Array.isArray(messages)) {
    return undefined;
  }
  
  // If we have a single message (from the message field in the request)
  // and it's a user message, return it directly
  if (messages.length === 1 && messages[0].role === 'user') {
    return messages[0];
  }
  
  // Otherwise filter for user messages and get the last one
  return messages.filter(m => m.role === 'user').pop();
}

export const maxDuration = 60;

/**
 * Check if messages contain any problematic tool invocations
 */
function hasProblematicToolInvocations(messages: any[]): boolean {
  try {
    for (const message of messages) {
      if (!message?.parts || !Array.isArray(message.parts)) {
        continue;
      }

      const toolCalls = new Map<string, { hasCall: boolean; hasResult: boolean }>();
      
      // Track all tool calls and their states
      for (const part of message.parts) {
        if (part?.type === 'tool-invocation' && part.toolInvocation?.toolCallId) {
          const toolCallId = part.toolInvocation.toolCallId;
          const state = part.toolInvocation.state;
          
          if (!toolCalls.has(toolCallId)) {
            toolCalls.set(toolCallId, { hasCall: false, hasResult: false });
          }
          
          const toolCall = toolCalls.get(toolCallId)!;
          if (state === 'call') {
            toolCall.hasCall = true;
          } else if (state === 'result') {
            toolCall.hasResult = true;
          }
        }
      }
      
      // Check for incomplete tool calls
      for (const [toolCallId, { hasCall, hasResult }] of toolCalls) {
        if (hasCall && !hasResult) {
          console.log(`[DEBUG] Found problematic tool call: ${toolCallId}`);
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('[ERROR] Error checking for problematic tool invocations:', error);
    return false;
  }
}

/**
 * Clean up incomplete tool invocations from messages
 * This prevents the AI_MessageConversionError when tool calls don't have results
 */
function cleanupIncompleteToolInvocations(messages: any[]): any[] {
  try {
    return messages.map(message => {
      if (!message || !message.parts || !Array.isArray(message.parts)) {
        return message;
      }

      // Track tool call IDs that have results
      const toolCallsWithResults = new Set<string>();
      
      // First pass: find all tool calls that have results
      message.parts.forEach((part: any) => {
        if (part?.type === 'tool-invocation' && 
            part.toolInvocation?.state === 'result' && 
            part.toolInvocation?.toolCallId) {
          toolCallsWithResults.add(part.toolInvocation.toolCallId);
        }
      });

      // Second pass: filter out tool calls that don't have results
      const cleanedParts = message.parts.filter((part: any) => {
        if (part?.type === 'tool-invocation' && 
            part.toolInvocation?.state === 'call' && 
            part.toolInvocation?.toolCallId) {
          const hasResult = toolCallsWithResults.has(part.toolInvocation.toolCallId);
          if (!hasResult) {
            console.log(`[DEBUG] Removing incomplete tool call: ${part.toolInvocation.toolName || 'unknown'} (${part.toolInvocation.toolCallId})`);
            return false;
          }
        }
        return true;
      });

      return {
        ...message,
        parts: cleanedParts
      };
    });
  } catch (error) {
    console.error('[ERROR] Failed to cleanup incomplete tool invocations:', error);
    // Return original messages if cleanup fails
    return messages;
  }
}

/**
 * Convert MCP tool input schema to Zod schema
 */
function convertMcpSchemaToZod(inputSchema: any): z.ZodType<any> {
  console.log(`[DEBUG] Converting MCP schema to Zod:`, JSON.stringify(inputSchema, null, 2));
  
  if (!inputSchema || typeof inputSchema !== 'object') {
    console.log(`[DEBUG] No input schema or invalid type, using passthrough`);
    return z.object({}).passthrough();
  }

  if (inputSchema.type === 'object' && inputSchema.properties) {
    const zodObject: Record<string, z.ZodType<any>> = {};
    
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      const property = prop as any;
      
      switch (property.type) {
        case 'string':
          zodObject[key] = z.string();
          break;
        case 'number':
          zodObject[key] = z.number();
          break;
        case 'boolean':
          zodObject[key] = z.boolean();
          break;
        case 'array':
          zodObject[key] = z.array(z.any());
          break;
        default:
          zodObject[key] = z.any();
      }
      
      // Handle optional vs required fields
      if (!inputSchema.required || !inputSchema.required.includes(key)) {
        zodObject[key] = zodObject[key].optional();
      }
    }
    
    console.log(`[DEBUG] Created Zod schema with properties:`, Object.keys(zodObject));
    console.log(`[DEBUG] Required fields:`, inputSchema.required || []);
    return z.object(zodObject);
  }
  
  // Fallback to passthrough for unknown schemas
  console.log(`[DEBUG] Unknown schema structure, using passthrough`);
  return z.object({}).passthrough();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Log the raw structure of the body for debugging
    console.log('[DEBUG] Request body structure:', {
      hasId: !!body.id,
      hasMessages: !!body.messages,
      messagesIsArray: Array.isArray(body.messages),
      hasMessage: !!body.message,
      messageRole: body.message?.role,
      hasSelectedChatModel: !!body.selectedChatModel,
    });
    
    // Validate required fields
    if (!body || typeof body !== 'object') {
      console.error('Invalid request body:', body);
      return new Response('Invalid request body', { status: 400 });
    }
    
    const {
      id,
      messages: messagesArray,
      message,
      selectedChatModel,
    }: {
      id: string;
      messages?: Array<UIMessage>;
      message?: UIMessage;
      selectedChatModel: string;
    } = body;
    
    // Handle both formats - either messages array or single message
    let messages: Array<UIMessage> = [];
    if (messagesArray && Array.isArray(messagesArray)) {
      messages = messagesArray;
    } else if (message) {
      // If only a single message is provided, create a messages array with that message
      messages = [message];
    }
    
    // Ensure required fields exist
    if (!id || messages.length === 0 || !selectedChatModel) {
      console.error('Missing required fields in request:', { 
        id, 
        messagesLength: messages.length,
        hasValidMessage: messages.length > 0 ? messages[0].role !== undefined : false,
        selectedChatModel 
      });
      return new Response('Missing required fields', { status: 400 });
    }

    console.log('POST /api/chat received', { id, messages, selectedChatModel });

    const session = await auth();
    console.log('Session:', session);

    if (!session?.user?.id) {
      console.error('No session user id');
      return new Response('Unauthorized', { status: 401 });
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });
    console.log('Message count in last 24h:', messageCount);

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      console.error('User exceeded max messages per day');
      return new Response(
        'You have exceeded your maximum number of messages for the day! Please try again later.',
        {
          status: 429,
        },
      );
    }

    const userMessage = getMostRecentUserMessage(messages);
    console.log('Most recent user message:', userMessage);

    if (!userMessage) {
      console.error('No user message found in messages array of length:', messages?.length);
      return new Response('No user message found', { status: 400 });
    }

    const chat = await getChatById({ id });
    console.log('Chat from DB:', chat);

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message: userMessage,
      });
      console.log('Generated title for new chat:', title);
      await saveChat({ id, userId: session.user.id, title });
      console.log('Saved new chat');
    } else {
      if (chat.userId !== session.user.id) {
        console.error('Chat userId does not match session user id');
        return new Response('Forbidden', { status: 403 });
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    const formattedMessages = appendClientMessage({
      // Convert DBMessage[] to compatible format for appendClientMessage
      messages: previousMessages as any,
      message: userMessage,
    });

    // Clean up incomplete tool invocations to prevent AI_MessageConversionError
    console.log(`[DEBUG] Processing ${formattedMessages.length} messages for tool invocation cleanup`);
    
    // Check for problematic tool invocations before cleanup
    const hasProblems = hasProblematicToolInvocations(formattedMessages);
    if (hasProblems) {
      console.log(`[DEBUG] Found problematic tool invocations in messages, applying cleanup`);
    }
    
    const cleanedMessages = cleanupIncompleteToolInvocations(formattedMessages);
    console.log(`[DEBUG] Applied cleanup to ${formattedMessages.length} messages to remove incomplete tool invocations`);

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: userMessage.id,
          role: 'user',
          parts: userMessage.parts,
          attachments: userMessage.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });
    console.log('Saved user message');

    // Create a stream ID for this chat session if needed
    try {
      const streamIds = await getStreamIdsByChatId({ id });
      if (streamIds.length === 0) {
        console.log(`Creating a new stream ID for chat ${id}`);
        await createStreamId({ chatId: id });
      }
    } catch (error) {
      console.error('Error checking/creating stream ID:', error);
      // Continue processing even if stream ID creation fails
    }

    // Debug tool configuration for AI library
    const streamTextConfig = {
      model: myProvider.languageModel(selectedChatModel),
      // Use the base system prompt directly
      system: systemPrompt({ selectedChatModel, requestHints }), 
      messages: cleanedMessages,
      maxSteps: 10,
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_generateMessageId: generateUUID,
    };

    return createDataStreamResponse({
      execute: async (dataStream) => {
        let mcpConnection: { client: Client; sessionId?: string } | undefined; // To store the connection object
        const userId = session?.user?.id!; // Assuming session and user.id are validated before this point
        const accessToken = (session as any)?.user?.accessToken; // Optional access token

        try {
          const mcpServerUrl = process.env.MCP_SERVER_URL;
          console.log(`[DEBUG] MCP Server URL from env: ${mcpServerUrl}`);
          if (!mcpServerUrl) {
            console.error('[ERROR] MCP_SERVER_URL environment variable is not set.');
            throw new Error('MCP_SERVER_URL is not configured.');
          }

          console.log(`[DEBUG] Attempting to get or create MCP client for user ${userId}`);
          // TODO: For true multi-request session persistence, store and retrieve mcpConnection.sessionId
          mcpConnection = await getOrCreateMcpClient(mcpServerUrl, userId, undefined /* Pass stored sessionId here */, accessToken);
          
          if (!mcpConnection || !mcpConnection.client) {
            console.error('[ERROR] Failed to get or create MCP client.');
            throw new Error('Failed to establish MCP connection.');
          }
          const { client } = mcpConnection; // Use the client from the connection object
          console.log(`[DEBUG] MCP Client obtained. Session ID: ${mcpConnection.sessionId}`);

          // The explicit client.connect() is no longer needed as getOrCreateMcpClient handles it.
          // The explicit client.listTools() is also likely not needed here,
          // as initialize() within connect() should handle basic setup.
          // If serverTools are truly needed for constructing streamTextTools, call client.listTools() here.
          // For now, assuming tools are fetched if necessary or client is ready.

          console.log('[DEBUG] Listing tools from MCP server...');
          const serverToolsResponse = await client.listTools(); // Get the response object
          console.log('[DEBUG] Raw listTools response:', JSON.stringify(serverToolsResponse, null, 2));
          const serverTools = serverToolsResponse.tools || []; // Extract the tools array
          console.log(`[DEBUG] Received ${serverTools.length} tools from server.`);
          if (!Array.isArray(serverTools)) {
            console.warn('[WARN] serverTools is not an array. Proceeding without dynamic tools.');
          } else {
            console.log('[DEBUG] Tool names:', serverTools.map(tool => tool.name));
          }


          const streamTextTools: Record<string, any> = {};
          // Ensure serverTools is an array before iterating
          if (Array.isArray(serverTools)) {
            for (const toolDefinition of serverTools) {
              const toolName = toolDefinition.name;
              console.log(`[DEBUG] Processing tool: ${toolName}`);
              console.log(`[DEBUG] Tool input schema:`, JSON.stringify(toolDefinition.inputSchema, null, 2));
              streamTextTools[toolName] = {
                description: toolDefinition.description,
                parameters: convertMcpSchemaToZod(toolDefinition.inputSchema), 
                execute: async (args: any) => {
                  console.log(`[DEBUG] Executing tool '${toolName}' via MCP Client with args:`, args);
                  // Client is already obtained from mcpConnection
                  
                  if (!client) {
                     throw new Error("MCP Client is not available");
                  }
                  try {
                    const result = await client.callTool({
                      name: toolName,
                      arguments: args,
                    });
                    console.log(`[DEBUG] Tool '${toolName}' execution result:`, result);
                    return result.result ?? result; 
                  } catch (toolError) {
                    console.error(`[ERROR] Error executing tool '${toolName}':`, toolError);
                    throw toolError;
                  }
                },
              };
            }
          }
          console.log('[DEBUG] Finished building tools for streamText.');

          // Call streamText with the dynamically built tools
          const result = streamText({
            ...streamTextConfig,
            tools: streamTextTools,
            onFinish: async ({ response }) => {
              // Disconnect the MCP client when finished
              console.log('[DEBUG] Disconnecting MCP client in onFinish for user:', userId);
              if (mcpConnection) { // Check if connection was established
                 try {
                    await disconnectMcpClient(userId);
                    console.log('[DEBUG] MCP client disconnected successfully via disconnectMcpClient.');
                } catch (disconnectError) {
                    console.error('[ERROR] Error disconnecting MCP client via disconnectMcpClient:', disconnectError);
                }
              } else {
                console.log('[DEBUG] MCP connection was not established, skipping disconnect.');
              }

              if (session.user?.id) {
                try {
                  const assistantId = getTrailingMessageId({
                    messages: response.messages.filter(
                      (message) => message.role === 'assistant',
                    ),
                  });

                  if (!assistantId) {
                    throw new Error('No assistant message found!');
                  }

                  const [, assistantMessage] = appendResponseMessages({
                    messages: [userMessage],
                    responseMessages: response.messages,
                  });

                  await saveMessages({
                    messages: [
                      {
                        id: assistantId,
                        chatId: id,
                        role: assistantMessage.role,
                        parts: assistantMessage.parts,
                        attachments:
                          assistantMessage.experimental_attachments ?? [],
                        createdAt: new Date(),
                      },
                    ],
                  });
                  console.log('Saved assistant message');
                } catch (err) {
                  console.error('Failed to save chat', err);
                }
              }
            },
            experimental_telemetry: {
              isEnabled: isProductionEnvironment,
              functionId: 'stream-text',
            },
          });

          result.consumeStream();

          result.mergeIntoDataStream(dataStream, {
            sendReasoning: true,
          });
        } catch (mcpError) {
          console.error('[ERROR] Failed during MCP client setup, connection, or tool processing:', mcpError);
          // When execute fails, the error should propagate to createDataStream's onError
          // dataStream.error(mcpError instanceof Error ? mcpError.message : 'Failed during MCP setup');
          // dataStream.close();
          // Re-throw the error so the outer handler catches it
          

          // Disconnect the MCP client if it was initialized
          if (mcpConnection) { // Check if connection was established
            console.log('[DEBUG] Disconnecting MCP client due to error for user:', userId);
            try {
                 await disconnectMcpClient(userId);
                 console.log('[DEBUG] MCP client disconnected after error via disconnectMcpClient.');
            } catch (disconnectError) {
                console.error('[ERROR] Error disconnecting MCP client after error via disconnectMcpClient:', disconnectError);
            }
          }
          throw mcpError; 
        }
      },
      onError: (error) => {
        console.error('[DEBUG] Error in createDataStreamResponse (outer onError):', error);
        // Log the full error details including stack trace
        if (error instanceof Error) {
          console.error('[DEBUG] Error message:', error.message);
          console.error('[DEBUG] Error stack:', error.stack);
          
          // Handle specific AI_MessageConversionError for tool invocations
          if (error.message.includes('ToolInvocation must have a result')) {
            console.error('[ERROR] Tool invocation without result detected. This should have been cleaned up.');
            return 'There was an issue with a previous tool call. Please try starting a new conversation.';
          }
          
          // Provide better error messaging based on error type
          if (error.message.includes('bedrock') || error.message.includes('model')) {
            return 'There was an error with the AI service. Please try again later.';
          }
        } else {
          console.error('[DEBUG] Non-Error object thrown:', error);
        }
        return 'An error occurred while processing your request. Please try again.';
      },
    });
  } catch (error) {
    console.error('[DEBUG] POST /api/chat error (outer catch):', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error stack:', error.stack);
      
      // Provide better error messaging based on error type
      if (error.message.includes('bedrock') || error.message.includes('model')) {
        return new Response('There was an error with the AI service. Please try again later.', { status: 500 });
      }
    } else {
      console.error('[DEBUG] Non-Error object thrown:', error);
    }
    return new Response('An error occurred while processing your request. Please try again.', {
      status: 500,
    });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new Response('id is required', { status: 400 });
  }

  const session = await auth();

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let chat: Chat;

  try {
    chat = await getChatById({ id: chatId });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!chat) {
    return new Response('Not found', { status: 404 });
  }

  if (chat.visibility === 'private' && chat.userId !== session.user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  let streamIds = await getStreamIdsByChatId({ id: chatId });

  // If no streams exist for this chat, create one
  if (!streamIds.length) {
    console.log(`No stream IDs found for chat ${chatId}, creating a new one`);
    const newStreamId = await createStreamId({ chatId });
    streamIds = [newStreamId];
    console.log(`Created new stream ID ${newStreamId} for chat ${chatId}`);
  }

  const recentStreamId = streamIds.at(-1);

  if (!recentStreamId) {
    return new Response('No recent stream found', { status: 404 });
  }

  const emptyDataStream = createDataStream({
    execute: () => {},
  });

  return new Response(emptyDataStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    }
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    const deletedChat = await deleteChatById({ id });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
