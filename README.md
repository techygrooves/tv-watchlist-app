# TV Watchlist

An Android-first TV Time replacement built with Expo React Native, TypeScript, and local SQLite. Import your TV Time history, track shows episode-by-episode and movies as single items, enrich everything with TVDB metadata, and get notified when new episodes air — no backend, no account, all data stays on the device.

## Features

- **TV Time HTML import** with preview-before-save (parses the embedded SHOWS/MOVIES data, never scrapes the visual table)
- **Shows as parent items, episodes as individual checklist items** grouped by season; movies as single checklist items
- Watched/unwatched toggles with undo, ISO timestamps, and an append-only `watch_events` log
- Search, filters, and progress bars on Shows and Movies
- **TVDB integration** (official v4 API): posters, descriptions, full episode catalogs, air dates
- **Twice-daily background update checks** with local notifications for new episodes, plus on-open catch-up and a manual check button
- Upcoming screen with All / Upcoming / Aired-but-unwatched / Recently-added filters
- CSV export (media items + episodes) and TXT summary export
- App statistics from real SQLite counts

## Setup

```bash
npm install
cp .env.example .env    # then put your TVDB v4 API key in .env
npm start               # press "a" for Android, or open http://localhost:8081 for web
```

### Environment variables

The app needs one variable, read at build/dev-server start:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_TVDB_API_KEY` | TVDB v4 API key used for metadata, episode catalogs, and update checks. Get one at <https://www.thetvdb.com/api-information>. |

- **Locally:** put it in `.env` in the project root (see `.env.example`). `.env` is gitignored — never commit it. Restart the dev server (`npx expo start -c`) after changing it.
- **EAS Build:** the key is not in the repo, so provide it to the build securely — either add it as an EAS environment variable (`eas env:create --name EXPO_PUBLIC_TVDB_API_KEY --value <key>` or via the Expo dashboard, visibility "Sensitive"), or pass it per-build. `EXPO_PUBLIC_*` values are embedded in the app bundle at build time.
- The key is never hardcoded; without it the app still works fully offline (import, tracking, exports) and TVDB features show a clear "missing key" message.

## Building an APK

`eas.json` ships with a `preview` profile that produces an installable APK:

```bash
npm install -g eas-cli
eas login
eas build --profile preview --platform android
```

Android package: `com.techygrooves.tvwatchlist`.

For local development builds (needed to test notifications and background tasks — Expo Go does not support them):

```bash
npx expo run:android
```

## Scripts

```bash
npm start          # Expo dev server
npm run android    # start on a connected Android device/emulator
npm run typecheck  # TypeScript check
```

## Project structure

```
src/
  app/                    expo-router routes
    _layout.tsx           SQLite provider, migrations, background-task setup
    (tabs)/               Shows · Movies · Explore · Upcoming · Profile
    show/[id].tsx         show detail: poster, overview, episode checklist
  lib/
    db.ts                 SQLite schema (versioned migrations, PRAGMA user_version)
    tvtimeParser.ts       TV Time HTML export parser
    importer.ts           transactional import with upserts
    tvdb.ts               TVDB v4 API service (login, token, typed errors)
    enrichment.ts         metadata + episode-catalog fetch with reconciliation
    updateChecker.ts      new-episode checker (manual, on-open, background)
    backgroundUpdates.ts  expo-background-task registration (~12h interval)
    notifications.ts      local notifications (permission-aware, web no-op)
    watchActions.ts       watched/unwatched actions + undo snapshots
    exporter.ts           CSV/TXT builders + share/download
    queries.ts            list/filter/stats queries
  components/             PosterCard, ProgressBar, SearchBar, FilterChips, …
  theme/                  dark palette with gold accent
```

## Data model

The TVDB numeric ID is the canonical external identifier — `media_items` rows are keyed `show:{tvdbId}` / `movie:{tvdbId}` and unique on `(tvdb_id, media_type)`, never on title. `raw_json` preserves every imported record verbatim. `watch_events` is append-only; undo restores state and logs the reversal. Imported watch dates are never overwritten and historical episode dates are never invented.

## Known limitations

- The TV Time export lists only *unwatched* episodes; watched history has counts but no per-episode dates. The UI says so instead of inventing data.
- Background checks run at the OS's discretion (WorkManager); the app also checks on open when the last check is older than 12h.
- Notifications and background tasks require a development build or production APK — they do not work in Expo Go or on web.
