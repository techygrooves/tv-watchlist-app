# TV Watchlist

An Android-first TV Time replacement built with Expo React Native, TypeScript, and local SQLite. Track shows and movies, mark episodes watched, and import your existing TV Time history — no backend, no account, all data stays on the device.

## Tech stack

- Expo SDK 54 / React Native 0.81 (TypeScript)
- expo-router file-based navigation (bottom tabs)
- expo-sqlite for local storage (WAL mode, versioned migrations)
- expo-document-picker + expo-file-system for TV Time HTML import

## Running the app

```bash
npm install
npm start          # Expo dev server; press "a" for Android, or scan the QR with Expo Go
npm run android    # start and open directly on a connected Android device/emulator
npm run typecheck  # TypeScript check
```

## Project structure

```
app/                  expo-router routes
  _layout.tsx         root layout: SQLite provider + DB migration on boot
  (tabs)/             bottom tab navigator
    index.tsx         Shows
    movies.tsx        Movies
    explore.tsx       Explore (search later)
    upcoming.tsx      Upcoming episodes
    settings.tsx      Profile / Settings + TV Time HTML import
src/
  theme.ts            dark theme with gold accent
  types.ts            domain types mirroring the DB schema
  db/schema.ts        SQLite DDL (media_items, episodes, watch_events, import_files, app_settings)
  db/database.ts      migrations + query helpers
  components/         PosterCard, ProgressBar, Screen, SectionHeader, EmptyState
  data/placeholders.ts placeholder list data for Phase 1
```

## Data model

The TVDB numeric ID is the canonical external identifier for every show and movie — rows in `media_items` are unique on `(tvdb_id, media_type)`, never on title. `watch_events` is an append-only log (undo removes the latest event), so `watched_at` history is preserved exactly.

## Roadmap

- **Phase 1 (done):** app shell, bottom tabs, dark UI, SQLite schema, import button UI
- **Phase 2:** parse the TV Time HTML export into SQLite; real lists driven by the DB
- **Phase 3:** watched/unwatched toggling with undo, favorites, add/remove from watchlist
- **Phase 4:** TVDB search in Explore, posters and descriptions, twice-daily episode update checks
- **Phase 5:** TXT/CSV export
