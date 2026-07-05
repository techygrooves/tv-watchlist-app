import { Platform } from 'react-native';

import { notifyNewEpisodes } from './notifications';

/**
 * Background scheduling for the show-update checker.
 *
 * The task 'check-show-updates' is registered with expo-background-task
 * (WorkManager on Android, BGTaskScheduler on iOS) at a ~12h minimum
 * interval — approximately twice per day, at the OS's discretion. Because
 * the OS may throttle or skip runs (Doze, battery saver, app standby),
 * the root layout also runs a silent catch-up check on app open whenever
 * the last check is older than 12 hours.
 *
 * Everything is native-only; on web these are safe no-ops and the manual
 * "Check for Updates Now" button covers the same code path.
 */

export const CHECK_SHOW_UPDATES_TASK = 'check-show-updates';
// Background runs are capped so they fit OS execution windows; the
// last_checked_at rotation cycles through the full library across runs.
const BACKGROUND_SHOWS_PER_RUN = 30;
const TWICE_DAILY_MINUTES = 12 * 60;

async function runUpdateCheck(): Promise<number> {
  // Lazy imports keep the task definition light and avoid pulling SQLite
  // into contexts that never run the task.
  const { openDatabaseAsync } = await import('expo-sqlite');
  const { DATABASE_NAME, migrateDb } = await import('./db');
  const { checkForShowUpdates } = await import('./updateChecker');

  const db = await openDatabaseAsync(DATABASE_NAME);
  try {
    await migrateDb(db);
    const result = await checkForShowUpdates(db, { limit: BACKGROUND_SHOWS_PER_RUN });
    return result.newEpisodes;
  } finally {
    await db.closeAsync();
  }
}

/** Defines the task. Must be called at module scope on app start (root layout imports this). */
export function defineBackgroundUpdateTask(): void {
  if (Platform.OS === 'web') return;
  try {
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    const BackgroundTask = require('expo-background-task') as typeof import('expo-background-task');
    TaskManager.defineTask(CHECK_SHOW_UPDATES_TASK, async () => {
      try {
        const newEpisodes = await runUpdateCheck();
        await notifyNewEpisodes(newEpisodes);
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    // Task manager unavailable (e.g. Expo Go limitation) — manual and
    // on-open checks still work.
  }
}

export type BackgroundUpdatesStatus = 'registered' | 'restricted' | 'unavailable';

/** Registers the twice-daily background run. Safe to call repeatedly. */
export async function registerBackgroundUpdates(): Promise<BackgroundUpdatesStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const BackgroundTask = require('expo-background-task') as typeof import('expo-background-task');
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return 'restricted';
    await BackgroundTask.registerTaskAsync(CHECK_SHOW_UPDATES_TASK, {
      minimumInterval: TWICE_DAILY_MINUTES,
    });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

export async function getBackgroundUpdatesStatus(): Promise<BackgroundUpdatesStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    const BackgroundTask = require('expo-background-task') as typeof import('expo-background-task');
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return 'restricted';
    const registered = await TaskManager.isTaskRegisteredAsync(CHECK_SHOW_UPDATES_TASK);
    return registered ? 'registered' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
