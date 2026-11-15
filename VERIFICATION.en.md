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

Fallback requires server-side `web-core/` assets, copied from the Lynx Web build for this test. Lynx HTML omits COEP for Chromium 121 compatibility; isolated cross-origin HTML embedding is unsupported. Native/Web Lynx frames do not use this entry. SDK/builder dependencies are now pinned to published npm version `2.20.0`. Authentication and staged approval were required for the initial SDK publication; the [recovery workflow](https://github.com/songloft-org/plugin-toolchain/actions/runs/43695190471) completed the remaining packages and created the [GitHub Release](https://github.com/songloft-org/plugin-toolchain/releases/tag/v2.20.0). At that point, the bili release workflow required a separate dispatch; that batch only committed and pushed plugin sources. Subsequent work enables publishing on push; see the [release rules](docs/en/releases.md).

## Published npm dependency verification

Toolchain v2.20.0 recovery completed. The plugin pins `@songloft/plugin-builder@2.20.0` and `@songloft/lynx-plugin-sdk@2.20.0`; neither lockfile contains local toolchain dependencies. Backend installation passed. Clean frontend installation used a mirror after slow official binary downloads, retaining and verifying the official npm lockfile integrity values.

With published dependencies, backend/frontend typechecks, 38 regressions, native/Web bundle builds and ZIP validation passed. The zipHash remains `ef854906e246ae1ef811f28884016275b3699137736b7068c120e06f5d3650a3`. Browser verification repeated settings persistence and dark-theme text-color checks at 390px, with zero page errors. New CI performs frozen installs, typechecks, regressions and dual-target packaging from an independent checkout. Logs: `/tmp/songloft-bili-official-*.log`. The first browser attempt clicked before initialization finished and timed out; waiting for initialization resolved the test-driver race.

During this round of Android revalidation, the emulator host exited with segmentation fault (139) after boot and opening the plugin. No new interaction screenshot was obtained and this round is not recorded as passing. Prior real-emulator settings-persistence evidence and the matching package zipHash remain recorded.

The first independent CI run failed because workflow pnpm 9 conflicted with packageManager 9.15.0. Both workflows now read the project-declared version. The initial failure log is retained at `/tmp/songloft-bili-first-ci-failure.log`; final CI status is attached to the corresponding commit run.

The second independent CI run failed compiling the WebAssembly build tool on Node 20 (Unknown heap type -14); the native bundle compiled. Development and both workflows now require Node.js ≥22.14. The failure log remains at `/tmp/songloft-bili-ci-second-failure.log`; the subsequent Node 22 CI validates this source.

## Automatic release verification (2026-11-15)

Object: baseline `80979bd6f604ab915ddf64a285164e7bfa0124ec` plus this workflow, script and test worktree; plugin runtime code is unchanged. Environment: Linux amd64, Node 22.17.1, pnpm 9.15.0. All 49 `pnpm test` cases passed, including 11 release tests. Removing the activation boundary in an isolated copy failed the historical-replay regression as expected. Logs: `/tmp/songloft-bili-auto-release-{full-tests,negative}.log`.

`git diff --check` passed. actionlint v1.7.12 does not recognize GitHub's supported `concurrency.queue`, causing the initial lint failure. After checking `queue: max` with `cancel-in-progress: false` against [official documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), both workflows passed all other checks with only that outdated schema error excluded. Log: `/tmp/songloft-bili-auto-release-lint.log`. CI for the pushed SHA, automatic Release and downloaded assets are verified separately afterward.

Not run: browser/Android interaction was not repeated for this release-only change; earlier runtime evidence remains recorded.

Push acceptance: both [CI](https://github.com/hanxi/songloft-plugin-bili/actions/runs/43698667904) and [Release Plugin](https://github.com/hanxi/songloft-plugin-bili/actions/runs/43698667865) succeeded for `7670f08e1f9391d896066ea7fd54f8bd6dd1259e`. A normal push automatically created [v2026.11.15.0](https://github.com/hanxi/songloft-plugin-bili/releases/tag/v2026.11.15.0); bot commit `692be3e` updated main's metadata and was fast-forwarded locally.

Downloaded `/tmp/songloft-bili-auto-release-assets/bili.jsplugin.zip`, checked native/Web bundles, HTML fallback and `main.jsc`, and recomputed entryHash and canonical zipHash. Package, tag and main agree on version, source, URL and hashes. The tag's parent is exactly `7670f08`. ZIP SHA-256: `a984bf629271c4129d22c5f570b80cd0ac76fce5495f0df88eb427d2bb3efdf5`. Fetching all tags encountered an existing local/remote conflict at old tag `v2026.10.7`; it was not forcibly overwritten. The new tag was fetched and main fast-forwarded successfully, with no effect on this release.

## Layout fix verification (2026-11-15)

Object: `b1324026a69673b3e086d20e4a74b662fa238cdb` plus this worktree. Frontend/browser-test fingerprint: `3e0cc345819e1092c3217b5a757f9d58d3cb8de16ae3154e3e5d4e74928346b8` (file hashes in `/tmp/songloft-bili-layout/worktree.json`). The plugin backend is unchanged; SDK/Builder remain published npm `2.20.0`.

Changes: single-row narrow navigation, grouped cards, distinct selected states and boolean switches; separate link/search modes; import controls after selecting songs; deduplicated options. Inputs use explicit classes, native `-x-placeholder-color` and Web placeholder variables. Changing tabs recreates the scroll container so returning from the settings bottom does not crop the search header.

Linux amd64 / Node 22.17.1 / pnpm 9.15.0: frontend typecheck, all 49 tests, native/Web build and validation passed, as did `git diff --check`. Logs: `/tmp/songloft-bili-layout-{types,tests,build,validate}.log`.

Docker Chromium 121: `tests/layout.browser.cjs` visits five pages at 320/390/1100px in both themes (30 combinations). Assertions cover single-row navigation, no horizontal overflow, real input height of at least 40px, unique selected navigation, saving medium quality through the UI at 320×480 and reading it from the backend, reset scroll on tab changes, and no page errors. Log: `/tmp/songloft-bili-layout-browser.log`. Replacing its Web bundle with release `v2026.11.15.0` makes the same test fail because the fifth navigation item wraps to y=56 at 320px (`/tmp/songloft-bili-layout-negative-browser.log`). The browser client's embedded Lynx frame also passed account/download/settings navigation, settings persistence, 390px screenshots and no page errors (`/tmp/songloft-bili-layout/host-browser.log`).

Real Android API 34 x86_64 emulator: 320×640, actual APK and a native bundle built from the same frontend source. Clicked all five tabs and inspected screenshots; dark input placeholders are readable. Selected lowest quality, swiped to Save, tapped it and read `audio_quality=low` from the backend. Returning from the bottom to search shows its complete header and field. Evidence: `/tmp/songloft-bili-layout/android-final-*.png` and `native-saved.json`. The existing Debug/TestBridge shell has APK SHA-256 `1e8daecfc8a856f4fac2260b83a44d8d803e76ce4bfaf0351236b7cd174c9b1b`; native shell code was unchanged.

Retained emulator failures: 37.2.12 with swiftshader/off and 35.6.11 with swiftshader exited with host SIGSEGV. gdb captured RenderThread and SwiftShader libGLESv2 stacks (`/tmp/songloft-bili-layout/emulator-fault-backtrace.log`). Emulator 37.2.12 with `-gpu swangle` then completed the interactions stably (`/tmp/songloft-bili-layout/emulator-swangle.log`). Failed attempts are not counted as passes.

To rerun against an isolated test instance (the script changes audio quality), set `BROWSER_PUPPETEER=/usr/src/app/node_modules/puppeteer` and `BILI_TEST_BASE_URL` inside Docker Chromium, then run `node tests/layout.browser.cjs`. Set `BILI_TEST_OLD_BUNDLE` to an older Web bundle for the negative control.

Not run: a fresh Android native-shell build, real Bilibili account/download operations, iOS/HarmonyOS, Flutter devices or native light theme. Browser light/dark and native dark coverage are recorded above.

## Layout and interaction verification (2026-11-15)

Object: bili `1a22f3133e2dac7ebe085a28c1c33d1820fc3912` plus this uncommitted worktree. The isolated host uses the previously built `/tmp/songloft-bili-verification/server-final2`; no host changes were made. Environment: Linux amd64, Node 22.17.1, Docker Chromium 121, isolated backend on port 30602 with database and plugin package under `/tmp/bili-redesign/`. Existing service data was not used.

- Search is the default, link extraction is secondary, and both appearances use system blue. Results include covers; playlist selection and additional import options collapse. Navigation is independent of action locks, pending reads deduplicate, and failures offer resource-local retries. Search selection, settings drafts and scroll positions live outside tab content.
- Frontend/backend TypeScript checks, all 55 plugin tests, native/Web builds and plugin validation pass. Logs: `/tmp/bili-redesign-{backend-types,tests,build,validate}.log`. The first new handler test failed because it imported undeclared esbuild; it now uses the existing TypeScript transpiler and the full suite passes.
- `tests/interaction.browser.cjs` delays settings/favorites responses by 1600ms in the real HTML fallback. It checks navigation before responses finish, pending-read deduplication, default search, retained selection and preserved settings drafts. A real CDN image, a failed address and an empty address exercise image and placeholder rendering; result layouts cover 320/390/1100px in both themes. Log: `/tmp/bili-redesign-interaction.log`; screenshots: `/tmp/bili-redesign-<width>-<theme>.png` inside Chrome. Search/favorites data uses request fixtures, not real Bili business acceptance.
- The first real-image check failed because the CDN returned 403 for a local-page Referer. A Bili-cover-only JSON fallback now retrieves image bytes through the existing host proxy. Rendering and cross-tab reuse of fallback images pass. Host proxy permissions were not broadened and tokens are not exposed. The dedicated route validates URL, content type and size, with handler regressions.
- An isolated checkout of the baseline produced the old Web bundle. The same rapid-navigation regression failed with `收藏夹 != 下载`, as expected; see `/tmp/bili-redesign-negative.log` and `/tmp/bili-redesign-baseline-build.log`. The repaired bundle passes.
- Existing `tests/layout.browser.cjs` covers 30 navigation/layout/input-height combinations, a real settings save at 320×480 verified by backend readback (`medium`), and zero page errors. Log: `/tmp/bili-redesign-layout.log`. `git diff --check` passes. Final SHA-256 file inventory: `/tmp/bili-redesign/worktree.json`.

Not run: ReactLynx native devices/emulators (adb currently has no connected device), Flutter devices, iOS/HarmonyOS, real Bili account confirmation, favorites import or audio download. Successful native bundle compilation does not replace these checks. No commit, push or release was performed.
