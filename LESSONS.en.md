# Development lessons

Keep synchronized with [Chinese](LESSONS.md); see [release rules](docs/en/releases.md).

## RELEASE-001: Activation boundaries must not masquerade as published sources

- Scope: migrating tag-based releases to per-commit automatic releases, baseline `80979bd6f604ab915ddf64a285164e7bfa0124ec`.
- Rule: enabling the workflow must not replay all historical code after the previous tag. Configure an explicit activation boundary and update `releaseSource` only after successful publication. Actual publication progress takes precedence on subsequent runs.
- Evidence: an isolated copy without the boundary fallback failed the `activation baseline` regression by publishing an extra historical package (`/tmp/songloft-bili-auto-release-negative.log`). The implementation passed all 49 tests (`/tmp/songloft-bili-auto-release-full-tests.log`).
- Done right: exclude pre-activation history with `RELEASE_BASE_SHA`, then resume from `plugin.json.releaseSource` after success. Do not fabricate publication records to skip history.
- Seen 1× (2026-11-15). This is migration regression evidence, not an observed production mispublication.
