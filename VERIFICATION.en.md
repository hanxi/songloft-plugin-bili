# Lynx migration verification (2026-11-15)

Baselines: bili `290b9767f4e7416c0a7a2c077c68924f2de4db1a`, toolchain `bc58da63333521f2cb7192c44fcfffcf61656616`, Lynx `025ed82319233c8b64e734cb4c6cdbca84da9833`, parent `4df1e97b3a7874d08d1d74ce799baa9295b512b4`, plus this batch's uncommitted worktrees. Final diff identifiers: `/tmp/songloft-bili-verification/worktrees.json`.

Environment: Linux amd64, Node 22.17.1, Docker Chromium 121, Android API 34 x86_64 emulator. An isolated SQLite database and plugin directory served port 30600; existing service data was not modified.

- SDK build and 6 tests passed.
- bili's 38 download/risk-control tests, frontend typecheck, dual-target build and ZIP validation passed.
- Lynx production build, Web build and `tsc -b` passed. Full Vitest run: 3812 passed, one release-artifact check failed because dist contained the emulator TestBridge build. After rebuilding production assets, the release check and targeted request/host tests passed (12 tests). The original full-suite failure remains recorded.
- Parent Go tests cover asset versions, existing WebView COEP and the Lynx fallback exception. The Node fallback bridge regression passed. All repository diff whitespace checks passed.
- Real browser: native-style Web frame, account/download/settings navigation, quality save verified against the backend, 1100px/390px screenshots and no page errors. Standalone HTML fallback passed rendering, settings persistence and dark-theme text-color assertions at 390px (`fallback-acceptance.log`); scripts and results are in the evidence directory.
- Real Android emulator: authenticated against the isolated backend, opened bili's native frame, switched to settings, scrolled, selected medium quality and saved. Backend read confirmed `audio_quality=medium`. The APK uses an existing Debug native shell with this batch's JS bundle, re-signed locally; native sources were unchanged. The initial API 35 / 16 KB shell failed to start; API 34 cold boot produced system/app ANRs before a restart and successful interactions. These failures are retained.

Evidence: `/tmp/songloft-bili-verification/`, logs `/tmp/songloft-bili-*.log`. Screenshots include `android-final-search.png`, `android-final-settings.png`, `android-bottom2.png` and `android-saved.png`. Scripts use only the isolated backend's default test account.

Not run: authenticated Bilibili QR confirmation, favorites import and real audio downloads; Flutter devices; iOS/HarmonyOS. Migrated UI and queue code do not establish these flows were verified. Gradle 8.7 download was too slow to establish a successful source `assembleDebug`; emulator results apply to the existing Debug shell plus new JS bundle.

Fallback requires server-side `web-core/` assets, copied from the Lynx Web build for this test. Lynx HTML omits COEP for Chromium 121 compatibility; isolated cross-origin HTML embedding is unsupported. Native/Web Lynx frames do not use this entry. SDK/builder dependencies are now pinned to published npm version `2.20.0`. Authentication and staged approval were required for the initial SDK publication; the [recovery workflow](https://github.com/songloft-org/plugin-toolchain/actions/runs/43695190471) completed the remaining packages and created the [GitHub Release](https://github.com/songloft-org/plugin-toolchain/releases/tag/v2.20.0). The bili release workflow requires a separate dispatch; this batch commits and pushes plugin sources only.

## Published npm dependency verification

Toolchain v2.20.0 recovery completed. The plugin pins `@songloft/plugin-builder@2.20.0` and `@songloft/lynx-plugin-sdk@2.20.0`; neither lockfile contains local toolchain dependencies. Backend installation passed. Clean frontend installation used a mirror after slow official binary downloads, retaining and verifying the official npm lockfile integrity values.

With published dependencies, backend/frontend typechecks, 38 regressions, native/Web bundle builds and ZIP validation passed. The zipHash remains `ef854906e246ae1ef811f28884016275b3699137736b7068c120e06f5d3650a3`. Browser verification repeated settings persistence and dark-theme text-color checks at 390px, with zero page errors. New CI performs frozen installs, typechecks, regressions and dual-target packaging from an independent checkout. Logs: `/tmp/songloft-bili-official-*.log`. The first browser attempt clicked before initialization finished and timed out; waiting for initialization resolved the test-driver race.

During this round of Android revalidation, the emulator host exited with segmentation fault (139) after boot and opening the plugin. No new interaction screenshot was obtained and this round is not recorded as passing. Prior real-emulator settings-persistence evidence and the matching package zipHash remain recorded.

The first independent CI run failed because workflow pnpm 9 conflicted with packageManager 9.15.0. Both workflows now read the project-declared version. The initial failure log is retained at `/tmp/songloft-bili-first-ci-failure.log`; final CI status is attached to the corresponding commit run.

The second independent CI run failed compiling the WebAssembly build tool on Node 20 (Unknown heap type -14); the native bundle compiled. Development and both workflows now require Node.js ≥22.14. The failure log remains at `/tmp/songloft-bili-ci-second-failure.log`; the subsequent Node 22 CI validates this source.
