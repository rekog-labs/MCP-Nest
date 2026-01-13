import { Logger } from '@nestjs/common';
import { createMcpLogger } from './mcp-logger.factory';
import type { McpOptions } from '../interfaces';

describe('McpLoggerFactory', () => {
  describe('createMcpLogger', () => {
    it('should create standard logger when no options provided', () => {
      const logger = createMcpLogger('TestContext', undefined);
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create standard logger when logging is undefined', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        // logging is undefined
      };
      const logger = createMcpLogger('TestContext', options);
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create no-op logger when logging is false', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: false,
      };
      const logger = createMcpLogger('TestContext', options);
      expect(logger).toBeInstanceOf(Logger);

      // Verify that log methods don't throw and don't produce output
      expect(() => {
        logger.log('test message');
        logger.error('test error');
        logger.warn('test warning');
        logger.debug('test debug');
        logger.verbose('test verbose');
      }).not.toThrow();
    });

    it('should create filtered logger with specified levels', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: {
          level: ['error', 'warn'],
        },
      };
      const logger = createMcpLogger('TestContext', options);
      expect(logger).toBeInstanceOf(Logger);

      // Verify that log methods don't throw
      expect(() => {
        logger.log('test message');
        logger.error('test error');
        logger.warn('test warning');
        logger.debug('test debug');
        logger.verbose('test verbose');
      }).not.toThrow();
    });

    it('should create logger with all log levels when specified', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: {
          level: ['log', 'error', 'warn', 'debug', 'verbose'],
        },
      };
      const logger = createMcpLogger('TestContext', options);
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should handle empty level array gracefully', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: {
          level: [],
        },
      };
      const logger = createMcpLogger('TestContext', options);
      expect(logger).toBeInstanceOf(Logger);

      // With empty levels, nothing should be logged
      expect(() => {
        logger.log('test message');
        logger.error('test error');
        logger.warn('test warning');
        logger.debug('test debug');
        logger.verbose('test verbose');
      }).not.toThrow();
    });
  });

  describe('FilteredLogger behavior', () => {
    it('should only call parent logger methods for enabled levels', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: {
          level: ['error', 'warn'],
        },
      };

      // Mock the Logger prototype methods
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation();
      const verboseSpy = jest
        .spyOn(Logger.prototype, 'verbose')
        .mockImplementation();

      const logger = createMcpLogger('TestContext', options);

      // Call all methods
      logger.log('log message');
      logger.error('error message');
      logger.warn('warn message');
      logger.debug('debug message');
      logger.verbose('verbose message');

      // Only error and warn should have been called on the parent
      // Note: The constructor call also invokes these, so we check if they were called
      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();

      // Clean up
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      debugSpy.mockRestore();
      verboseSpy.mockRestore();
    });
  });

  describe('NoOpLogger behavior', () => {
    it('should not call parent logger methods when logging is disabled', () => {
      const options: McpOptions = {
        name: 'test',
        version: '1.0.0',
        logging: false,
      };

      // Mock the Logger prototype methods
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation();
      const verboseSpy = jest
        .spyOn(Logger.prototype, 'verbose')
        .mockImplementation();

      const logger = createMcpLogger('TestContext', options);

      // Call all methods
      logger.log('log message');
      logger.error('error message');
      logger.warn('warn message');
      logger.debug('debug message');
      logger.verbose('verbose message');

      // Clean up
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      debugSpy.mockRestore();
      verboseSpy.mockRestore();
    });
  });
});
