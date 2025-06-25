import { SetMetadata } from '@nestjs/common';
import { createSseController } from './sse.controller.factory';
import { createStreamableHttpController } from './streamable-http.controller.factory';

describe('Custom Decorators', () => {
  // Custom decorator for testing
  const testCustomDecorator = SetMetadata('test:decorator', true);

  describe('SSE Controller Factory', () => {
    it('should apply custom decorators to the SSE controller', () => {
      // Arrange
      const decorators = [testCustomDecorator];

      // Act
      const sseController = createSseController(
        'test-sse-endpoint',
        'test-messages-endpoint',
        '/api',
        [],
        decorators,
      );

      // Assert
      expect(sseController).toBeDefined();
      expect(Reflect.getMetadata('test:decorator', sseController)).toBeTruthy();
    });

    it('should work without custom decorators', () => {
      // Act
      const sseController = createSseController(
        'test-sse-endpoint',
        'test-messages-endpoint',
        '/api',
      );

      // Assert
      expect(sseController).toBeDefined();
      expect(
        Reflect.getMetadata('test:decorator', sseController),
      ).toBeUndefined();
    });
  });

  describe('Streamable HTTP Controller Factory', () => {
    it('should apply custom decorators to the Streamable HTTP controller', () => {
      // Arrange
      const decorators = [testCustomDecorator];

      // Act
      const streamableController = createStreamableHttpController(
        'test-http-endpoint',
        '/api',
        [],
        decorators,
      );

      // Assert
      expect(streamableController).toBeDefined();
      expect(
        Reflect.getMetadata('test:decorator', streamableController),
      ).toBeTruthy();
    });

    it('should work without custom decorators', () => {
      // Act
      const StreamableController = createStreamableHttpController(
        'test-http-endpoint',
        '/api',
      );

      // Assert
      expect(StreamableController).toBeDefined();
    });
  });
});
