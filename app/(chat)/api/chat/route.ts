import {
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from 'ai';
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
import { getOrCreateMcpClient, disconnectMcpClient, checkMcpServerTools } from '../m365/client';

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
  execute: (dataStream: any) => void, 
  onError: (error: any) => string 
}) {
  const dataStream = createDataStream({ execute });
  return new Response(dataStream, { status: 200 });
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

// MS 365 MCP server URL - ensure URL has proper scheme
let MS365_MCP_URL = process.env.MCP_SERVER_URL || process.env.MS365_MCP_URL || process.env.NEXT_PUBLIC_MS365_MCP_URL || 'http://localhost:8080';
// Ensure URL has proper scheme
if (!MS365_MCP_URL.match(/^https?:\/\//i)) {
  MS365_MCP_URL = `http://${MS365_MCP_URL}`;
}
console.log('[MCP Debug] Using MS365 MCP server URL:', MS365_MCP_URL);

export const maxDuration = 60;

/**
 * Get available tools from MCP server
 */
async function getAvailableMcpTools() {
  try {
    console.log('[MCP DEBUG] Starting getAvailableMcpTools function');
    console.log('[MCP DEBUG] MCP server URL:', MS365_MCP_URL);
    
    // Check the MCP server and get tools directly
    console.log('[MCP DEBUG] About to call checkMcpServerTools');
    const serverToolsResult = await checkMcpServerTools();
    console.log('[MCP DEBUG] checkMcpServerTools result:', JSON.stringify(serverToolsResult));
    
    const { available, tools } = serverToolsResult;
    
    if (available && Array.isArray(tools)) {
      console.log('[MCP DEBUG] MCP server available with tools:', tools);
      return tools;
    }
    
    console.log('[MCP DEBUG] MCP server not available or no tools found', {
      available,
      toolsIsArray: Array.isArray(tools),
      toolsLength: Array.isArray(tools) ? tools.length : 'N/A'
    });
    return [];
  } catch (error) {
    console.error('[MCP DEBUG] Error in getAvailableMcpTools:', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      console.error('[MCP DEBUG] Error message:', error.message);
      console.error('[MCP DEBUG] Error stack:', error.stack);
    } else {
      console.error('[MCP DEBUG] Non-Error object thrown:', error);
    }
    return [];
  }
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

    // Get available tools from MCP server
    const activeTools = selectedChatModel === 'chat-model-reasoning'
      ? []
      : await getAvailableMcpTools();
    
    // Filter out login-related tools as they're not needed - the user is already authenticated
    const filteredActiveTools = activeTools.filter(tool => 
      !tool.includes('login') && !tool.includes('verify-login')
    );
    
    console.log('[MCP DEBUG] Original active tools:', activeTools);
    console.log('[MCP DEBUG] Filtered active tools (removed login tools):', filteredActiveTools);
    console.log('[MCP DEBUG] Selected chat model:', selectedChatModel);

    // Create an enhanced system prompt that mentions available tools
    function getEnhancedSystemPrompt(basePrompt: string, toolNames: string[]): string {
      if (!toolNames || toolNames.length === 0) {
        return basePrompt;
      }
      
      const toolsPrompt = `
You have access to the following Microsoft 365 tools that you can use:
${toolNames.map(tool => `- ${tool}: Use this to interact with Microsoft 365`).join('\n')}

IMPORTANT: The user is ALREADY AUTHENTICATED with Microsoft 365. DO NOT attempt to verify login status or authenticate the user. 
The authentication token is automatically passed with each tool call. Assume the user is logged in and proceed directly to accessing their data.

TOOL RESPONSE HANDLING INSTRUCTIONS:
1. When you call a tool, you'll receive a response containing the data requested.
2. ALWAYS examine the tool response carefully to understand its structure and extract relevant information.
3. If the response is complex or contains multiple items, summarize the content in a user-friendly way.
4. If needed, make follow-up tool calls to get more details about specific items from the initial response.
5. Present the final information in a clear, conversational manner.

MULTI-STEP WORKFLOWS:
- For complex tasks, break them down into sequential tool calls.
- After each tool call, analyze the response and determine the next step.
- Continue until you have all information needed to fully answer the user's request.
- Maintain the conversational flow while executing multiple steps.

When a user asks about their emails, calendar, or other Microsoft 365 data, use the appropriate tool DIRECTLY to help them 
without first checking login status.

Examples:
- If user asks "Show me my recent emails" → Use mcp_ms365_list-mail-messages directly, then extract and display sender, subject, and date for each email
- If user asks "What's on my calendar today" → Use mcp_ms365_list-calendar-events directly, then format each event with time, title, and attendees
- If user asks "Get my last email" → Use mcp_ms365_list-mail-messages with {top: 1}, then use mcp_ms365_get-mail-message to get full details if needed
`;
      
      return `${basePrompt}\n\n${toolsPrompt}`;
    }

    // This function transforms MCP tools into a format compatible with the AI library
    function formatToolsForAI(toolNames: string[]): any[] {
      if (!toolNames || !Array.isArray(toolNames) || toolNames.length === 0) {
        console.log('[MCP DEBUG] No tools to format for AI, returning empty array');
        return [];
      }
      
      const formattedTools = toolNames.map((toolName: string) => {
        // Create a more detailed schema based on the tool name
        let parameters = {
          type: "object",
          properties: {
            arguments: {
              type: "object",
              additionalProperties: true
            }
          },
          required: ["arguments"]
        };
        
        // Add more specific descriptions for known tools
        let description = `Call the ${toolName} tool`;
        
        if (toolName.includes('ms365')) {
          // Provide more detailed descriptions for MS365 tools
          if (toolName.includes('mail')) {
            description = `Call Microsoft 365 tool to access or manage user's emails`;
          } else if (toolName.includes('calendar')) {
            description = `Call Microsoft 365 tool to access or manage user's calendar events`;
          } else if (toolName.includes('login')) {
            description = `Authentication with Microsoft 365 (NOTE: User is already authenticated, use other tools directly)`;
          } else if (toolName.includes('verify-login')) {
            description = `Check login status with Microsoft 365 (NOTE: User is already authenticated, use other tools directly)`;
          }
        }
        
        const toolObj = {
          type: "function",
          function: {
            name: toolName,
            description: description,
            parameters: parameters
          }
        };
        
        // console.log(`[MCP DEBUG] Formatted tool for AI: ${toolName}`, JSON.stringify(toolObj));
        return toolObj;
      });
      
      console.log(`[MCP DEBUG] Total formatted tools: ${formattedTools.length}`);
      return formattedTools;
    }

    // Log the experimental_activeTools to verify they're properly configured
    const formattedActiveTools = formatToolsForAI(filteredActiveTools);
    console.log(`[MCP DEBUG] Formatted active tools length: ${formattedActiveTools.length}`);
    
    // Debug tool configuration for AI library
    const streamTextConfig = {
      model: myProvider.languageModel(selectedChatModel),
      system: getEnhancedSystemPrompt(systemPrompt({ selectedChatModel, requestHints }), filteredActiveTools),
      messages: formattedMessages,
      maxSteps: 10,
      experimental_activeTools: formattedActiveTools,
      experimental_transform: smoothStream({ chunking: 'word' }),
      experimental_generateMessageId: generateUUID,
    };
    
    console.log('[MCP DEBUG] StreamText configuration:', {
      modelName: selectedChatModel,
      hasSystem: !!streamTextConfig.system,
      messageCount: streamTextConfig.messages.length,
      maxSteps: streamTextConfig.maxSteps,
      activeToolsCount: streamTextConfig.experimental_activeTools.length,
      systemPromptPreview: streamTextConfig.system.substring(0, 100) + '...',
    });
    
    // Create tool implementations map
    const toolImplementations = filteredActiveTools.reduce((acc: Record<string, any>, toolName: string) => {
      // Create a tool function for each M365 tool that uses the MCP server
      console.log(`[MCP DEBUG] Setting up tool implementation for: ${toolName}`);
      
      acc[toolName] = async (params: any) => {
        console.log(`[MCP DEBUG] Tool '${toolName}' was called with params:`, JSON.stringify(params));
        try {
          console.log(`[MCP DEBUG] Invoking M365 tool: ${toolName} with params:`, JSON.stringify(params));
          
          // Use our MCP client instead of direct HTTP requests
          // Generate a unique server-side client ID for anonymous tool calls from the AI
          const serverClientId = `server_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          console.log(`[MCP DEBUG] Generated serverClientId: ${serverClientId}`);
          
          // Get access token from session if available
          const accessToken = session.user.type === 'azuread' ? session.user.accessToken : undefined;
          console.log(`[MCP DEBUG] Session user type: ${session.user.type}, accessToken available: ${!!accessToken}`);
          
          if (!accessToken) {
            console.log(`[MCP DEBUG] WARNING: No access token available for user type ${session.user.type}`);
            if (toolName.includes('login') || toolName.includes('verify-login')) {
              console.log(`[MCP DEBUG] Login/verification tool called, but access token should be used automatically`);
            }
          } else {
            console.log(`[MCP DEBUG] Access token available and will be used for authentication`);
          }
          
          console.log(`[MCP DEBUG] About to call getOrCreateMcpClient with serverClientId: ${serverClientId}`);
          
          let mcpClientResult;
          try {
            mcpClientResult = await getOrCreateMcpClient(serverClientId, undefined, accessToken);
            console.log(`[MCP DEBUG] getOrCreateMcpClient result:`, JSON.stringify({
              clientAvailable: !!mcpClientResult?.client,
              sessionId: mcpClientResult?.sessionId,
              accessTokenUsed: !!accessToken
            }));
          } catch (clientErr: any) {
            console.error(`[MCP DEBUG] Error creating MCP client: ${clientErr.message}`);
            console.error(`[MCP DEBUG] Client error stack: ${clientErr.stack || 'No stack available'}`);
            throw new Error(`Failed to initialize MCP client: ${clientErr.message}`);
          }
          
          if (!mcpClientResult?.client) {
            throw new Error(`MCP client creation failed - no client returned`);
          }
          
          const { client } = mcpClientResult;
          
          try {
            // Call the tool using the proper callTool method
            console.log(`[DEBUG] About to call client.callTool for ${toolName}`);
            const result = await client.callTool({
              name: toolName,
              arguments: params || {}
            });
            
            // Enhanced logging for tool responses
            console.log(`[MCP DEBUG] Tool ${toolName} execution successful`);
            try {
              // Try to log a summary of the tool response
              if (result && typeof result === 'object') {
                if (Array.isArray(result)) {
                  console.log(`[MCP DEBUG] Tool response is an array with ${result.length} items`);
                  if (result.length > 0 && typeof result[0] === 'object') {
                    console.log(`[MCP DEBUG] First item keys: ${Object.keys(result[0]).join(', ')}`);
                  }
                } else {
                  console.log(`[MCP DEBUG] Tool response keys: ${Object.keys(result).join(', ')}`);
                }
              } else {
                console.log(`[MCP DEBUG] Tool response type: ${typeof result}`);
              }
            } catch (err: any) {
              console.log(`[MCP DEBUG] Error summarizing tool response: ${err.message}`);
            }
            
            // Return the result
            return result;
          } finally {
            // Clean up the client connection when done
            console.log(`[DEBUG] Cleaning up client connection for ${serverClientId}`);
            await disconnectMcpClient(serverClientId).catch(err => {
              console.warn(`[DEBUG] Error disconnecting MCP client: ${err.message}`);
            });
          }
        } catch (error: any) {
          console.error(`[DEBUG] Error executing M365 tool ${toolName}:`, error);
          if (error instanceof Error) {
            console.error(`[DEBUG] Error message: ${error.message}`);
            console.error(`[DEBUG] Error stack: ${error.stack}`);
          } else {
            console.error(`[DEBUG] Non-Error object thrown:`, error);
          }
          return { error: `Failed to execute M365 tool: ${error.message}` };
        }
      };
      return acc;
    }, {});

    return createDataStreamResponse({
      execute: (dataStream) => {
        // Debug the full tools configuration
        console.log('[MCP DEBUG] Final streamText tool configuration:', {
          activeToolsCount: streamTextConfig.experimental_activeTools.length,
          implementationsCount: Object.keys(toolImplementations).length,
          toolNames: Object.keys(toolImplementations),
        });
        
        const result = streamText({
          ...streamTextConfig,
          tools: toolImplementations,
          toolChoice: "auto",
          onFinish: async ({ response }) => {
            // Debug any reasoning or tool calls that were made during generation
            if ((response as any).reasoning) {
              console.log('[MCP DEBUG] Response included reasoning:', (response as any).reasoning);
            }
            
            if ((response as any).toolCalls && (response as any).toolCalls.length > 0) {
              console.log('[MCP DEBUG] Response included tool calls:', JSON.stringify((response as any).toolCalls));
              console.log('[MCP DEBUG] Detected tool calls for tools:', (response as any).toolCalls.map((tc: any) => tc.name).join(', '));
            } else {
              console.log('[MCP DEBUG] No tool calls were made in this response');
              console.log('[MCP DEBUG] Available tools were:', filteredActiveTools.join(', '));
              console.log('[MCP DEBUG] The selected model was:', selectedChatModel);
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
      },
      onError: (error) => {
        console.error('[DEBUG] Error in createDataStreamResponse:', error);
        // Log the full error details including stack trace
        if (error instanceof Error) {
          console.error('[DEBUG] Error message:', error.message);
          console.error('[DEBUG] Error stack:', error.stack);
          
          // Provide better error messaging based on error type
          if (error.message.includes('MCP') || error.message.includes('tool')) {
            return 'There was an error connecting to Microsoft 365. Please make sure you are logged in and try again.';
          } else if (error.message.includes('bedrock') || error.message.includes('model')) {
            return 'There was an error with the AI service. Please try again later.';
          }
        } else {
          console.error('[DEBUG] Non-Error object thrown:', error);
        }
        return 'An error occurred while processing your request. Please try again.';
      },
    });
  } catch (error) {
    console.error('[DEBUG] POST /api/chat error:', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error stack:', error.stack);
      
      // Provide better error messaging based on error type
      if (error.message.includes('MCP') || error.message.includes('tool')) {
        return new Response('There was an error connecting to Microsoft 365. Please make sure you are logged in and try again.', { status: 500 });
      } else if (error.message.includes('bedrock') || error.message.includes('model')) {
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
