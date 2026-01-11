import { Logger, LogLevel } from '@nestjs/common';
import { McpOptions } from '../interfaces';

/**
 * Logger that filters log messages based on configured log levels
 */
class FilteredLogger extends Logger {
  private enabledLevels: Set<LogLevel>;

  constructor(context: string, enabledLevels: LogLevel[]) {
    super(context);
    this.enabledLevels = new Set(enabledLevels);
  }

  log(message: any, context?: string): void {
    if (this.enabledLevels.has('log')) {
      super.log(message, context);
    }
  }

  error(message: any, stack?: string, context?: string): void;
  error(message: any, ...optionalParams: [...any, string?, string?]): void;
  error(message: any, ...optionalParams: any[]): void {
    if (this.enabledLevels.has('error')) {
      super.error(message, ...optionalParams);
    }
  }

  warn(message: any, context?: string): void {
    if (this.enabledLevels.has('warn')) {
      super.warn(message, context);
    }
  }

  debug(message: any, context?: string): void {
    if (this.enabledLevels.has('debug')) {
      super.debug(message, context);
    }
  }

  verbose(message: any, context?: string): void {
    if (this.enabledLevels.has('verbose')) {
      super.verbose(message, context);
    }
  }
}

/**
 * No-op logger that discards all log messages
 */
class NoOpLogger extends Logger {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log(message: any, context?: string): void {
    // No-op
  }

  error(message: any, stack?: string, context?: string): void;
  error(message: any, ...optionalParams: [...any, string?, string?]): void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error(message: any, ...optionalParams: any[]): void {
    // No-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  warn(message: any, context?: string): void {
    // No-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug(message: any, context?: string): void {
    // No-op
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verbose(message: any, context?: string): void {
    // No-op
  }
}

/**
 * Factory function to create a logger instance based on MCP logging configuration
 * @param context - Logger context (typically the class name)
 * @param options - MCP options containing logging configuration
 * @returns Logger instance (standard, filtered, or no-op based on configuration)
 */
export function createMcpLogger(
  context: string,
  options: McpOptions | undefined,
): Logger {
  // If no options provided or logging not configured, use standard logger
  if (!options || options.logging === undefined) {
    return new Logger(context);
  }

  // If logging is explicitly disabled, return no-op logger
  if (options.logging === false) {
    return new NoOpLogger(context);
  }

  // If specific log levels are configured, return filtered logger
  if (options.logging.level && Array.isArray(options.logging.level)) {
    return new FilteredLogger(context, options.logging.level as LogLevel[]);
  }

  // Fallback to standard logger
  return new Logger(context);
}
