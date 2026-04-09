# Booktracker ("My Library")

> **⚠️ INSTRUCTION TO CLAUDE:** This file is the source of truth for the project. **Any time we make a meaningful change to Booktracker — new feature, architectural decision, deploy gotcha, dependency change, file restructure, schema change, or hard-won bug fix — you must update this CLAUDE.md before considering the task done.** Treat it as part of the deliverable. Bump the "Last updated" date at the bottom every time you edit it. If you're unsure whether something is worth recording, record it.

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
   └── External APIs (called from browser)
         ├── Google Books — primary search
         └── Open Library — fallback search
```

**Local-first design:** all reads/writes hit IndexedDB; Firebase sync is best-effort and bidirectional.

---

## Key files

- `index.html` — single-page app shell. Loads Firebase compat SDKs from CDN, then `js/db.js` → `js/firebase.js` → `js/api.js` → `js/ui.js` → `js/app.js`.
- `manifest.json` — PWA manifest. Theme color `#6C63FF`, dark bg `#121212`.
- `sw.js` — service worker. Cache name is **`booktracker-v17`** — bump this version any time you ship code changes so clients pick them up.
- `server.js` — trivial 60-line static file server on port 8080 for local dev (`node server.js`). Not used in production.
- `js/db.js` — `window.BookDB`. IndexedDB wrapper. CRUD on books + categories. Every write also calls `syncToFirebase()` if signed in. Includes `bookExists` fuzzy match (id, then title+first-author fallback) to avoid duplicates with different ids.
- `js/firebase.js` — `window.BookFirebase`. Firebase init, auth (Google popup→redirect fallback), `onSnapshot` listener for real-time cloud→local sync, `saveBook`/`removeBook`/`saveSettings`. Firestore doc id sanitizer replaces `/` with `_`.
- `js/api.js` — `window.BookAPI`. Google Books search (primary), Open Library fallback. ISBN detection, normalization to `{id, title, authors, isbn, coverUrl, publishYear, pageCount}`. Google ids get `gbooks:` prefix; Open Library get `ol:`.
- `js/ui.js` — DOM rendering for book lists, modals, search results, category manager, toasts, sync bar.
- `js/app.js` — main controller. Wires up event listeners, manages tab switching, search debouncing (400ms), sign-in flow, and the **sync orchestration state machine** (see gotchas).
- `css/styles.css` — dark theme, mobile-first.
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

## API search

`BookAPI.search(query)`:
1. Detects ISBN (10 or 13 digits with optional dashes/spaces).
2. Tries Google Books first with `q=isbn:...` or plain `q=...`.
3. On any failure, falls back to Open Library `search.json`.
4. Both responses get normalized to the same shape with namespaced ids (`gbooks:` / `ol:`).
5. Cover URLs are upgraded to https and have `&edge=curl` stripped.

---

## Service worker fetch strategy

- **Firebase / Google API hosts** (`googleapis.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `accounts.google.com`, `*.firebaseio.com`, `*.firebaseapp.com`, `gstatic.com`, `apis.google.com`, `openlibrary.org`) → **passthrough, no SW handling**. Critical — never cache auth or API traffic.
- **Cover images** (`books.google.com`, `covers.openlibrary.org`) → network first, cache fallback. Trimmed to `MAX_COVERS = 200` LRU-ish.
- **App code** (HTML/CSS/JS, root paths) → network first, cache fallback. This ensures online users always get fresh code.
- **Other static assets** → cache first, network fallback.

---

## Deploy

There is no production deploy in this repo right now — it's run via `node server.js` locally on port 8080, or could be hosted on any static host. (If you set up a deploy target later, document it here.)

---

## Gotchas / things to know

### 1. Bump `CACHE_NAME` in sw.js when shipping JS/CSS/HTML changes
Currently `booktracker-v17`. If you don't bump it, the old service worker may serve stale files even though the fetch strategy is network-first (because `cache.put` only updates a successful response — but the activate phase does cache cleanup keyed on the version).

### 2. Firestore doc IDs can't contain `/`
Book ids like `ol:/works/OL12345W` would break. `BookFirebase.sanitizeId` replaces `/` with `_` before reading/writing Firestore. Don't bypass this.

### 3. Don't trust empty cloud snapshots
The sync code in `js/app.js` explicitly ignores an empty `onSnapshot` payload if local has books. This was a real bug — Firestore can momentarily return zero docs during reconnect, and without this guard the app would wipe the user's library.

### 4. `bookExists` does a title+author fallback
Same book from Google Books vs Open Library has different ids. `db.js > bookExists` first checks by id, then falls back to a case-insensitive title + first-author match. Keep this when adding new id sources or you'll get duplicates.

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

**Last updated:** 2026-04-08 (initial creation)
