import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { recordImportFile } from '@/src/lib/db';
import { colors, radius, spacing, typography } from '@/src/theme';
import type { ImportFile } from '@/src/types';

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const [imports, setImports] = useState<ImportFile[]>([]);
  const [picking, setPicking] = useState(false);

  const refreshImports = useCallback(async () => {
    const rows = await db.getAllAsync<ImportFile>(
      'SELECT * FROM import_files ORDER BY imported_at DESC LIMIT 10',
    );
    setImports(rows);
  }, [db]);

  useEffect(() => {
    refreshImports();
  }, [refreshImports]);

  const pickTvTimeExport = useCallback(async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/html', 'application/xhtml+xml'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0]!;
      // Keep a copy in the app's documents so the Phase 2 parser can read it
      // even after the picker cache is cleared.
      let storedUri: string | null = asset.uri;
      try {
        const importsDir = new Directory(Paths.document, 'imports');
        if (!importsDir.exists) importsDir.create({ intermediates: true });
        const dest = new File(importsDir, `${Date.now()}-${asset.name}`);
        new File(asset.uri).copy(dest);
        storedUri = dest.uri;
      } catch {
        // Fall back to the picker's cache URI; Phase 2 re-prompts if missing.
      }

      await recordImportFile(db, {
        name: asset.name,
        uri: storedUri,
        size: asset.size ?? null,
      });
      await refreshImports();

      Alert.alert(
        'File saved',
        `"${asset.name}" is queued for import. Parsing your TV Time history lands in the next update — the file is safely stored until then.`,
      );
    } catch (error) {
      Alert.alert('Could not read file', error instanceof Error ? error.message : String(error));
    } finally {
      setPicking(false);
    }
  }, [db, refreshImports]);

  return (
    <Screen title="Profile / Settings">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <SectionHeader label="Data" />
        <View style={styles.group}>
          <Pressable
            onPress={pickTvTimeExport}
            disabled={picking}
            style={({ pressed }) => [styles.importButton, pressed && styles.importButtonPressed]}
            android_ripple={{ color: colors.accentDim }}
          >
            <Ionicons name="cloud-upload" size={20} color={colors.onAccent} />
            <Text style={styles.importButtonText}>
              {picking ? 'Opening picker…' : 'Import TV Time HTML'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Pick the HTML summary exported from TV Time. Full parsing is coming in the next
            update; for now the file is stored and queued.
          </Text>

          <SettingRow icon="download" label="Export TXT / CSV" detail="Later phase" disabled />
        </View>

        <SectionHeader label="Library updates" />
        <View style={styles.group}>
          <SettingRow
            icon="refresh"
            label="Check for new episodes"
            detail="Twice daily · later phase"
            disabled
          />
          <SettingRow icon="image" label="Posters & descriptions" detail="Later phase" disabled />
        </View>

        {imports.length > 0 ? (
          <>
            <SectionHeader label="Queued imports" count={imports.length} />
            <View style={styles.group}>
              {imports.map((file) => (
                <View key={file.id} style={styles.importRow}>
                  <Ionicons name="document-text" size={18} color={colors.accent} />
                  <View style={styles.importRowInfo}>
                    <Text style={styles.importRowName} numberOfLines={1}>
                      {file.file_name}
                    </Text>
                    <Text style={styles.importRowMeta}>
                      {formatSize(file.file_size)} · {file.status}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <SectionHeader label="About" />
        <View style={styles.group}>
          <SettingRow icon="server" label="Storage" detail="Local SQLite only — no account" />
          <SettingRow icon="information-circle" label="Version" detail="1.0.0 · Phase 1" />
        </View>
      </ScrollView>
    </Screen>
  );
}

function SettingRow({
  icon,
  label,
  detail,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <Ionicons name={icon} size={18} color={disabled ? colors.textMuted : colors.accent} />
      <Text style={styles.rowLabel}>{label}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </View>
  );
}

function formatSize(bytes: number | null): string {
  if (!bytes) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  importButtonPressed: {
    backgroundColor: colors.accentDim,
  },
  importButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onAccent,
  },
  hint: {
    ...typography.caption,
    lineHeight: 17,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowLabel: {
    ...typography.body,
    flex: 1,
  },
  rowDetail: {
    ...typography.caption,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  importRowInfo: {
    flex: 1,
  },
  importRowName: {
    ...typography.body,
  },
  importRowMeta: {
    ...typography.caption,
  },
});
