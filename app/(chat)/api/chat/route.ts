import {
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from 'ai';
import { getOrCreateMcpClient, disconnectMcpClient, type McpTool, getProcessedTools, type ProcessedTool } from '@/lib/ai/mcp/client';
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
  getSystemPromptPreferences,
  messageExists,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId, geolocation } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { processToolCalls, APPROVAL } from './utils';
import { logger } from '@/lib/utils/logger';

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
          logger.log(`[DEBUG] Found problematic tool call: ${toolCallId}`);
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    logger.error('[ERROR] Error checking for problematic tool invocations:', error);
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
            logger.log(`[DEBUG] Removing incomplete tool call: ${part.toolInvocation.toolName || 'unknown'} (${part.toolInvocation.toolCallId})`);
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
    logger.error('[ERROR] Failed to cleanup incomplete tool invocations:', error);
    // Return original messages if cleanup fails
    return messages;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Log the raw structure of the body for debugging
    logger.log('[DEBUG] Request body structure:', {
      hasId: !!body.id,
      hasMessages: !!body.messages,
      messagesIsArray: Array.isArray(body.messages),
      hasMessage: !!body.message,
      messageRole: body.message?.role,
      hasSelectedChatModel: !!body.selectedChatModel,
    });
    
    // Validate required fields
    if (!body || typeof body !== 'object') {
      logger.error('Invalid request body:', body);
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
      logger.error('Missing required fields in request:', { 
        id, 
        messagesLength: messages.length,
        hasValidMessage: messages.length > 0 ? messages[0].role !== undefined : false,
        selectedChatModel 
      });
      return new Response('Missing required fields', { status: 400 });
    }

    logger.log('POST /api/chat received', { id, messages, selectedChatModel });

    const session = await auth();
    logger.log('Session:', session);

    if (!session?.user?.id) {
      logger.error('No session user id');
      return new Response('Unauthorized', { status: 401 });
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });
    logger.log('Message count in last 24h:', messageCount);

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      logger.error('User exceeded max messages per day');
      return new Response(
        'You have exceeded your maximum number of messages for the day! Please try again later.',
        {
          status: 429,
        },
      );
    }

    const userMessage = getMostRecentUserMessage(messages);
    logger.log('Most recent user message:', userMessage);

    // Check if this is an approval workflow (tool result processing)
    const isApprovalWorkflow = messages.some(msg => 
      msg.parts?.some((part: any) => 
        part.type === 'tool-invocation' && 
        part.toolInvocation?.state === 'result' &&
        (part.toolInvocation?.result === 'Yes, confirmed.' || part.toolInvocation?.result === 'No, denied.')
      )
    );

    if (!userMessage && !isApprovalWorkflow) {
      logger.error('No user message found in messages array of length:', messages?.length);
      return new Response('No user message found', { status: 400 });
    }

    const chat = await getChatById({ id });
    logger.log('Chat from DB:', chat);

    if (!chat) {
      // Only create a new chat if we have a user message (not in approval workflow)
      if (userMessage) {
        const title = await generateTitleFromUserMessage({
          message: userMessage,
        });
        logger.log('Generated title for new chat:', title);
        await saveChat({ id, userId: session.user.id, title });
        logger.log('Saved new chat');
      }
    } else {
      if (chat.userId !== session.user.id) {
        logger.error('Chat userId does not match session user id');
        return new Response('Forbidden', { status: 403 });
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    // Handle message formatting differently for approval workflow vs new user messages
    let formattedMessages: any[];
    if (isApprovalWorkflow) {
      // For approval workflow, use the messages as-is since they contain the tool results
      formattedMessages = messages as any[];
      logger.log('[DEBUG] Using approval workflow messages directly');
    } else if (userMessage) {
      // For new user messages, append to previous messages
      formattedMessages = appendClientMessage({
        // Convert DBMessage[] to compatible format for appendClientMessage
        messages: previousMessages as any,
        message: userMessage,
      });
    } else {
      // This shouldn't happen due to our earlier check, but handle it gracefully
      logger.error('No user message and not approval workflow');
      return new Response('Invalid message state', { status: 400 });
    }

    // Clean up incomplete tool invocations to prevent AI_MessageConversionError
    logger.log(`[DEBUG] Processing ${formattedMessages.length} messages for tool invocation cleanup`);
    
    // Check for problematic tool invocations before cleanup
    const hasProblems = hasProblematicToolInvocations(formattedMessages);
    if (hasProblems) {
      logger.log(`[DEBUG] Found problematic tool invocations in messages, applying cleanup`);
    }
    
    const cleanedMessages = cleanupIncompleteToolInvocations(formattedMessages);
    logger.log(`[DEBUG] Applied cleanup to ${formattedMessages.length} messages to remove incomplete tool invocations`);

    // Process tool calls for approval workflow if needed
    let processedMessages = cleanedMessages;
    if (isApprovalWorkflow) {
      logger.log('[DEBUG] Processing approval workflow tool calls');
      // We'll handle this in the streamText execution since we need the dataStream
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // Fetch user system prompt preferences
    let userPreferences = null;
    try {
      if (session?.user?.id) {
        userPreferences = await getSystemPromptPreferences({ userId: session.user.id });
      }
    } catch (error) {
      logger.error('Failed to fetch user system prompt preferences:', error);
      // Continue without preferences if fetch fails
    }

    // Save user message, handling duplicate IDs gracefully
    // Skip saving for approval workflows since no new user message is being added
    if (userMessage && !isApprovalWorkflow) {
      try {
        // First check if the message already exists to avoid unnecessary database operations
        const messageAlreadyExists = await messageExists({ id: userMessage.id });
        
        if (messageAlreadyExists) {
          logger.log(`[DEBUG] Message ${userMessage.id} already exists in database, skipping save`);
        } else {
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
          logger.log('Saved user message');
        }
      } catch (error: any) {
        // Handle duplicate key violation as fallback (message already exists)
        if (error?.code === '23505' && error?.details?.includes('already exists')) {
          logger.log(`[DEBUG] Message ${userMessage.id} already exists in database (caught in fallback), skipping save`);
        } else {
          logger.error('Failed to save user message:', error);
          throw error; // Re-throw other errors
        }
      }
    } else if (isApprovalWorkflow) {
      logger.log('[DEBUG] Skipping user message save for approval workflow');
    }

    // Create a stream ID for this chat session if needed
    try {
      const streamIds = await getStreamIdsByChatId({ id });
      if (streamIds.length === 0) {
        logger.log(`Creating a new stream ID for chat ${id}`);
        await createStreamId({ chatId: id });
      }
    } catch (error) {
      logger.error('Error checking/creating stream ID:', error);
      // Continue processing even if stream ID creation fails
    }

    // Debug tool configuration for AI library
    const streamTextConfig = {
      model: myProvider.languageModel(selectedChatModel),
      // Use the system prompt with user preferences
      system: systemPrompt({ selectedChatModel, requestHints, userPreferences }), 
      messages: processedMessages,
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
          logger.log(`[DEBUG] MCP Server URL from env: ${mcpServerUrl}`);
          if (!mcpServerUrl) {
            logger.error('[ERROR] MCP_SERVER_URL environment variable is not set.');
            throw new Error('MCP_SERVER_URL is not configured.');
          }

          logger.log(`[DEBUG] Attempting to get or create MCP client for user ${userId}`);
          // TODO: For true multi-request session persistence, store and retrieve mcpConnection.sessionId
          mcpConnection = await getOrCreateMcpClient(mcpServerUrl, userId, undefined /* Pass stored sessionId here */, accessToken);
          
          if (!mcpConnection || !mcpConnection.client) {
            logger.error('[ERROR] Failed to get or create MCP client.');
            throw new Error('Failed to establish MCP connection.');
          }
          const { client } = mcpConnection; // Use the client from the connection object
          logger.log(`[DEBUG] MCP Client obtained. Session ID: ${mcpConnection.sessionId}`);

          // The explicit client.connect() is no longer needed as getOrCreateMcpClient handles it.
          // The explicit client.listTools() is also likely not needed here,
          // as initialize() within connect() should handle basic setup.
          // If serverTools are truly needed for constructing streamTextTools, call client.listTools() here.
          // For now, assuming tools are fetched if necessary or client is ready.

          logger.log('[DEBUG] Getting processed tools from cache...');
          const processedTools = await getProcessedTools(userId, client);
          logger.log(`[DEBUG] Received ${processedTools.length} processed tools.`);

          // Create a map of tools for easy lookup
          const mcpToolsMap: Record<string, any> = {};
          processedTools.forEach(tool => {
            mcpToolsMap[tool.name] = tool.originalTool;
          });

          // Process tool calls for human-in-the-loop approval
          const finalProcessedMessages = await processToolCalls(
            {
              messages: processedMessages,
              dataStream,
              tools: mcpToolsMap,
            },
            // Execute functions for destructive tools that require approval
            Object.fromEntries(
              processedTools
                .filter(tool => tool.isDestructive)
                .map(tool => [
                  tool.name,
                  async (args: any) => {
                    logger.log(`[DEBUG] Executing approved destructive tool '${tool.name}' with args:`, args);
                    try {
                      const result = await client.callTool({
                        name: tool.name,
                        arguments: args,
                      });
                      logger.log(`[DEBUG] Destructive tool '${tool.name}' execution result:`, result);
                      return result.result ?? result;
                    } catch (toolError) {
                      logger.error(`[ERROR] Error executing destructive tool '${tool.name}':`, toolError);
                      throw toolError;
                    }
                  }
                ])
            )
          );

          const streamTextTools: Record<string, any> = {};
          // Build tools for streamText using processed tools
          for (const processedTool of processedTools) {
            const toolName = processedTool.name;
            const isDestructive = processedTool.isDestructive;
            
            logger.log(`[DEBUG] Processing tool: ${toolName} (destructive: ${isDestructive})`);
            
            streamTextTools[toolName] = {
              description: processedTool.description,
              parameters: processedTool.zodSchema,
              // Only add execute function for non-destructive tools
              ...(isDestructive ? {} : {
                execute: async (args: any) => {
                  logger.log(`[DEBUG] Executing non-destructive tool '${toolName}' via MCP Client with args:`, args);
                  
                  if (!client) {
                     throw new Error("MCP Client is not available");
                  }
                  try {
                    const result = await client.callTool({
                      name: toolName,
                      arguments: args,
                    });
                    logger.log(`[DEBUG] Tool '${toolName}' execution result:`, result);
                    return result.result ?? result; 
                  } catch (toolError) {
                    logger.error(`[ERROR] Error executing tool '${toolName}':`, toolError);
                    throw toolError;
                  }
                },
              })
            };
          }
          logger.log('[DEBUG] Finished building tools for streamText.');

          // Call streamText with the dynamically built tools and processed messages
          const result = streamText({
            ...streamTextConfig,
            messages: finalProcessedMessages,
            tools: streamTextTools,
            onFinish: async (response) => {
              // Save assistant messages for both regular and approval workflows
              // This ensures that pending tool calls are persisted and survive page reloads
              if (session?.user?.id) {
                try {
                  logger.log('[DEBUG] Saving assistant message');
                  
                  // Build the parts array for the assistant message
                  const parts: any[] = [];
                  
                  // Add text content if available
                  if (response.text) {
                    parts.push({ type: 'text', text: response.text });
                  }
                  
                  // Add tool calls if available
                  if (response.toolCalls && response.toolCalls.length > 0) {
                    for (const toolCall of response.toolCalls) {
                      parts.push({
                        type: 'tool-invocation',
                        toolInvocation: {
                          state: 'call',
                          toolCallId: toolCall.toolCallId,
                          toolName: toolCall.toolName,
                          args: toolCall.args,
                        },
                      });
                    }
                  }
                  
                  // Add tool results if available
                  if (response.toolResults && response.toolResults.length > 0) {
                    for (const toolResult of response.toolResults) {
                      parts.push({
                        type: 'tool-invocation',
                        toolInvocation: {
                          state: 'result',
                          toolCallId: toolResult.toolCallId,
                          toolName: toolResult.toolName,
                          args: toolResult.args,
                          result: toolResult.result,
                        },
                      });
                    }
                  }
                  
                  // Only save if we have content to save
                  if (parts.length > 0) {
                    const assistantMessage = {
                      id: generateUUID(),
                      chatId: id,
                      role: 'assistant' as const,
                      parts: parts,
                      attachments: [],
                      createdAt: new Date(),
                    };

                    // Save the assistant message to the database
                    await saveMessages({
                      messages: [assistantMessage],
                    });
                    
                    logger.log('[DEBUG] Assistant message saved successfully with', parts.length, 'parts');
                  }
                } catch (err) {
                  logger.error('Failed to save assistant message:', err);
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
          logger.error('[ERROR] Failed during MCP client setup, connection, or tool processing:', mcpError);
          // When execute fails, the error should propagate to createDataStream's onError
          // dataStream.error(mcpError instanceof Error ? mcpError.message : 'Failed during MCP setup');
          // dataStream.close();
          // Re-throw the error so the outer handler catches it
          

          // Disconnect the MCP client if it was initialized
          if (mcpConnection) { // Check if connection was established
            logger.log('[DEBUG] Disconnecting MCP client due to error for user:', userId);
            try {
                 await disconnectMcpClient(userId);
                 logger.log('[DEBUG] MCP client disconnected after error via disconnectMcpClient.');
            } catch (disconnectError) {
                logger.error('[ERROR] Error disconnecting MCP client after error via disconnectMcpClient:', disconnectError);
            }
          }
          throw mcpError; 
        }
      },
      onError: (error) => {
        logger.error('[DEBUG] Error in createDataStreamResponse (outer onError):', error);
        // Log the full error details including stack trace
        if (error instanceof Error) {
          logger.error('[DEBUG] Error message:', error.message);
          logger.error('[DEBUG] Error stack:', error.stack);
          
          // Handle specific AI_MessageConversionError for tool invocations
          if (error.message.includes('ToolInvocation must have a result')) {
            logger.error('[ERROR] Tool invocation without result detected. This should have been cleaned up.');
            return 'There was an issue with a previous tool call. Please try starting a new conversation.';
          }
          
          // Provide better error messaging based on error type
          if (error.message.includes('bedrock') || error.message.includes('model')) {
            return 'There was an error with the AI service. Please try again later.';
          }
        } else {
          logger.error('[DEBUG] Non-Error object thrown:', error);
        }
        return 'An error occurred while processing your request. Please try again.';
      },
    });
  } catch (error) {
    logger.error('[DEBUG] POST /api/chat error (outer catch):', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      logger.error('[DEBUG] Error message:', error.message);
      logger.error('[DEBUG] Error stack:', error.stack);
      
      // Provide better error messaging based on error type
      if (error.message.includes('bedrock') || error.message.includes('model')) {
        return new Response('There was an error with the AI service. Please try again later.', { status: 500 });
      }
    } else {
      logger.error('[DEBUG] Non-Error object thrown:', error);
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
    logger.log(`No stream IDs found for chat ${chatId}, creating a new one`);
    const newStreamId = await createStreamId({ chatId });
    streamIds = [newStreamId];
    logger.log(`Created new stream ID ${newStreamId} for chat ${chatId}`);
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
    logger.error(error);
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
