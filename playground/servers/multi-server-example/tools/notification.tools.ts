import { Injectable } from '@nestjs/common';
import { Tool } from '../../../../src';
import { z } from 'zod';
import { NotificationService } from '../services/notification.service';

/**
 * Notification tools - manages user notifications
 * This is the SHARED tool that will be registered to BOTH servers
 */
@Injectable()
export class NotificationTools {
  constructor(private readonly notificationService: NotificationService) {}

  @Tool({
    name: 'send-notification',
    description: 'Send a notification to a user',
    parameters: z.object({
      userId: z.string().describe('The ID of the user to notify'),
      message: z.string().describe('The notification message'),
    }),
  })
  async sendNotification({ userId, message }: { userId: string; message: string }) {
    const notification = this.notificationService.sendNotification(userId, message);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Notification sent to user ${userId}: "${message}" (ID: ${notification.id})`,
        },
      ],
    };
  }

  @Tool({
    name: 'get-notifications',
    description: 'Get all notifications for a user',
    parameters: z.object({
      userId: z.string().describe('The ID of the user'),
    }),
  })
  async getNotifications({ userId }: { userId: string }) {
    const notifications = this.notificationService.getNotifications(userId);
    const unreadCount = this.notificationService.getUnreadCount(userId);

    const notificationsText = notifications.length > 0
      ? `Notifications for ${userId} (${unreadCount} unread):\n` +
        notifications
          .map(
            (n) =>
              `- [${n.read ? '✓' : '●'}] ${n.message} (${n.timestamp.toISOString()})`,
          )
          .join('\n')
      : `No notifications for user ${userId}`;

    return {
      content: [
        {
          type: 'text' as const,
          text: notificationsText,
        },
      ],
    };
  }

  @Tool({
    name: 'mark-notification-read',
    description: 'Mark a notification as read',
    parameters: z.object({
      notificationId: z.string().describe('The ID of the notification'),
    }),
  })
  async markNotificationRead({ notificationId }: { notificationId: string }) {
    const success = this.notificationService.markAsRead(notificationId);

    return {
      content: [
        {
          type: 'text' as const,
          text: success
            ? `Notification ${notificationId} marked as read`
            : `Notification ${notificationId} not found`,
        },
      ],
    };
  }
}
