/**
 * Logger utility that adds timestamps to console.log statements
 */

const formatTimestamp = (): string => {
  const now = new Date();
  return now.toISOString();
};

export const logger = {
  log: (...args: any[]) => {
    console.log(`[${formatTimestamp()}]`, ...args);
  },
  error: (...args: any[]) => {
    console.error(`[${formatTimestamp()}]`, ...args);
  },
  warn: (...args: any[]) => {
    console.warn(`[${formatTimestamp()}]`, ...args);
  },
  info: (...args: any[]) => {
    console.info(`[${formatTimestamp()}]`, ...args);
  },
  debug: (...args: any[]) => {
    console.debug(`[${formatTimestamp()}]`, ...args);
  }
};

// For backward compatibility, export a timestamped console.log function
export const timestampedLog = (...args: any[]) => {
  console.log(`[${formatTimestamp()}]`, ...args);
}; 