# Bili Music

Songloft plugin for Bilibili music: QR/Cookie login, video search and URL extraction, multi-part selection, favorites import, online playback, batch downloads and favorite monitoring. Business requests use fetch in the QuickJS backend without external binaries.

## Frontend and compatibility

`frontend/` uses ReactLynx and the Lynx plugin SDK. Builds include native and Web bundles; Flutter clients use the generated Web fallback. Existing APIs, accounts, settings, download queues and monitoring storage remain compatible. The Lynx host must support `plugin.apiRequest`; Web fallback requires the updated server bridge shim.

Node.js ≥22.14 is required; the Web build uses a WebAssembly tool unsupported by Node 20. The SDK and builder are pinned to npm version `2.20.0`. Run `pnpm install --frozen-lockfile`, `npm --prefix frontend ci`, and `pnpm run build`. Use `npm --prefix frontend run typecheck` and `pnpm test` for validation. An independent clone builds without an adjacent toolchain checkout.

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
