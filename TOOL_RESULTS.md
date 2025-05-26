# Collapsible Tool Results

This document describes the collapsible tool results feature that improves the chat interface by making tool call results more compact and user-friendly.

## Problem

Previously, when AI tools were called and returned results, the entire result would be displayed as a wide JSON block that:
- Took up significant screen space
- Created horizontal scrolling
- Made the chat interface cluttered
- Showed technical details that users might not need to see immediately

## Solution

We've implemented collapsible tool results that:
- Show only the tool name by default
- Allow users to expand to see the full result when needed
- Provide a clean, compact interface
- Maintain all functionality while improving UX

## Components

### ToolResult Component (`components/tool-result.tsx`)

A collapsible component that wraps tool results:

```tsx
<ToolResult toolName="exampleTool" result={toolResult}>
  {/* Optional custom content */}
</ToolResult>
```

**Features:**
- Collapsed by default showing only "Called {toolName}"
- Expandable with a chevron icon that rotates
- Smooth animation using Framer Motion
- Falls back to JSON display for unknown result types
- Supports custom content via children prop

### ToolCall Component (`components/tool-call.tsx`)

A compact component for displaying active tool calls:

```tsx
<ToolCall toolName="exampleTool" args={toolArgs} />
```

**Features:**
- Shows "Calling {toolName}" with a loading spinner
- Displays parameter names when available
- Compact, single-line display

## Usage

The components are automatically used in the message rendering system:

1. **Tool Calls**: When a tool is being invoked, unknown tools now show a compact "Calling..." indicator
2. **Tool Results**: When a tool returns results, unknown tools show a collapsible result display

## Integration

The feature integrates with the existing message system in `components/message.tsx`:

- Known tools (weather, documents, etc.) continue to use their specialized UI components
- Unknown tools now use the new collapsible components instead of raw JSON display
- No breaking changes to existing functionality

## Benefits

- **Improved UX**: Chat interface is cleaner and less cluttered
- **Better Performance**: Large tool results don't cause layout issues
- **Accessibility**: Users can choose what level of detail they want to see
- **Consistency**: All tool calls and results have a consistent appearance
- **Maintainability**: Easy to extend for new tool types 