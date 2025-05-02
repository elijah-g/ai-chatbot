import {
  type UIMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import {
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
} from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { getOrCreateMcpClient, disconnectMcpClient, checkMcpServerTools } from '../m365/client';

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
    console.log('[DEBUG] Starting getAvailableMcpTools function');
    
    // Check the MCP server and get tools directly
    console.log('[DEBUG] About to call checkMcpServerTools');
    const serverToolsResult = await checkMcpServerTools();
    console.log('[DEBUG] checkMcpServerTools result:', JSON.stringify(serverToolsResult));
    
    const { available, tools } = serverToolsResult;
    
    if (available && Array.isArray(tools)) {
      console.log('[DEBUG] MCP server available with tools:', tools);
      return tools;
    }
    
    console.log('[DEBUG] MCP server not available or no tools found');
    return [];
  } catch (error) {
    console.error('[DEBUG] Error in getAvailableMcpTools:', error);
    // Log the full error details including stack trace
    if (error instanceof Error) {
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error stack:', error.stack);
    } else {
      console.error('[DEBUG] Non-Error object thrown:', error);
    }
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const {
      id,
      messages,
      selectedChatModel,
    }: {
      id: string;
      messages: Array<UIMessage>;
      selectedChatModel: string;
    } = await request.json();

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
      console.error('No user message found in messages:', messages);
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

    // Get available tools from MCP server
    const activeTools = selectedChatModel === 'chat-model-reasoning'
      ? []
      : await getAvailableMcpTools();
    
    console.log('Active tools for this chat:', activeTools);

    // This function transforms MCP tools into a format compatible with the AI library
    function formatToolsForAI(toolNames: string[]): any[] {
      return toolNames.map((toolName: string) => ({
        type: "function",
        function: {
          name: toolName,
          description: `Call the ${toolName} tool`,
          parameters: {
            type: "object",
            properties: {
              // Generic parameters object that accepts any JSON
              arguments: {
                type: "object",
                additionalProperties: true
              }
            },
            required: ["arguments"]
          }
        }
      }));
    }

    return createDataStreamResponse({
      execute: (dataStream) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel }),
          messages,
          maxSteps: 5,
          experimental_activeTools: formatToolsForAI(activeTools),
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: activeTools.reduce((acc: Record<string, any>, toolName: string) => {
            // Create a tool function for each M365 tool that uses the MCP server
            acc[toolName] = async (params: any) => {
              try {
                console.log(`[DEBUG] Invoking M365 tool: ${toolName} with params:`, params);
                
                // Use our MCP client instead of direct HTTP requests
                // Generate a unique server-side client ID for anonymous tool calls from the AI
                const serverClientId = `server_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                console.log(`[DEBUG] Generated serverClientId: ${serverClientId}`);
                
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
          }, {}),
          onFinish: async ({ response }) => {
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
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
