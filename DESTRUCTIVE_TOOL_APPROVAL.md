# Destructive Tool Approval System

This document explains the human-in-the-loop approval system for destructive MCP tool calls.

## Overview

The AI chatbot now supports automatic detection and approval workflows for destructive MCP tools. When an MCP server provides tools with `destructiveHint: true` in their annotations, the system will require explicit user approval before executing these tools.

## How It Works

### 1. Tool Detection
- The system fetches tool metadata from the MCP server via `/api/tools`
- Tools with `annotations.destructiveHint: true` are marked as requiring approval
- This information is cached on the frontend using SWR

### 2. Approval Workflow
When the AI wants to use a destructive tool:

1. **Tool Call Initiated**: The AI generates a tool call for a destructive tool
2. **Approval UI Shown**: Instead of executing immediately, a warning UI is displayed
3. **User Decision**: The user can approve or deny the tool execution
4. **Execution**: If approved, the tool runs; if denied, an error message is returned

### 3. UI Components

#### DestructiveToolApproval Component
- Shows tool name, arguments, and warning message
- Provides "Approve" and "Deny" buttons
- Displays read-only view for historical messages

#### Integration in Message Component
- Automatically detects destructive tools using `useToolsMetadata` hook
- Replaces normal tool call UI with approval UI when needed
- Handles approval responses and triggers reload

## Implementation Details

### Backend Changes

#### `/app/(chat)/api/chat/route.ts`
- Updated to handle destructive tool annotations
- Separates destructive tools (no execute function) from regular tools
- Processes approval responses through `processToolCalls` utility

#### `/app/(chat)/api/chat/utils.ts`
- Contains approval constants (`APPROVAL.YES`, `APPROVAL.NO`)
- Implements `processToolCalls` function for handling approval workflow
- Manages tool execution after approval

#### `/app/(chat)/api/tools/route.ts`
- New endpoint to provide tool metadata to frontend
- Returns tool annotations including `destructiveHint`
- Handles MCP client connection and cleanup

#### `/lib/ai/mcp/client.ts`
- Updated `McpTool` interface to include annotations
- Supports the full MCP tool specification with annotations

### Frontend Changes

#### `/hooks/use-tools-metadata.ts`
- Custom hook for fetching and caching tool metadata
- Provides `isDestructiveTool` helper function
- Uses SWR for efficient caching

#### `/components/destructive-tool-approval.tsx`
- Dedicated component for approval UI
- Handles both interactive and read-only modes
- Styled with warning colors and clear messaging

#### `/components/message.tsx`
- Integrated approval workflow into message rendering
- Handles approval responses and message updates
- Triggers chat reload after approval decisions

## Configuration

### Environment Variables
Ensure your MCP server URL is configured:
```env
MCP_SERVER_URL=http://localhost:4891
```

### MCP Server Requirements
Your MCP server must provide tool annotations in the format:
```json
{
  "name": "deleteFile",
  "description": "Delete a file from the system",
  "inputSchema": { ... },
  "annotations": {
    "destructiveHint": true,
    "title": "File Deletion Tool"
  }
}
```

## Testing

To test the destructive tool approval system:

1. **Setup MCP Server**: Ensure your MCP server provides tools with `destructiveHint: true`
2. **Start Development**: Run `npm run dev` in the ai-chatbot directory
3. **Test Workflow**: 
   - Ask the AI to perform a destructive action
   - Verify the approval UI appears
   - Test both approval and denial flows
4. **Check Logs**: Monitor console for `[DEBUG]` messages showing tool processing

## Security Considerations

- **User Awareness**: The approval UI clearly indicates destructive actions
- **Argument Display**: Tool arguments are shown for user review
- **No Auto-Execution**: Destructive tools never execute without explicit approval
- **Read-Only Mode**: Historical destructive tool calls show approval status
- **Error Handling**: Denied tools return clear error messages

## Troubleshooting

### Common Issues

1. **Approval UI Not Showing**
   - Check if MCP server is running and accessible
   - Verify tool annotations include `destructiveHint: true`
   - Check browser console for API errors

2. **Tools Not Loading**
   - Verify `/api/tools` endpoint returns tool metadata
   - Check MCP server connection in backend logs
   - Ensure proper authentication if required

3. **Approval Not Working**
   - Check that `reload()` function is being called after approval
   - Verify message state updates correctly
   - Look for errors in chat processing

### Debug Information

Enable debug logging by checking the browser console and server logs for:
- `[DEBUG]` messages showing tool processing
- API responses from `/api/tools`
- MCP client connection status
- Tool execution results

## Future Enhancements

Potential improvements to the approval system:
- **Approval Persistence**: Remember user preferences for specific tools
- **Batch Approval**: Allow approving multiple destructive actions at once
- **Risk Levels**: Different approval workflows based on risk assessment
- **Audit Trail**: Log all destructive tool approvals for compliance
- **Custom Approval Messages**: Tool-specific approval prompts 