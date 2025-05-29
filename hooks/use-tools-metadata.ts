import useSWR from 'swr';
import { fetcher } from '@/lib/utils';

export interface ToolMetadata {
  name: string;
  description: string;
  annotations: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  isDestructive: boolean;
}

export interface ToolsMetadataResponse {
  tools: ToolMetadata[];
}

export function useToolsMetadata() {
  const { data, error, isLoading } = useSWR<ToolsMetadataResponse>(
    '/api/tools',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 300000, // Cache for 5 minutes
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      // Keep previous data while revalidating to prevent disappearing content
      keepPreviousData: true,
    }
  );

  const getToolMetadata = (toolName: string): ToolMetadata | undefined => {
    return data?.tools.find(tool => tool.name === toolName);
  };

  const isDestructiveTool = (toolName: string): boolean => {
    const tool = getToolMetadata(toolName);
    return tool?.isDestructive === true;
  };

  return {
    tools: data?.tools || [],
    getToolMetadata,
    isDestructiveTool,
    isLoading,
    error,
  };
} 