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
    
    console.log('[MCP DEBUG] Active tools for this chat:', activeTools);
    console.log('[MCP DEBUG] Selected chat model:', selectedChatModel);

    // Create an enhanced system prompt that mentions available tools
    function getEnhancedSystemPrompt(basePrompt: string, toolNames: string[]): string {
      if (!toolNames || toolNames.length === 0) {
        return basePrompt;
      }
      
      const toolsPrompt = `
You have access to the following Microsoft 365 tools that you can use:
${toolNames.map(tool => `- ${tool}: Use this to interact with Microsoft 365`).join('\n')}

When a user asks about their emails, calendar, or other Microsoft 365 data, use the appropriate tool to help them.
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
            description = `Call Microsoft 365 tool to manage emails`;
          } else if (toolName.includes('calendar')) {
            description = `Call Microsoft 365 tool to manage calendar events`;
          } else if (toolName.includes('login')) {
            description = `Authenticate with Microsoft 365`;
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
        
        console.log(`[MCP DEBUG] Formatted tool for AI: ${toolName}`, JSON.stringify(toolObj));
        return toolObj;
      });
      
      console.log(`[MCP DEBUG] Total formatted tools: ${formattedTools.length}`);
      return formattedTools;
    }

    // Log the experimental_activeTools to verify they're properly configured
    const formattedActiveTools = formatToolsForAI(activeTools);
    console.log(`[MCP DEBUG] Formatted active tools length: ${formattedActiveTools.length}`);
    
    // Debug tool configuration for AI library
    const streamTextConfig = {
      model: myProvider.languageModel(selectedChatModel),
      system: getEnhancedSystemPrompt(systemPrompt({ selectedChatModel, requestHints }), activeTools),
      messages: formattedMessages,
      maxSteps: 5,
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
    const toolImplementations = activeTools.reduce((acc: Record<string, any>, toolName: string) => {
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
          
          // Create or get an MCP client for this request 
          // Pass the access token if available (when user is authenticated with Azure AD)
          const accessToken = session.user.type === 'azuread' ? session.user.accessToken : undefined;
          console.log(`[DEBUG] Session user type: ${session.user.type}, accessToken available: ${!!accessToken}`);
          
          console.log(`[DEBUG] About to call getOrCreateMcpClient with serverClientId: ${serverClientId}`);
          const mcpClientResult = await getOrCreateMcpClient(serverClientId, undefined, accessToken);
          console.log(`[DEBUG] getOrCreateMcpClient result:`, JSON.stringify({
            clientAvailable: !!mcpClientResult?.client,
            sessionId: mcpClientResult?.sessionId
          }));
          
          const { client } = mcpClientResult;
          
          try {
            // Call the tool using the proper callTool method
            console.log(`[DEBUG] About to call client.callTool for ${toolName}`);
            const result = await client.callTool({
              name: toolName,
              arguments: params || {}
            });
            
            console.log(`[DEBUG] Tool ${toolName} execution successful:`, result);
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
              console.log('[MCP DEBUG] Available tools were:', activeTools.join(', '));
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
        } else {
          console.error('[DEBUG] Non-Error object thrown:', error);
        }
        return 'Oops, an error occurred!';
      },
    });
  } catch (error) {
    console.error('[DEBUG] POST /api/chat error:', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error stack:', error.stack);
    } else {
      console.error('[DEBUG] Non-Error object thrown:', error);
    }
    return new Response('An error occurred while processing your request!', {
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
