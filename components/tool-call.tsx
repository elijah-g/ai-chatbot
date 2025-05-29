'use client';

import { LoaderIcon } from './icons';
import { useToolsMetadata } from '@/hooks/use-tools-metadata';

interface ToolCallProps {
  toolName: string;
  args: any;
}

export function ToolCall({ toolName, args }: ToolCallProps) {
  const { getToolMetadata } = useToolsMetadata();
  const toolMetadata = getToolMetadata(toolName);
  
  // Always ensure we have a display name - prioritize user-friendly names but always fallback to toolName
  const displayName = toolMetadata?.annotations?.title || 
                     toolMetadata?.description || 
                     toolName;

  return (
    <div className="flex flex-row gap-2 items-center text-sm text-muted-foreground">
      <div className="animate-spin">
        <LoaderIcon size={14} />
      </div>
      <div>
        {displayName}
        {args && Object.keys(args).length > 0 && (
          <span className="text-xs ml-1">
            ({Object.keys(args).join(', ')})
          </span>
        )}
      </div>
    </div>
  );
} 