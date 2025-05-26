'use client';

import { LoaderIcon } from './icons';

interface ToolCallProps {
  toolName: string;
  args: any;
}

export function ToolCall({ toolName, args }: ToolCallProps) {
  return (
    <div className="flex flex-row gap-2 items-center text-sm text-muted-foreground">
      <div className="animate-spin">
        <LoaderIcon size={14} />
      </div>
      <div>
        Calling <span className="font-mono font-medium">{toolName}</span>
        {args && Object.keys(args).length > 0 && (
          <span className="text-xs ml-1">
            ({Object.keys(args).join(', ')})
          </span>
        )}
      </div>
    </div>
  );
} 