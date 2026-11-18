# Development lessons

Keep synchronized with [Chinese](LESSONS.md); see [release rules](docs/en/releases.md).

## LYNX-CACHE-001: Verify the fallback cache URL in the final plugin package

- Scope and evidence: Bili baseline `0f0adb1f0de999796fde81d98bdfbcaa587d5628`. Release `v2026.11.16.2` used a fixed Web bundle URL with a one-year cache lifetime. The old and new packages contain identical bundle bytes, and the new fallback page declares the matching content-hashed URL.
- Correct example: generate the fallback page after the frontend build and check both the final ZIP and the actual HTTP request. Docker Chrome loaded the versioned Bili bundle under a deployment subpath, rendered the UI, and received a successful plugin API response. Evidence is in `/tmp/songloft-bili-assets-2k1rxb/`. See the [plugin development guide](https://github.com/songloft-org/songloft/blob/main/docs/en/js-plugin-development-guide.md) for shared rules. Since plugin-builder 2.22.0 the toolchain generates this declaration automatically; Bili's custom script and template are retired, and the verification steps stay the same.
- Seen 1× (2026-11-18). This verifies the cache risk. No production Bili blank screen was observed.

## RELEASE-001: Activation boundaries must not masquerade as published sources

- Scope: migrating tag-based releases to per-commit automatic releases, baseline `80979bd6f604ab915ddf64a285164e7bfa0124ec`.
- Rule: enabling the workflow must not replay all historical code after the previous tag. Configure an explicit activation boundary and update `releaseSource` only after successful publication. Actual publication progress takes precedence on subsequent runs.
- Evidence: an isolated copy without the boundary fallback failed the `activation baseline` regression by publishing an extra historical package (`/tmp/songloft-bili-auto-release-negative.log`). The implementation passed all 49 tests (`/tmp/songloft-bili-auto-release-full-tests.log`).
- Done right: exclude pre-activation history with `RELEASE_BASE_SHA`, then resume from `plugin.json.releaseSource` after success. Do not fabricate publication records to skip history.
- Seen 1× (2026-11-15). This is migration regression evidence, not an observed production mispublication.

## UI-001: Interaction checks do not replace migration layout acceptance

- 2026-11-16 spacing evidence: base buttons only had top/right margins, and conditional-rendering wrappers let `.content > .button-primary` miss its target. The old bundle measures 0px from load-more to selected tracks. Explicit action groups now own outer/button/wrapped-row spacing; final card actions reuse container padding, while page actions leave 16px below. Navigation, search rows, parts and pickers keep separate compact rules. Measure subsequent-content gaps and container insets across running/paused/failed tasks, anonymous/signed-in accounts, confirmations and pickers; counting tabs or checking overflow alone is insufficient. This remains the same UI incident without incrementing Seen; see the latest verification record.

- 2026-11-16 follow-up: the fixed 40px global status row prevents shifting but wastes narrow-screen space. Account-tab identity, fixed-width title feedback and operation overlays retain zero geometry movement without an empty row. Missing cid means unresolved metadata, not multiple parts. Resolve unknown counts lazily, avoid duplicating single videos as P1, and keep individual-part selection separate from parent-group toggling. All 62 tests and real-browser checks cover this; old-bundle space and old-extractor count regressions fail. See the latest verification record. This remains the same UI incident and does not increment Seen.

- Same-day follow-up: retained inner tabs still disappear if native routing destroys the frame; stable client Shell ownership is required. Long titles must reserve cover/action width, parts data and expansion must be separate, and large playlist selectors need bounded searchable lists. The 320px/1000-playlist regression checks two-line titles, one parts request and selection/cancellation; the old bundle fails at collapse. Native default input values must remain stable rather than echoing each keystroke. See this batch's verification. This incident does not increment Seen.

- Scope: bili's HTML to ReactLynx migration; baseline `b1324026a69673b3e086d20e4a74b662fa238cdb`.
- Evidence: release `v2026.11.15.0` fails the same real-browser regression at 320px: its fifth navigation item wraps to y=56 while the others remain at y=10 (`/tmp/songloft-bili-layout-negative-browser.log`). Saving settings had passed during migration despite lost form grouping and selected states.
- Rule: preserve information hierarchy and narrow-screen navigation. Use explicit input classes instead of inconsistent cross-platform tag selectors. Web x-input uses `display: contents`; inspect the real input inside its shadow root for dimensions and interaction instead of treating the zero-sized host as invisible.
- Done right: `tests/layout.browser.cjs` visits five pages at 320/390/1100px in both themes, asserting single-row navigation, no horizontal control overflow, usable inputs and short-viewport saving. The same script with the old bundle must fail on navigation wrapping. Visually inspect grouping, spacing and text colors in screenshots.
- Seen 1× (2026-11-15). Repeated verification of this migration omission does not count as a separate incident.
- Same-incident native checks: dark placeholders require `-x-placeholder-color`; returning from settings bottom to search retained the old scroll offset, so recreate the scroll container per tab. Native screenshots and persisted settings evidence are in [verification](VERIFICATION.en.md).

- Same-day follow-up: baseline `1a22f31` disabled tabs with global busy state; the delayed-response regression with the old bundle remained on favorites instead of downloads. Independent reads and drafts outside tab content pass. A cover field in the API does not prove rendered images; after adding the component, real CDN verification first failed with 403 for a local Referer. A cover-only fallback through the host proxy passes. See the layout and interaction verification section in VERIFICATION. This same-day event does not increment Seen.

- Same-day rework evidence: v2026.11.15.2 checked settled layouts but missed polling-time geometry changes; the new regression measured an 82px heading shift. Async status needs a fixed layout footprint and retained page nodes. Web scroll-view's forced flex display and lost flex weight after hiding/restoring also require checks. Anonymous and expired sessions must cover settings favorites reads and buvid-only cookies without treating normal anonymity as an API error. The fix measures 0px variation, zero anonymous favorites requests, and 56 passing tests. Android emulators exited 139 while starting the host; native acceptance did not pass. See the latest verification record. This same incident does not increment Seen.
