'use client';

import { Button } from './ui/button';
import { WarningIcon } from './icons';
import { APPROVAL } from '@/app/(chat)/api/chat/utils';
import { useToolsMetadata } from '@/hooks/use-tools-metadata';

interface DestructiveToolApprovalProps {
  toolName: string;
  args: any;
  toolCallId: string;
  onApprove: (toolCallId: string, result: string) => void;
  isReadonly?: boolean;
}

// Helper function to render arguments in a nice format
function renderArguments(args: any) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return <span className="font-mono">{JSON.stringify(args)}</span>;
  }

  const entries = Object.entries(args);
  if (entries.length === 0) {
    return <span className="font-mono">{}</span>;
  }

  // If it's a simple object with few entries, show inline
  if (entries.length <= 2 && entries.every(([_, value]) => 
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  )) {
    return <span className="font-mono">{JSON.stringify(args)}</span>;
  }

  // Otherwise, show as a table
  return (
    <div className="mt-2 border border-blue-200 dark:border-blue-700 rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-blue-100 dark:bg-blue-900">
            <th className="text-left px-2 py-1 font-medium text-blue-800 dark:text-blue-200">Parameter</th>
            <th className="text-left px-2 py-1 font-medium text-blue-800 dark:text-blue-200">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value], index) => (
            <tr key={key} className={index % 2 === 0 ? 'bg-blue-25 dark:bg-blue-950' : 'bg-white dark:bg-blue-900'}>
              <td className="px-2 py-1 font-mono text-blue-700 dark:text-blue-300 border-r border-blue-200 dark:border-blue-700">
                {key}
              </td>
              <td className="px-2 py-1 font-mono text-blue-600 dark:text-blue-400 break-all">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DestructiveToolApproval({
  toolName,
  args,
  toolCallId,
  onApprove,
  isReadonly = false,
}: DestructiveToolApprovalProps) {
  const { getToolMetadata } = useToolsMetadata();
  const toolMetadata = getToolMetadata(toolName);
  
  // Always ensure we have a display name - prioritize user-friendly names but always fallback to toolName
  const displayName = toolMetadata?.annotations?.title || 
                     toolMetadata?.description || 
                     toolName;

  if (isReadonly) {
    return (
      <div className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0">
            <WarningIcon size={16} />
          </div>
          <div className="flex-1">
            <div className="font-medium text-blue-800 dark:text-blue-200 text-sm">
              Tool Approval Required
            </div>
            <div className="text-blue-700 dark:text-blue-300 text-sm mt-1">
              Tool: <span className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{displayName}</span>
            </div>
            <div className="text-blue-600 dark:text-blue-400 text-xs mt-2">
              Arguments: {renderArguments(args)}
            </div>
            <div className="text-blue-600 dark:text-blue-400 text-xs mt-2">
              This tool required approval but cannot be approved in read-only mode.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0">
          <WarningIcon size={16} />
        </div>
        <div className="flex-1">
          <div className="font-medium text-blue-800 dark:text-blue-200 text-sm">
            Tool Approval Required
          </div>
          <div className="text-blue-700 dark:text-blue-300 text-sm mt-1">
            I'd like to run: <span className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{displayName}</span>
          </div>
          <div className="text-blue-600 dark:text-blue-400 text-xs mt-2">
            Arguments: {renderArguments(args)}
          </div>
          <div className="text-blue-600 dark:text-blue-400 text-xs mt-2">
            This tool may make changes to your system. Please review and approve if you'd like me to proceed.
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="default"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => onApprove(toolCallId, APPROVAL.YES)}
            >
              ✓ Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
              onClick={() => onApprove(toolCallId, APPROVAL.NO)}
            >
              ✗ Decline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
} 