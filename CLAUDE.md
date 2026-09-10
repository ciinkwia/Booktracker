# My Library

> **⚠️ INSTRUCTION TO CLAUDE:** This file is the source of truth for the project. **Any time we make a meaningful change to My Library — new feature, architectural decision, deploy gotcha, dependency change, file restructure, schema change, or hard-won bug fix — you must update this CLAUDE.md before considering the task done.** Treat it as part of the deliverable. Bump the "Last updated" date at the bottom every time you edit it. If you're unsure whether something is worth recording, record it.

> **Note on naming:** The user-facing app name is **My Library**. The GitHub repo is still `BookTracker`, the local folder is still `BookTracker/`, the IndexedDB is still `BookTrackerDB`, and the Firebase project is still `booktracker-574a6` — these are *identifiers tied to live data* and renaming them would orphan users' books. Do not rename them.

---

A vanilla-JS PWA for tracking books across three lists: **Want to Read**, **Read**, and **My Library** (own). Supports search via Google Books and Open Library, custom categories, ratings, notes, offline-first storage, and cloud sync via Firebase.

**Owner:** ciinkwia (jarridbaldwin@gmail.com)
**Stack:** Plain HTML/CSS/JS, no framework, no build step.

---

## Architecture

```
Browser (PWA, mobile-first)
   │
   ├── Service Worker (sw.js) — network-first for app code, cache-first for icons,
   │     network-only for Firebase/Google APIs, special covers cache (max 200)
   │
   ├── IndexedDB (BookTrackerDB v2) — primary local store
   │     ├── books store: keyPath 'id', indexes on 'list' and 'dateAdded'
   │     └── settings store: keyPath 'key' (used for 'categories')
   │
   ├── Firebase (booktracker-574a6) — optional cloud sync if signed in
   │     ├── Auth (Google popup, falls back to redirect)
   │     └── Firestore: users/{uid}/books/{docId} + users/{uid}/settings/app
   │
   └── External APIs (called from browser, IN PARALLEL)
         ├── Google Books — best for brand-new titles + covers; keyless = per-IP quota, can 429
         └── Open Library — community catalog, popularity signals, English-edition titles
```

**Local-first design:** all reads/writes hit IndexedDB; Firebase sync is best-effort and bidirectional.

---

## Key files

- `index.html` — single-page app shell. Loads Firebase compat SDKs from CDN, then `js/db.js` → `js/firebase.js` → `js/api.js` → `js/ui.js` → `js/app.js`.
- `manifest.json` — PWA manifest. Theme color + background `#0D0D16` (navy, matches the header so the status bar blends in).
- `sw.js` — service worker. Cache name is **`mylibrary-v19`** — bump this version any time you ship code changes so clients pick them up. Also owns a `mylibrary-fonts-v1` cache (Google Fonts, cache-first).
- `server.js` — trivial 60-line static file server on port 8080 for local dev (`node server.js`). Not used in production.
- `js/db.js` — `window.BookDB`. IndexedDB wrapper. CRUD on books + categories. Every write also calls `syncToFirebase()` if signed in. Includes `bookExists` fuzzy match (id, then title+first-author fallback) to avoid duplicates with different ids.
- `js/firebase.js` — `window.BookFirebase`. Firebase init, auth (Google popup→redirect fallback), `onSnapshot` listener for real-time cloud→local sync, `saveBook`/`removeBook`/`saveSettings`. Firestore doc id sanitizer replaces `/` with `_`.
- `js/api.js` — `window.BookAPI`. The search engine (see "API search" below): queries Google Books + Open Library in parallel, drops junk, collapses duplicate editions, ranks. Exposes `search(q) → {items, stats}`, `isISBN`, `matchKey(title, authors)` (the same key `app.js` uses to flag "already in library"). Google ids get `gbooks:` prefix; Open Library get `ol:`.
- `js/ui.js` — DOM rendering for book lists, modals, search results, category manager, toasts, sync bar.
- `js/app.js` — main controller. Wires up event listeners, manages tab switching, search debouncing (400ms), sign-in flow, and the **sync orchestration state machine** (see gotchas).
- `css/styles.css` — dark theme, mobile-first. 2026-09 refresh: deep navy `#0D0D16` + violet glow, glassy blurred header/nav, gradient accent, Fraunces serif (Google Fonts) for the title / detail title / category headers / empty states, cover drop-shadows, pill tab indicator, gold stars.
- `icons/` — PWA icons (192, 512).

---

## Data shapes

### Book (IndexedDB + Firestore)
```js
{
  id: 'gbooks:abc123' | 'ol:OL12345W',  // namespaced; '/' is sanitized to '_' in Firestore
  title: string,
  authors: string[],
  isbn: string | null,
  coverUrl: string | null,
  publishYear: number | null,
  pageCount: number | null,
  list: 'wantToRead' | 'read' | 'own',
  dateAdded: number,                    // ms epoch
  notes?: string,
  rating?: number,
  categories?: string[]
}
```

### Categories
Stored in IndexedDB `settings` store under key `'categories'` and Firestore at `users/{uid}/settings/app.categories`. Default seed:
```
Autobiography, Biography, Science, Economics,
Business: General, Fiction, History: General, Philosophy
```

---

## Sync orchestration (the tricky part)

In `js/app.js`, two flags guard sync:
- `syncInProgress` — true while we're actively writing to IndexedDB or Firebase
- `initialSyncDone` — false until the first sign-in merge has completed

**On sign-in (`handleSignedIn`):**
1. Pull categories from cloud, write locally (or upload local if cloud empty).
2. Merge books — pull cloud books, replace local DB. If cloud is empty but local has books, upload local instead.
3. Set `initialSyncDone = true`, clear `syncInProgress`.

**Real-time sync (`onSync` snapshot listener):**
- Ignored entirely until `initialSyncDone` is true (prevents an early snapshot from clobbering local data mid-merge).
- Ignored while `syncInProgress` is true (prevents echo of our own writes).
- **Safety:** an empty cloud snapshot is *ignored* if local has any books. This guards against transient Firestore eventual-consistency hiccups wiping the user's data.

**Don't simplify this state machine without understanding why each guard exists** — they were each added to fix a real data-loss bug.

---

## API search (rewritten 2026-09-09)

`BookAPI.search(query)` returns `{ items, stats }` where `stats = { raw, junk, duplicates, shown, failedSources }`.

1. Detects ISBN (10 or 13 digits with optional dashes/spaces).
2. Fires **Google Books (40 results) and Open Library (30 results) at the same time**. If one fails the other still answers; only if both fail does it reject. Open Library is called with `lang=en` + the `editions` sub-doc so we get the *English edition's* title/cover/ISBN (work titles are often in the original language — "Siete breves lecciones de física").
3. Normalizes both into candidates `{source, rank, id, title, subtitle, authors, isbn, coverUrl, publishYear, pageCount, language, popularity}`.
4. **Junk filter** — drops summaries, workbooks, study guides, box sets, "N-copy counter display", "Resumen de…" etc. (`JUNK_TITLE` / `JUNK_AUTHOR` regexes). Skipped for ISBN lookups, and a junk word is allowed if the user typed it themselves.
5. **Relevance score** per candidate: exact title-key match (+4) / prefix / contains, coverage of the typed words in title+author (stopwords ignored; <50% coverage = heavy penalty), source rank, log-scaled popularity (Google `ratingsCount`, OL `readinglog_count`/`want_to_read_count`/`ratings_count`/`edition_count`), cover/ISBN/English bonuses, non-English penalty.
6. **Dedupe** — candidates are grouped by `matchKey` = `titleKey(title) + '|' + authorKey(authors)` (lowercase, accents stripped, subtitle after `:`/dash removed, bracketed text removed, leading article removed, edition words like "anniversary/revised/large print" removed; author = folded last name of first author) **or** by identical ISBN-13. Each group collapses to its best edition (cover > English > ISBN-13 > page count > Google), gaps filled from siblings, publish year = earliest in the group, score = group max + small bonus for many editions.
7. Sorts, then cuts the long tail: anything below 45% of the top score (always keeps top 3), max 20.
8. `app.js` shows the count as "N books · M duplicates hidden" (M = junk + collapsed).

**Google quota:** keyless Google Books calls share a per-IP daily quota and return 429 when it's blown (happened on the dev PC 2026-09-09). The app keeps working on Open Library alone. `GOOGLE_BOOKS_KEY` in `api.js` is empty on purpose — the Firebase web key returns 403 until "Books API" is enabled on the `booktracker-574a6` GCP project. Enable it in the console, paste the key, and the quota jumps to 1,000/day.

**Search race guard:** `app.js` keeps a `searchSeq` counter; a response is ignored if a newer search started while it was in flight.

---

## Service worker fetch strategy

- **Firebase / Google API hosts** (`googleapis.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `accounts.google.com`, `*.firebaseio.com`, `*.firebaseapp.com`, `www.gstatic.com`, `apis.google.com`, `openlibrary.org`) → **passthrough, no SW handling**. Critical — never cache auth or API traffic.
- **Web fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) → cache first into `mylibrary-fonts-v1`, so the serif still shows offline after the first load.
- **Cover images** (`books.google.com`, `covers.openlibrary.org`) → network first, cache fallback. Trimmed to `MAX_COVERS = 200` LRU-ish.
- **App code** (HTML/CSS/JS, root paths) → network first, cache fallback. This ensures online users always get fresh code.
- **Other static assets** → cache first, network fallback.

---

## Deploy

**Live:** GitHub Pages at https://ciinkwia.github.io/Booktracker/ — serves the **`main`** branch, root path, legacy build (no Actions). This is the installed PWA on ciinkwia's phone.

**Branches:** one branch, `main`, local and remote. (Until 2026-09-09 local work sat on an unrelated `master`; it was force-pushed over `main` and deleted that day.) To deploy:

```bash
git push
```

Only when ciinkwia says "deploy" (his standing rule). Bump `CACHE_NAME` in `sw.js` first. Pages picks it up within a minute or two; the phone gets the new code on its next open after the service worker updates.

**Local dev:** `node server.js` → http://localhost:8080. The root `AI Projects/.claude/launch.json` has a `my-library` entry for the in-app browser preview.

---

## Gotchas / things to know

### 1. Bump `CACHE_NAME` in sw.js when shipping JS/CSS/HTML changes
Currently `mylibrary-v19`. If you don't bump it, the old service worker may serve stale files even though the fetch strategy is network-first (because `cache.put` only updates a successful response — but the activate phase does cache cleanup keyed on the version).

### 2. Firestore doc IDs can't contain `/`
Book ids like `ol:/works/OL12345W` would break. `BookFirebase.sanitizeId` replaces `/` with `_` before reading/writing Firestore. Don't bypass this.

### 3. Don't trust empty cloud snapshots
The sync code in `js/app.js` explicitly ignores an empty `onSnapshot` payload if local has books. This was a real bug — Firestore can momentarily return zero docs during reconnect, and without this guard the app would wipe the user's library.

### 4. `bookExists` does a title+author fallback
Same book from Google Books vs Open Library has different ids. `db.js > bookExists` first checks by id, then falls back to a case-insensitive title + first-author match. Keep this when adding new id sources or you'll get duplicates. Search results use the stricter `BookAPI.matchKey` (handles subtitles, editions, accents) to show the green "already on list" badge — one `getAllBooks()` per search, not one per result.

### 7. Google Books can 429 at any time
Keyless quota is per IP. Never make Google the only source again — the parallel fetch in `api.js` is what keeps search alive when it happens.

### 5. Firestore offline persistence is enabled
`db.enablePersistence({ synchronizeTabs: true })` runs at init. If multiple tabs are open the second tab will see a console warning — that's expected.

### 6. Auth uses popup with redirect fallback
`signInWithPopup` first; on `auth/popup-blocked`, `auth/popup-closed-by-user`, or `auth/cancelled-popup-request`, falls back to `signInWithRedirect`. The same SolarJournal storage-partitioning issue could in theory bite us here too (if the app domain ever differs from the Firebase authDomain), but currently the app is only run from `localhost` / its eventual production domain, so it hasn't surfaced.

---

## Coding conventions

- Vanilla ES5-ish JS, IIFE modules attached to `window` (`window.BookDB`, `window.BookFirebase`, `window.BookAPI`). No `import`/`export`, no build step.
- Mobile-first, dark theme, accent `#6C63FF`.
- Don't add a framework or bundler unless there's a strong reason — the simplicity is the point.

---

## Pending / future ideas

(none committed — add as they come up)

---

**Last updated:** 2026-09-09 (search engine rewrite: parallel Google+Open Library, junk filter, edition dedupe, ranking; visual refresh; sw cache v19 + fonts cache; deployed to GitHub Pages; branches unified on `main`)
