# Web bootstrap, sideload, and cleanup

This folder owns the public web shell, the versioned bootstrap loader, the background sideload updater, and the cache-cleanup page.

## Entry Points

- [`index.html`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/index.html) is the public shell.
- The packaged shell rewrites its script tags to versioned direct links:
  - `/version/<build>/boot_download_helpers.js`
  - `/version/<build>/sha256_fallback.js` (lazy-loaded on plain HTTP when Web Crypto is unavailable)
  - `/version/<build>/app_update.js`
- Those files are fresh build assets loaded directly from `index.html`, not blob-executed.
- [`app_update.js`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/app_update.js) loads the active build and performs background update checks.
- [`boot_download_helpers.js`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/boot_download_helpers.js) provides resumable gzip download and decode helpers.
- [`flutter_bootstrap.js`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/flutter_bootstrap.js) loads the actual Flutter app from the versioned build.
- [`cleanup_cache.html`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/cleanup_cache.html) clears loader state and browser-managed runtime state.
- In packaged output, the root folder is intentionally minimal: only `index.html` and `latest.json` stay at top level; the cleanup page and all other web assets live under `/version/<build>/`.

## Bootstrap Flow

1. The browser opens `index.html`.
2. `index.html` loads `app_update.js`.
3. `app_update.js` fetches `/latest.json`.
4. It chooses either the latest manifest or the last good manifest stored in `localStorage`.
5. It downloads the versioned `flutter_bootstrap.js.gz` from `/version/<build>/`, unzips it, and executes it from a blob URL.
6. The bootstrap loader resolves build-relative URLs for `main.dart.js`, CanvasKit, and the other boot assets.
7. `boot_download_helpers.js` is loaded directly from the same versioned directory as `app_update.js`.

### Build Resolution

The bootstrap loader can resolve the build from:

- `window.__FLUTTER_BUILD__`
- the versioned `flutter_bootstrap.js` script URL

The loader then uses `/version/<build>/` as the base for all boot assets.

### CanvasKit Selection

- Chromium CanvasKit is used only when `window.crossOriginIsolated === true`.
- Otherwise the non-chromium CanvasKit path is used.
- The selection is based on page isolation state, not on the backend API origin or iframe embedding alone.

## Init

Flutter initialization happens in [`lib/main.dart`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/lib/main.dart).

Important frozen startup values:

- `externalJwtToken` is read once from the URL during app startup.
- `bootstrapAutoLoginEnabled` is derived from that startup token state.
- `anonBootstrapEnabled` is derived from the URL at startup.
- the loader stores a staged `flutter.nextManifest` while a newer version is being downloaded
- `flutter.lastGoodManifest` remains the default boot source while `flutter.nextManifest` is still filling its cache
- if `flutter.nextManifest.version` does not match the live `latest.json`, the loader discards it and cleans its cache instead of replacing `flutter.lastGoodManifest`
- if a stored last-good manifest points to a boot cache that is not complete yet, the loader ignores that manifest and falls back to `latest.json` instead of treating the partial cache as ready

Important runtime state:

- `SessionManager` holds the current auth session.
- `authStatusProvider` derives authenticated/unauthenticated state from `getSelfRole`.
- router state is redirected from the auth state and saved route state.

## Login / Logout

### Normal Login

- Username/password login goes through `loginSvodka()`.
- On success, the Serverpod session key is stored.
- Auth providers are invalidated after login so the UI refreshes.

### Token Auto-login

Compatibility fallback:

- `?token=...`
- `#token=...`

Primary iframe handoff:

- the host page sends `postMessage({ type: 'svodka-bootstrap-token', token })`
- the web shell queues the payload and Flutter consumes it directly
- no reload is required for the message-based path

### Anonymous Auto-login

Compatibility fallback:

- `?anon=1`
- `#anon=1`

Primary iframe handoff:

- the host page sends `postMessage({ type: 'svodka-bootstrap-token', token, anon: true })`
- Flutter treats the same bootstrap message as anonymous bootstrap when `anon: true` is present
- anonymous bootstrap does not replace an already signed-in different user

### Logout

- manual logout calls `SessionManager.signOutDevice()`
- the app invalidates generated providers and returns to the shell route flow
- logout does not erase loader caches or version state

## URL Changes

Current bootstrap URL inputs:

- `?token=...`
- `#token=...`
- `?anon=1`
- `#anon=1`

Current route behavior:

- unauthenticated users are redirected to `/login`
- authenticated users land on the saved or requested route
- embedded token/anon state is consumed during startup, not by route parsing

The URL token path remains a fallback for compatibility while the message-based path is rolled out.

## Inner State Changes

Bootstrap and auth can change these internal states:

- `SessionManager` key storage
- `authStatusProvider`
- `manualLogoutProvider`
- `externalJwtAutoLoginAttemptsProvider`
- generated Riverpod provider cache
- router redirection and route persistence state

## Sideload

[`app_update.js`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/app_update.js) is the sideload controller.

It:

- fetches `/latest.json`
- keeps the last good manifest in `localStorage`
- is loaded from the source shell as `/app_update.js`
- is rewritten to `/version/<build>/app_update.js` in the packaged backend bundle so the deployed shell controller stays in sync with that build
- is not part of the background sideload file set
- downloads the versioned `flutter_bootstrap.js.gz`, gunzips it, and loads it from a blob URL
- downloads boot assets in the background after the app starts
- keeps the current app usable while the new version is still loading
- caps retry delays at 5 seconds
- shows aggregate progress for the full sideload bundle
- background sideload downloads use the shared fetch-based boot downloader
- browser boot downloads that need the actual bytes use streamed `fetch()` so a hard disconnect can keep the partial body and resume from the saved offset
- completed boot files are written to version-scoped browser Cache Storage, so a later bootstrap reload can reuse files downloaded by sideload instead of fetching them again
- partial boot files are checkpointed asynchronously into a separate partial Cache Storage entry; the ready entry is written only after the full file is verified
- cache checkpoint writes use Blob parts and delayed serialized flushes so the active download stream is not blocked by byte concatenation or Cache Storage I/O on every chunk
- `latest.json` contains `sha256` and `gzSha256` for boot files; `gzSha256` is the validator used for transferred `.gz` files
- a ready cache entry is accepted only when its size and SHA-256 match the manifest, so a corrupt ready cache is deleted and downloaded again
- a newly downloaded file is promoted from partial cache to ready cache only after the downloaded bytes match the manifest hash
- old boot cache namespaces are not deleted during read/write; they are removed only after the new version has finished downloading, passed self-test, and been promoted as ready
- when the server provides a validator such as `ETag`, the helper uses `If-Range` on resume so a changed file falls back to a full redownload instead of being marked ready from broken bytes

The background update bar is part of the sideload UX and is controlled entirely from `app_update.js`.

Resume policy:

- resumed requests send `Range: bytes=<offset>-`
- if a cached partial exists, the resume offset is derived from the cached response body length
- cache checkpoint writes are batched, serialized, and stored under a partial key; pause/resume cannot overwrite a ready file with a partial body
- complete ready-cache reuse requires manifest size and SHA-256 validation when those fields are present
- if a stored partial belongs to an older or stale `flutter.nextManifest`, the stale manifest cleanup removes that version cache before the latest version is downloaded
- the helper prefers `206 Partial Content`
- `If-Range` is disabled by default; versioned immutable files use manifest `gzSize` and `gzSha256` as the integrity guard
- a resumed request must return `206 Partial Content`; if the server returns `200 OK`, the helper treats it as an ignored Range request, cancels/discards the body, keeps the partial cache, and retries the same resume offset until retry limits are hit
- `200 OK` is accepted only for offset `0`
- an unexpected `Content-Range` is rejected before appending bytes and retried without dropping the partial cache
- retry laps use a cache-busting request URL and no-cache headers
- the first attempt may use the browser cache, but any retry after a stall/restart does not
- background update retries keep the last loaded byte offset for the current file, so a network drop resumes the same file instead of restarting from zero
- completed boot downloads are reused in-session so the same URL is not fetched again
- inflight boot downloads are shared so a second caller for the same URL waits for the first request instead of starting a duplicate transfer
- small boot downloads are kept in-session even if the first caller only needed progress, so a later boot pass can reuse them without another network request
- `boot_download_helpers.js` lazily loads `fflate.min.js` from the same versioned directory when the browser does not expose `DecompressionStream`
- on plain `http://` deploys (non-secure context), `crypto.subtle.digest` is unavailable; the helper then lazy-loads `sha256_fallback.js` (pure JS SHA-256) from the same versioned directory for manifest integrity checks
- after the background downloader finishes and self-tests the new version, it promotes `flutter.nextManifest` to `flutter.lastGoodManifest` and then clears older boot cache namespaces

### Bootstrap Progress

The bootstrap overlay is separate from sideload and is intentionally file-oriented:

- the first progress bar tracks the current boot file transfer
- the label above it shows the current phase, first `CanvasKit` and then `main.dart.js`
- the second progress bar shows overall bootstrap progress
- the subtitle below the bars updates for download, decompression, retry, and launch phases

## Clear

[`cleanup_cache.html`](C:/Users/user/StudioProjects/vsp_antoan/vsp_dsno_flutter/web/cleanup_cache.html) is the loader cleanup page.

The bootstrap overlay also shows a dark red `Reset app cache!` button under the load progress. In packaged output it routes to `/version/<build>/cleanup_cache.html`.

It clears:

- `flutter.lastGoodManifest` from `localStorage`
- `flutter.*` SharedPreferences keys from `localStorage`
- registered service workers
- Cache Storage entries

It must not clear:

- IndexedDB application data
- unrelated `localStorage` keys
- normal HTTP cache entries directly

It then redirects back to `index.html?cache_bust=...&loader_repair=1`.

## Known Issue

The custom JavaScript fetch path is not the same as Chrome's internal resource loader.

- Chrome's native loader can behave more robustly on slow or unstable connections.
- There is no public JavaScript implementation that exactly reproduces Chrome's internal retry and transport behavior.
- We still use the custom loader because it supports resumable gzip boot files.

## Tests
node --test web/app_update_boot.test.js
node --test web/boot_download_helpers.test.js
node --test web/flutter_bootstrap_helpers.test.js
