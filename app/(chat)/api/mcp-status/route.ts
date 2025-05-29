import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { mcpMonitor } from '@/lib/ai/mcp/monitor';
import { getConnectionHealthStats, getToolCacheStats } from '@/lib/ai/mcp';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current MCP status
    const statusSummary = mcpMonitor.getStatusSummary();
    const connectionStats = getConnectionHealthStats();
    const cacheStats = getToolCacheStats();

    const response = {
      timestamp: new Date().toISOString(),
      summary: statusSummary,
      connections: connectionStats.map(stat => ({
        userId: stat.userId,
        isHealthy: stat.isHealthy,
        lastHealthCheck: stat.lastHealthCheck.toISOString(),
        consecutiveFailures: stat.consecutiveFailures,
        hasActiveConnection: stat.hasActiveConnection,
        timeSinceLastCheck: Date.now() - stat.lastHealthCheck.getTime()
      })),
      cache: {
        size: cacheStats.size,
        entries: cacheStats.entries
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting MCP status:', error);
    return NextResponse.json(
      { error: 'Failed to get MCP status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'refresh':
        await mcpMonitor.refreshAllConnections();
        return NextResponse.json({ message: 'Connection refresh initiated' });
      
      case 'clearCache':
        mcpMonitor.clearCache();
        return NextResponse.json({ message: 'Cache cleared' });
      
      case 'startMonitoring':
        const interval = body.interval || 30000;
        mcpMonitor.startMonitoring(interval);
        return NextResponse.json({ message: `Monitoring started with ${interval}ms interval` });
      
      case 'stopMonitoring':
        mcpMonitor.stopMonitoring();
        return NextResponse.json({ message: 'Monitoring stopped' });
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error handling MCP action:', error);
    return NextResponse.json(
      { error: 'Failed to handle MCP action' },
      { status: 500 }
    );
  }
} 