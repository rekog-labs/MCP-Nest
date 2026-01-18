import { Module } from '@nestjs/common';
import { McpModule } from '../../../../src';
import { NotificationTools } from '../tools/notification.tools';
import { NotificationService } from '../services/notification.service';

/**
 * Notification Feature Module - SHARED across both servers
 * Registers notification tools to BOTH "public-server" and "admin-server"
 */
@Module({
  imports: [
    // Register NotificationTools to BOTH servers
    McpModule.forFeature([NotificationTools], 'public-server'),
    McpModule.forFeature([NotificationTools], 'admin-server'),
  ],
  providers: [
    NotificationTools,
    NotificationService, // NotificationTools depends on NotificationService
  ],
  exports: [NotificationTools, NotificationService],
})
export class NotificationFeatureModule {}
