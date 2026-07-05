import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DATABASE_NAME, migrateDb } from '@/src/lib/db';
import { colors } from '@/src/theme';

export default function RootLayout() {
  return (
    <Suspense fallback={<DatabaseLoading />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDb} useSuspense>
        <StatusBar style="light" />
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
