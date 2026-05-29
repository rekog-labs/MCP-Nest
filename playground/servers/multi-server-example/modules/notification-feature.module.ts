import { Module } from '@nestjs/common';
import { NotificationTools } from '../tools/notification.tools';
import { NotificationService } from '../services/notification.service';

/**
 * Notification Feature Module - shared utility tools.
 *
 * The capability class is a `@McpController` (declared in `controllers`); its
 * dependency is a normal provider.
 */
@Module({
  controllers: [NotificationTools],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationFeatureModule {}
