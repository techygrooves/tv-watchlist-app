import { router, Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import {
  defineBackgroundUpdateTask,
  registerBackgroundUpdates,
} from '@/src/lib/backgroundUpdates';
import { DATABASE_NAME, migrateDb } from '@/src/lib/db';
import { notifyNewEpisodes, setupNotificationHandling } from '@/src/lib/notifications';
import { checkForShowUpdates, isCheckStale } from '@/src/lib/updateChecker';
import { colors } from '@/src/theme';

// Background tasks must be defined at module scope so the OS can invoke
// them even when no UI is mounted.
defineBackgroundUpdateTask();

export default function RootLayout() {
  return (
    <Suspense fallback={<DatabaseLoading />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDb} useSuspense>
        <StatusBar style="light" />
        <UpdateScheduler />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </SQLiteProvider>
    </Suspense>
  );
}

/**
 * Registers the twice-daily background check, routes notification taps to
 * the Upcoming screen, and — because the OS may throttle background work —
 * runs a silent catch-up check on app open when the last check is stale.
 */
function UpdateScheduler() {
  const db = useSQLiteContext();

  useEffect(() => {
    registerBackgroundUpdates();
    return setupNotificationHandling((url) => {
      if (url === '/upcoming') router.push('/(tabs)/upcoming');
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await isCheckStale(db))) return;
        const result = await checkForShowUpdates(db, {
          limit: 30,
          shouldCancel: () => cancelled,
        });
        if (!cancelled) await notifyNewEpisodes(result.newEpisodes);
      } catch {
        // Foreground catch-up is best-effort; the manual button surfaces errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  return null;
}

function DatabaseLoading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
