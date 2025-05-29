import { formatDataStreamPart } from 'ai';
import type { McpTool } from '@/lib/ai/mcp/client';

// Constants for approval responses
export const APPROVAL = {
  YES: 'Yes, confirmed.',
  NO: 'No, denied.',
} as const;

/**
 * Process tool calls to handle human-in-the-loop approval for destructive tools
 */
export async function processToolCalls(
  {
    messages,
    dataStream,
    tools,
  }: {
    messages: any[];
    dataStream: any;
    tools: Record<string, any>;
  },
  executeFunction: Record<string, (args: any) => Promise<any>>
) {
  if (messages.length === 0) {
    return messages;
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.parts || !Array.isArray(lastMessage.parts)) {
    return messages;
  }

  // Process each part in the last message
  const processedParts = await Promise.all(
    lastMessage.parts.map(async (part: any) => {
      if (part.type !== 'tool-invocation' || part.toolInvocation?.state !== 'result') {
        return part;
      }

      const toolInvocation = part.toolInvocation;
      const toolName = toolInvocation.toolName;
      const toolResult = toolInvocation.result;

      // Check if this is a confirmation response for a destructive tool
      if (
        (toolResult === APPROVAL.YES || toolResult === APPROVAL.NO) &&
        toolName in executeFunction
      ) {
        let result: any;

        if (toolResult === APPROVAL.YES) {
          // User approved - execute the tool
          const toolInstance = executeFunction[toolName];
          if (toolInstance) {
            result = await toolInstance(toolInvocation.args);
          } else {
            result = 'Error: No execute function found on tool';
          }
        } else if (toolResult === APPROVAL.NO) {
          result = 'Error: User denied access to tool execution';
        } else {
          // For any unhandled responses, return the original part
          return part;
        }

        // Forward updated tool result to the client
        dataStream.write(
          formatDataStreamPart('tool_result', {
            toolCallId: toolInvocation.toolCallId,
            result,
          })
        );

        // Return updated toolInvocation with the actual result
        return {
          ...part,
          toolInvocation: {
            ...toolInvocation,
            result,
          },
        };
      }

      return part;
    })
  );

  // Return the processed messages
  return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
}

/**
 * Get tools that require confirmation (destructive tools without execute function)
 */
export function getToolsRequiringConfirmation(tools: Record<string, McpTool>): string[] {
  return Object.keys(tools).filter(toolName => {
    const tool = tools[toolName];
    return tool.annotations?.destructiveHint === true;
  });
} 