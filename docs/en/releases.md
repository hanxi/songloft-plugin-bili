# Automatic releases

Pushing to `main` starts Release Plugin, which builds each unpublished non-documentation commit in first-parent order. Multiple commits in a push and new commits arriving during a build each receive a package. Commits changing only Markdown (`.md` / `.mdx`) or documents/assets under `docs/` consume no release number; mixed code/build changes publish normally. Generated version commits do not publish again. Manual workflow dispatch resumes unfinished work without a version input.

Versions use `YYYY.M.D.N` in the Asia/Shanghai timezone. The first package each day normally uses `.0`; subsequent packages increment the largest existing numeric suffix (`.9` becomes `.10`). Tags include `v`, manifest versions do not. Existing tags and Releases remain immutable; allocated tags are never reused, so failures can leave gaps. An existing three-part version on the same date makes the first suffix `.1` to ensure an upgrade. If the current version date is ahead of the clock, its prefix is retained until the date catches up.

The initial activation boundary is `80979bd6f604ab915ddf64a285164e7bfa0124ec` (`RELEASE_BASE_SHA` in the workflow). Earlier history is neither replayed nor falsely marked as published. After the first success, `plugin.json.releaseSource` tracks the actual published source and takes precedence over the boundary. Do not change either marker casually.

Each package uses a separate Git worktree and must pass frozen dependency installs, backend/frontend typechecks, the full test suite, build and manifest validation. Native/Web bundles and the HTML fallback must exist. Tags point to the matching source plus release metadata. Release notes `Source commit` and `plugin.json.releaseSource` identify the original source SHA; a generated commit synchronizes main's version, download URL and package hashes. Manual tags and local publishing commands are unnecessary.

Failed checks stop the queue at that commit; restore the build conditions before rerunning. If publication succeeds but pushing metadata fails, reruns recover the existing Release without rebuilding or republishing. Runs are queued serially and refresh main during processing to avoid version collisions and missed commits.

Local verification:

```bash
node --test tests/release_pipeline.test.mjs
pnpm test
```

Release tests use temporary local Git remotes and simulated GitHub Releases without publishing externally. They cover date rollover, numeric suffixes, legacy migration, activation boundaries, batch pushes, commits arriving during builds, documentation skips, retry/recovery, metadata push failures, matching tags/sources and dual-target output checks.
