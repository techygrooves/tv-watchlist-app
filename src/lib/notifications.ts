import { Platform } from 'react-native';

/**
 * Local-notification helpers. expo-notifications is native-only, so the
 * module is loaded lazily and every function is a safe no-op on web —
 * update checks still run silently when notifications are unavailable
 * or permission was denied.
 */

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function loadNotifications(): typeof import('expo-notifications') | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const Notifications = loadNotifications();
  if (!Notifications) return 'unavailable';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const Notifications = loadNotifications();
  if (!Notifications) return 'unavailable';
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Fires the "new episodes" notification; silently no-ops without permission. */
export async function notifyNewEpisodes(count: number): Promise<void> {
  if (count <= 0) return;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New episodes found',
        body: `${count} new episode${count === 1 ? '' : 's'} were added to your watchlist.`,
        data: { url: '/upcoming' },
      },
      trigger: null, // deliver immediately
    });
  } catch {
    // Notification failure must never break the update itself.
  }
}

/**
 * Shows notifications while the app is foregrounded and routes taps to the
 * Upcoming screen. Call once from the root layout; returns a cleanup fn.
 */
export function setupNotificationHandling(onOpenUrl: (url: string) => void): () => void {
  const Notifications = loadNotifications();
  if (!Notifications) return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string') onOpenUrl(url);
  });
  return () => sub.remove();
}
