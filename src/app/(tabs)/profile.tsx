import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Screen } from '@/src/components/Screen';
import { SectionHeader } from '@/src/components/SectionHeader';
import { enrichMissingMetadata, type EnrichProgress } from '@/src/lib/enrichment';
import {
  buildEpisodesCsv,
  buildMediaItemsCsv,
  buildTxtSummary,
  deliverFile,
  exportFilename,
} from '@/src/lib/exporter';
import { saveTvTimeImport, type ImportResult } from '@/src/lib/importer';
import { getAppStats, listImportFiles, type AppStats } from '@/src/lib/queries';
import {
  getBackgroundUpdatesStatus,
  type BackgroundUpdatesStatus,
} from '@/src/lib/backgroundUpdates';
import {
  getNotificationPermission,
  notifyNewEpisodes,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/src/lib/notifications';
import { fetchSeries, tvdbLogin, TvdbError } from '@/src/lib/tvdb';
import {
  checkForShowUpdates,
  getUpdateCheckStatus,
  type UpdateCheckProgress,
  type UpdateCheckStatusInfo,
} from '@/src/lib/updateChecker';
import {
  parseTvTimeExport,
  TvTimeParseError,
  type ParsedTvTimeExport,
} from '@/src/lib/tvtimeParser';
import { colors, radius, spacing, typography } from '@/src/theme';
import type { ImportFile } from '@/src/types';

interface PendingImport {
  parsed: ParsedTvTimeExport;
  file: { name: string; uri: string | null; size: number | null };
}

/** Reads the picked document as text on native (expo-file-system) and web. */
async function readAssetText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    if (asset.file) return asset.file.text();
    const response = await fetch(asset.uri);
    return response.text();
  }
  return new File(asset.uri).text();
}

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const [imports, setImports] = useState<ImportFile[]>([]);
  const [busy, setBusy] = useState<'picking' | 'saving' | 'exporting' | 'tvdb' | null>(null);
  const [enrich, setEnrich] = useState<EnrichProgress | null>(null);
  const cancelEnrich = useRef(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckProgress | null>(null);
  const cancelUpdateCheck = useRef(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatusInfo | null>(null);
  const [bgStatus, setBgStatus] = useState<BackgroundUpdatesStatus | null>(null);
  const [notifStatus, setNotifStatus] = useState<NotificationPermission | null>(null);

  const refreshUpdateInfo = useCallback(async () => {
    const [status, bg, notif] = await Promise.all([
      getUpdateCheckStatus(db),
      getBackgroundUpdatesStatus(),
      getNotificationPermission(),
    ]);
    setUpdateStatus(status);
    setBgStatus(bg);
    setNotifStatus(notif);
  }, [db]);

  useEffect(() => {
    refreshUpdateInfo();
  }, [refreshUpdateInfo]);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<AppStats | null>(null);

  const refreshImports = useCallback(async () => {
    setImports(await listImportFiles(db));
  }, [db]);

  useEffect(() => {
    refreshImports();
  }, [refreshImports]);

  const pickTvTimeExport = useCallback(async () => {
    setBusy('picking');
    setError(null);
    setLastResult(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/html', 'application/xhtml+xml'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0]!;
      const html = await readAssetText(asset);
      const parsed = parseTvTimeExport(html);
      setPending({
        parsed,
        file: { name: asset.name, uri: asset.uri ?? null, size: asset.size ?? null },
      });
    } catch (err) {
      setError(
        err instanceof TvTimeParseError
          ? err.message
          : `Could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const onExportCsv = useCallback(async () => {
    setBusy('exporting');
    setError(null);
    setNotice(null);
    try {
      const mediaCsv = await buildMediaItemsCsv(db);
      await deliverFile(exportFilename('export', 'csv'), mediaCsv, 'text/csv');
      const episodesCsv = await buildEpisodesCsv(db);
      if (episodesCsv) {
        await deliverFile(exportFilename('export-episodes', 'csv'), episodesCsv, 'text/csv');
      }
      setNotice(
        episodesCsv
          ? 'Exported two CSV files: media items and episodes.'
          : 'Exported the media items CSV.',
      );
    } catch (err) {
      setError(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [db]);

  const onExportTxt = useCallback(async () => {
    setBusy('exporting');
    setError(null);
    setNotice(null);
    try {
      const summary = await buildTxtSummary(db);
      await deliverFile(exportFilename('summary', 'txt'), summary, 'text/plain');
      setNotice('Exported the TXT summary.');
    } catch (err) {
      setError(`TXT export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [db]);

  const onShowStats = useCallback(async () => {
    setStats(await getAppStats(db));
  }, [db]);

  const onTestTvdb = useCallback(async () => {
    setBusy('tvdb');
    setError(null);
    setNotice(null);
    try {
      await tvdbLogin(db);
      const sample = await db.getFirstAsync<{ tvdb_id: number; title: string }>(
        "SELECT tvdb_id, title FROM media_items WHERE media_type = 'show' ORDER BY title LIMIT 1",
      );
      if (!sample) {
        setNotice('TVDB login OK. Import your TV Time data to test a show lookup.');
        return;
      }
      const info = await fetchSeries(db, sample.tvdb_id);
      setNotice(
        `TVDB API works. Logged in and fetched TVDB ID ${sample.tvdb_id}: "${info.name ?? sample.title}"${info.year ? ` (${info.year})` : ''}.`,
      );
    } catch (err) {
      setError(err instanceof TvdbError ? err.message : `TVDB test failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [db]);

  const onFetchMetadata = useCallback(async () => {
    setError(null);
    setNotice(null);
    cancelEnrich.current = false;
    try {
      const result = await enrichMissingMetadata(db, {
        onProgress: setEnrich,
        shouldCancel: () => cancelEnrich.current,
      });
      setNotice(
        `Metadata fetch ${cancelEnrich.current ? 'stopped' : 'finished'}: ${result.updated} updated, ${result.failed} failed, ${result.skipped} skipped (no TVDB record), ${result.needsReview} need review, of ${result.total} total. ${result.failed > 0 ? 'Tap again to retry failed items.' : ''}`,
      );
    } catch (err) {
      setError(err instanceof TvdbError ? err.message : `Metadata fetch failed: ${String(err)}`);
    } finally {
      setEnrich(null);
    }
  }, [db]);

  const onCheckUpdates = useCallback(async () => {
    setError(null);
    setNotice(null);
    cancelUpdateCheck.current = false;
    try {
      const result = await checkForShowUpdates(db, {
        onProgress: setUpdateCheck,
        shouldCancel: () => cancelUpdateCheck.current,
      });
      await notifyNewEpisodes(result.newEpisodes);
      setNotice(
        result.totalShows === 0
          ? 'No shows have TVDB episode catalogs yet — run Fetch Missing Metadata first.'
          : `Update check ${cancelUpdateCheck.current ? 'stopped' : 'finished'}: ${result.checkedShows} shows checked, ${result.newEpisodes} new episodes found, ${result.failedShows} failed.${result.failedShows > 0 ? ' Tap again to retry.' : ''}`,
      );
    } catch (err) {
      setError(err instanceof TvdbError ? err.message : `Update check failed: ${String(err)}`);
    } finally {
      setUpdateCheck(null);
      await refreshUpdateInfo();
    }
  }, [db, refreshUpdateInfo]);

  const onRequestNotifications = useCallback(async () => {
    setNotifStatus(await requestNotificationPermission());
  }, []);

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    setBusy('saving');
    setError(null);
    try {
      const result = await saveTvTimeImport(db, pending.parsed, pending.file);
      setLastResult(result);
      setPending(null);
      await refreshImports();
    } catch (err) {
      setError(`Import failed — nothing was saved: ${err instanceof Error ? err.message : String(err)}`);
      setPending(null);
    } finally {
      setBusy(null);
    }
  }, [db, pending, refreshImports]);

  return (
    <Screen title="Profile / Settings">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <SectionHeader label="Data" />
        <View style={styles.group}>
          <Pressable
            onPress={pickTvTimeExport}
            disabled={busy !== null}
            style={({ pressed }) => [styles.importButton, pressed && styles.importButtonPressed]}
            android_ripple={{ color: colors.accentDim }}
          >
            {busy === 'picking' ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Ionicons name="cloud-upload" size={20} color={colors.onAccent} />
            )}
            <Text style={styles.importButtonText}>
              {busy === 'picking' ? 'Reading file…' : 'Import TV Time HTML'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Pick the HTML summary exported from TV Time. You will see a preview before anything is
            saved.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {lastResult ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={18} color={colors.watched} />
              <Text style={styles.successText}>
                Imported {lastResult.showsSaved} shows and {lastResult.moviesSaved} movies (
                {lastResult.watchEventsSaved} watch dates, {lastResult.episodesSaved} unwatched
                episodes). Check the Shows and Movies tabs.
              </Text>
            </View>
          ) : null}

          {notice ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={18} color={colors.watched} />
              <Text style={styles.successText}>{notice}</Text>
            </View>
          ) : null}

          <SettingRow
            icon="grid"
            label="Export CSV"
            detail={busy === 'exporting' ? 'Working…' : 'Media items + episodes'}
            disabled={busy !== null}
            onPress={onExportCsv}
          />
          <SettingRow
            icon="document-text"
            label="Export TXT"
            detail={busy === 'exporting' ? 'Working…' : 'Summary'}
            disabled={busy !== null}
            onPress={onExportTxt}
          />
          <SettingRow icon="stats-chart" label="App Statistics" onPress={onShowStats} />
        </View>

        <SectionHeader label="TVDB Metadata" />
        <View style={styles.group}>
          <SettingRow
            icon="flash"
            label="Test TVDB API"
            detail={busy === 'tvdb' ? 'Testing…' : 'Login + lookup'}
            disabled={busy !== null || enrich !== null}
            onPress={onTestTvdb}
          />
          <SettingRow
            icon="images"
            label="Fetch Missing Metadata"
            detail="Posters, descriptions, episodes"
            disabled={busy !== null || enrich !== null}
            onPress={onFetchMetadata}
          />
          <Text style={styles.hint}>
            Uses your TVDB API key from .env (EXPO_PUBLIC_TVDB_API_KEY). Imported data and your
            watch history are never overwritten.
          </Text>
        </View>

        <SectionHeader label="Updates" />
        <View style={styles.group}>
          <SettingRow
            icon="refresh"
            label="Check for Updates Now"
            detail="New episodes from TVDB"
            disabled={busy !== null || enrich !== null || updateCheck !== null}
            onPress={onCheckUpdates}
          />
          <SettingRow
            icon="sync"
            label="Background updates"
            detail={
              bgStatus === 'registered'
                ? 'On · ~twice daily'
                : bgStatus === 'restricted'
                  ? 'Restricted by OS'
                  : 'Unavailable · runs on app open'
            }
          />
          <SettingRow
            icon="time"
            label="Last check"
            detail={
              updateStatus?.lastCheckAt
                ? new Date(updateStatus.lastCheckAt).toLocaleString()
                : 'never'
            }
          />
          <SettingRow
            icon="sparkles"
            label="New episodes in last check"
            detail={String(updateStatus?.lastCheckNewEpisodes ?? 0)}
          />
          <SettingRow
            icon="notifications"
            label="Notifications"
            detail={
              notifStatus === 'granted'
                ? 'Allowed'
                : notifStatus === 'denied'
                  ? 'Denied · updates stay silent'
                  : notifStatus === 'undetermined'
                    ? 'Tap to allow'
                    : 'Unavailable on this platform'
            }
            onPress={notifStatus === 'undetermined' ? onRequestNotifications : undefined}
          />
        </View>

        {imports.length > 0 ? (
          <>
            <SectionHeader label="Import history" count={imports.length} />
            <View style={styles.group}>
              {imports.map((file) => (
                <View key={file.id} style={styles.importRow}>
                  <Ionicons
                    name={file.status === 'parsed' ? 'checkmark-circle' : 'document-text'}
                    size={18}
                    color={file.status === 'parsed' ? colors.watched : colors.accent}
                  />
                  <View style={styles.importRowInfo}>
                    <Text style={styles.importRowName} numberOfLines={1}>
                      {file.file_name}
                    </Text>
                    <Text style={styles.importRowMeta}>
                      {file.shows_count ?? 0} shows · {file.movies_count ?? 0} movies ·{' '}
                      {file.status} · {file.imported_at}
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
          <SettingRow icon="information-circle" label="Version" detail="1.0.0 · Phase 5" />
        </View>
      </ScrollView>

      <ImportPreviewModal
        pending={pending}
        saving={busy === 'saving'}
        onCancel={() => setPending(null)}
        onConfirm={confirmImport}
      />
      <StatsModal stats={stats} onClose={() => setStats(null)} />
      <EnrichModal progress={enrich} onCancel={() => (cancelEnrich.current = true)} />
      <UpdateCheckModal
        progress={updateCheck}
        onCancel={() => (cancelUpdateCheck.current = true)}
      />
    </Screen>
  );
}

function EnrichModal({
  progress,
  onCancel,
}: {
  progress: EnrichProgress | null;
  onCancel: () => void;
}) {
  if (!progress) return null;
  const rows: [string, string | number][] = [
    ['Total items', progress.total],
    ['Processed', progress.processed],
    ['Updated', progress.updated],
    ['Failed', progress.failed],
    ['Skipped (no TVDB record)', progress.skipped],
    ['Needs review', progress.needsReview],
  ];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Fetching metadata…</Text>
          <Text style={styles.modalFile} numberOfLines={1}>
            {progress.currentTitle ?? 'Preparing…'}
          </Text>
          <View style={styles.statsGrid}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.statRow}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.modalButtons}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.cancelButtonText}>Stop after current item</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StatsModal({ stats, onClose }: { stats: AppStats | null; onClose: () => void }) {
  if (!stats) return null;
  const rows: [string, string | number][] = [
    ['Total shows', stats.totalShows],
    ['Total movies', stats.totalMovies],
    ['Watched movies', stats.watchedMovies],
    ['Unwatched movies', stats.unwatchedMovies],
    ['Favorite shows', stats.favoriteShows],
    ['Favorite movies', stats.favoriteMovies],
    ['Completed shows', stats.completedShows],
    ['In-progress shows', stats.inProgressShows],
    ['Not started shows', stats.notStartedShows],
    ['Watch events', stats.watchEventsCount],
    ['Last import', stats.lastImportDate ?? 'never'],
  ];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>App Statistics</Text>
          <View style={[styles.statsGrid, { marginTop: spacing.md }]}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.statRow}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.modalButtons}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && { backgroundColor: colors.accentDim },
              ]}
            >
              <Text style={styles.confirmButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ImportPreviewModal({
  pending,
  saving,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  const s = pending.parsed.summary;
  const rows: [string, number][] = [
    ['Total shows', s.totalShows],
    ['Total movies', s.totalMovies],
    ['Watched movies', s.watchedMovies],
    ['Favorite shows', s.favoriteShows],
    ['Favorite movies', s.favoriteMovies],
    ['Continuing shows', s.continuingShows],
    ['Up-to-date shows', s.upToDateShows],
    ['Stopped shows', s.stoppedShows],
    ['Not started shows', s.notStartedShows],
  ];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Import preview</Text>
          <Text style={styles.modalFile} numberOfLines={1}>
            {pending.file.name}
          </Text>

          <View style={styles.statsGrid}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.statRow}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
            {s.skippedEntries > 0 ? (
              <View style={styles.statRow}>
                <Text style={[styles.statLabel, { color: colors.danger }]}>
                  Skipped invalid entries
                </Text>
                <Text style={[styles.statValue, { color: colors.danger }]}>
                  {s.skippedEntries}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.modalNote}>Nothing is saved until you confirm.</Text>

          <View style={styles.modalButtons}>
            <Pressable
              onPress={onCancel}
              disabled={saving}
              style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={saving}
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && { backgroundColor: colors.accentDim },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Text style={styles.confirmButtonText}>Confirm Import</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function UpdateCheckModal({
  progress,
  onCancel,
}: {
  progress: UpdateCheckProgress | null;
  onCancel: () => void;
}) {
  if (!progress) return null;
  const rows: [string, string | number][] = [
    ['Shows to check', progress.totalShows],
    ['Checked', progress.checkedShows],
    ['New episodes found', progress.newEpisodes],
    ['Failed', progress.failedShows],
  ];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Checking for updates…</Text>
          <Text style={styles.modalFile} numberOfLines={1}>
            {progress.currentTitle ?? 'Preparing…'}
          </Text>
          <View style={styles.statsGrid}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.statRow}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.modalButtons}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.cancelButtonText}>Stop after current show</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SettingRow({
  icon,
  label,
  detail,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={[styles.row, disabled && styles.rowDisabled]}
      android_ripple={onPress ? { color: colors.border } : undefined}
    >
      <Ionicons name={icon} size={18} color={disabled ? colors.textMuted : colors.accent} />
      <Text style={styles.rowLabel}>{label}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </Pressable>
  );
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
  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(229,72,77,0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    lineHeight: 17,
  },
  successBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(61,208,126,0.10)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.watched,
    padding: spacing.md,
  },
  successText: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    lineHeight: 17,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 20,
    color: colors.accent,
  },
  modalFile: {
    ...typography.caption,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  statsGrid: {
    gap: spacing.xs,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  statLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
  modalNote: {
    ...typography.caption,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    ...typography.body,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onAccent,
  },
});
