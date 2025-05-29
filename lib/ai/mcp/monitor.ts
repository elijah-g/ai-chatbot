import { logger } from '../../utils/logger';
import { 
  getConnectionHealthStats, 
  getToolCacheStats, 
  refreshConnectionHealth,
  clearToolCache 
} from './index';

/**
 * MCP Connection Monitor - Utility for debugging connection issues
 */
export class McpConnectionMonitor {
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring = false;

  /**
   * Start monitoring MCP connections
   * @param intervalMs Monitoring interval in milliseconds (default: 30 seconds)
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      logger.warn('[MCP Monitor] Already monitoring connections');
      return;
    }

    this.isMonitoring = true;
    logger.info(`[MCP Monitor] Starting connection monitoring (interval: ${intervalMs}ms)`);

    this.monitoringInterval = setInterval(() => {
      this.logConnectionStats();
    }, intervalMs);

    // Log initial stats
    this.logConnectionStats();
  }

  /**
   * Stop monitoring MCP connections
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('[MCP Monitor] Stopped connection monitoring');
  }

  /**
   * Log current connection and cache statistics
   */
  logConnectionStats(): void {
    try {
      const connectionStats = getConnectionHealthStats();
      const cacheStats = getToolCacheStats();

      logger.info('[MCP Monitor] === Connection Health Report ===');
      logger.info(`[MCP Monitor] Active connections: ${connectionStats.length}`);
      logger.info(`[MCP Monitor] Tool cache entries: ${cacheStats.size}`);

      if (connectionStats.length === 0) {
        logger.info('[MCP Monitor] No active connections');
        return;
      }

      connectionStats.forEach(stat => {
        const status = stat.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY';
        const timeSinceCheck = Date.now() - stat.lastHealthCheck.getTime();
        const failures = stat.consecutiveFailures > 0 ? ` (${stat.consecutiveFailures} failures)` : '';
        
        logger.info(`[MCP Monitor] User ${stat.userId}: ${status}${failures} - Last check: ${Math.round(timeSinceCheck / 1000)}s ago`);
      });

      // Log unhealthy connections
      const unhealthyConnections = connectionStats.filter(stat => !stat.isHealthy);
      if (unhealthyConnections.length > 0) {
        logger.warn(`[MCP Monitor] ⚠️  ${unhealthyConnections.length} unhealthy connections detected`);
      }

      // Log cache efficiency
      if (cacheStats.size > 0) {
        logger.info(`[MCP Monitor] Cache entries: ${cacheStats.entries.join(', ')}`);
      }

    } catch (error) {
      logger.error('[MCP Monitor] Error getting connection stats:', error);
    }
  }

  /**
   * Force refresh health for all connections
   */
  async refreshAllConnections(): Promise<void> {
    try {
      const connectionStats = getConnectionHealthStats();
      logger.info(`[MCP Monitor] Refreshing health for ${connectionStats.length} connections...`);

      const refreshPromises = connectionStats.map(async (stat) => {
        try {
          const isHealthy = await refreshConnectionHealth(stat.userId);
          logger.info(`[MCP Monitor] User ${stat.userId} health refresh: ${isHealthy ? 'healthy' : 'unhealthy'}`);
          return { userId: stat.userId, isHealthy };
        } catch (error) {
          logger.error(`[MCP Monitor] Error refreshing health for user ${stat.userId}:`, error);
          return { userId: stat.userId, isHealthy: false };
        }
      });

      const results = await Promise.all(refreshPromises);
      const healthyCount = results.filter(r => r.isHealthy).length;
      
      logger.info(`[MCP Monitor] Health refresh complete: ${healthyCount}/${results.length} connections healthy`);
    } catch (error) {
      logger.error('[MCP Monitor] Error during connection refresh:', error);
    }
  }

  /**
   * Clear tool cache and log the action
   */
  clearCache(): void {
    try {
      const statsBefore = getToolCacheStats();
      clearToolCache();
      logger.info(`[MCP Monitor] Cleared tool cache (${statsBefore.size} entries removed)`);
    } catch (error) {
      logger.error('[MCP Monitor] Error clearing cache:', error);
    }
  }

  /**
   * Get a summary of current MCP status
   */
  getStatusSummary(): {
    totalConnections: number;
    healthyConnections: number;
    unhealthyConnections: number;
    cacheEntries: number;
    oldestConnection?: Date;
    newestConnection?: Date;
  } {
    try {
      const connectionStats = getConnectionHealthStats();
      const cacheStats = getToolCacheStats();

      const healthyConnections = connectionStats.filter(stat => stat.isHealthy).length;
      const unhealthyConnections = connectionStats.length - healthyConnections;

      const connectionDates = connectionStats.map(stat => stat.lastHealthCheck);
      const oldestConnection = connectionDates.length > 0 ? new Date(Math.min(...connectionDates.map(d => d.getTime()))) : undefined;
      const newestConnection = connectionDates.length > 0 ? new Date(Math.max(...connectionDates.map(d => d.getTime()))) : undefined;

      return {
        totalConnections: connectionStats.length,
        healthyConnections,
        unhealthyConnections,
        cacheEntries: cacheStats.size,
        oldestConnection,
        newestConnection
      };
    } catch (error) {
      logger.error('[MCP Monitor] Error getting status summary:', error);
      return {
        totalConnections: 0,
        healthyConnections: 0,
        unhealthyConnections: 0,
        cacheEntries: 0
      };
    }
  }
}

// Export a singleton instance
export const mcpMonitor = new McpConnectionMonitor(); 