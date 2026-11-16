# Bili Music

Songloft plugin for Bilibili music: QR/Cookie login, video search and URL extraction, multi-part selection, favorites import, online playback, batch downloads and favorite monitoring. Business requests use fetch in the QuickJS backend without external binaries.

## Frontend and compatibility

`frontend/` uses ReactLynx and the Lynx plugin SDK. Builds include native and Web bundles; Flutter clients use the generated Web fallback. Existing APIs, accounts, settings, download queues and monitoring storage remain compatible. The Lynx host must support `plugin.apiRequest`; Web fallback requires the updated server bridge shim.

Node.js ≥22.14 is required; the Web build uses a WebAssembly tool unsupported by Node 20. The SDK and builder are pinned to npm version `2.20.0`. Run `pnpm install --frozen-lockfile`, `npm --prefix frontend ci`, and `pnpm run build`. Use `npm --prefix frontend run typecheck` and `pnpm test` for validation. An independent clone builds without an adjacent toolchain checkout.

## Page interaction

Music search is the default. “Import via link” switches to video, collection or favorite-folder extraction while preserving both inputs. Results show covers, durations and part selection. Selecting tracks reveals the playlist and import actions; artist overrides, download directories and new playlists remain available.

Long titles clamp to two lines with ellipsis. Known single videos have no parts action. Unknown counts use “Details” and load lazily; only confirmed multi-part videos expand/collapse, reuse cached parts and allow independent part selection. Import playlists, monitored folders and target playlists use searchable pickers with at most 20 items per page; cancelling preserves the current choice.

Native Lynx library/plugin main-navigation retention requires the client frame-retention fix. Updating the plugin alone cannot prevent an older client from destroying its page. Compatible clients pause hidden UI polling and refresh on return. Retention is limited to the current navigation-shell session, without persistence guarantees across app restart or the full-player route.

The HTML fallback input-event fix also requires refreshed server-side `web-core/` assets distributed with the Lynx Web build; replacing the plugin package alone does not update that runtime.

Shared action groups own button spacing: 8px between buttons and wrapped rows, and 12–16px before subsequent content. Load-more and save-settings actions occupy a full row with 16px below. Cards and pickers retain their internal padding; navigation, search-row and parts-row buttons keep their compact layouts.

All five tabs retain independent scroll containers and switch immediately with independent data updates. Search results, selection, settings drafts and per-tab scroll positions survive navigation. Content follows navigation directly, without a reserved empty status row. Once confirmed anonymous, the account tab reads “Not logged in”; signed-in accounts show a small avatar and “Account.” Read feedback lives beside the corresponding title or field, with tap-to-retry errors. Operation results use a dismissible overlay; success dismisses automatically. Neither shifts the form. Background downloads do not block navigation, and polling failures do not repeatedly show toasts. Anonymous visitors do not request favorites; the monitoring section offers login guidance while other settings remain usable. Light and dark appearances use the main application's system blue and grouped lists.

When direct cover loading fails, plugin `POST /api/cover` (`{url}` → `{src}`) retrieves the image through the existing host resource proxy. It accepts only HTTPS `*.hdslb.com/bfs/` image URLs, restricts image types and size to 2 MiB, and returns an image data URL without exposing the host token. Failures retain a placeholder without blocking results. A bounded frontend cache avoids repeated fallback requests when changing tabs.

## Features

- QR and manual Cookie login; searches and URL extraction support multi-part videos.
- Import selected tracks into an existing or new playlist; optionally download locally.
- Browse favorites and import an entire folder into a same-name playlist.
- Download pause/resume, clearing tasks and retrying failures; existing local songs are skipped.
- Quality, Dolby/Hi-Res, metadata, transcoding and directory templates remain configurable.
- Favorite monitoring establishes a baseline before processing new items; failed items can be retried.
- Shared rate limiting and persistent risk-control cooldown remain enforced by the backend.

Audio playback requires host support for custom request headers because the upstream CDN requires Referer. Download paths are relative to the music library; absolute paths and traversal are rejected. Clearing queued tasks preserves completed files and waits for an in-flight download. A cooldown cannot be bypassed by restarting the plugin or clearing tasks.

## Installation

Install the ZIP in Songloft plugin management. Registry URL:

```text
https://raw.githubusercontent.com/hanxi/songloft-plugin-bili/main/registry.json
```

## License

Apache-2.0 © 2026 Songloft Team

See [migration verification](VERIFICATION.en.md) for results and untested scenarios. Root dependencies use the pnpm lockfile; the frontend subproject keeps its own npm lockfile for the builder.

## Automatic releases

Pushes to `main` publish automatically using `YYYY.M.D.N` in the Asia/Shanghai timezone. Each day starts at `.0`, with increasing suffixes. Documentation-only commits do not publish; failed runs can resume without manual version changes or tags. See [release rules](docs/en/releases.md) for queue and migration details.

## Layout

Native and Web share compact single-row navigation, grouped cards and light/dark themes. Link import and search have separate modes; import controls appear after selecting tracks. Settings use switches and distinct selected states.
