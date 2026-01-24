import { Injectable } from '@nestjs/common';

/**
 * Notification service - sends notifications to users
 */
@Injectable()
export class NotificationService {
  private notifications: Array<{
    id: string;
    userId: string;
    message: string;
    timestamp: Date;
    read: boolean;
  }> = [];

  sendNotification(userId: string, message: string) {
    const notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      message,
      timestamp: new Date(),
      read: false,
    };
    this.notifications.push(notification);
    return notification;
  }

  getNotifications(userId: string) {
    return this.notifications.filter((n) => n.userId === userId);
  }

  markAsRead(notificationId: string) {
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  getUnreadCount(userId: string): number {
    return this.notifications.filter((n) => n.userId === userId && !n.read)
      .length;
  }
}
