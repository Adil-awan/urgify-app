import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { prisma } from '../index';

const expo = new Expo();

/**
 * Sends a single push notification to a user by their ID
 */
export const sendPushNotification = async (
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true }
    });

    if (!user || !user.fcmToken || !Expo.isExpoPushToken(user.fcmToken)) {
      console.warn(`[Push] User ${userId} has no valid Expo push token.`);
      return;
    }

    const message: ExpoPushMessage = {
      to: user.fcmToken,
      sound: 'default',
      title,
      body,
      data,
    };

    const chunks = expo.chunkPushNotifications([message]);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    console.log(`[Push] Sent notification to ${userId}: ${title}`);
  } catch (error) {
    console.error(`[Push] Error sending notification to user ${userId}:`, error);
  }
};

/**
 * Sends a batch push notification to multiple users
 */
export const batchPushNotifications = async (
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
) => {
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fcmToken: true }
    });

    const messages: ExpoPushMessage[] = [];
    for (const user of users) {
      if (user.fcmToken && Expo.isExpoPushToken(user.fcmToken)) {
        messages.push({
          to: user.fcmToken,
          sound: 'default',
          title,
          body,
          data,
        });
      }
    }

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    console.log(`[Push] Batched ${messages.length} notifications: ${title}`);
  } catch (error) {
    console.error(`[Push] Error in batch notifications:`, error);
  }
};
