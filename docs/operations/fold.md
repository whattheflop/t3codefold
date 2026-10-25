# Fold maintainer operations

Where Fold's maintenance differs from upstream's. The upstream pages in this directory describe
upstream's procedures; this page overrides them for this repository. Syncing with upstream is in
[upstream-sync.md](./upstream-sync.md).

## Pre-push gate

The fork runs no CI; its test workflows are disabled in GitHub. Instead
[pre-push.ts](../../scripts/pre-push.ts) runs on every `git push` for the workspaces the pushed
commits change and the workspaces that depend on them: format on the changed files, lint on the
changed lines, typecheck, and tests. Unchanged packages replay their last passing result from the
`vp run --cache` task cache in `node_modules/.vite/task-cache`, so it stays fast after the first
run in a checkout. The cache is per checkout; a new worktree warms its own.

- Server tests are not gated yet: the suite takes over half an hour and still has failures
  from before the gate. Run `vp test run <files>` for what you touch.
- Lint blocks only errors on lines the push adds, because many files still carry older
  errors.
- Typecheck covers the workspaces listed in `TYPECHECK_GATED`; add a workspace there once it
  typechecks cleanly.
- Checks run against the working tree, so push the checked-out branch.
- SSH and packaging-script tests run without task caching because its instrumentation
  replaces `/bin/sh` and virtualizes filesystem paths. These suites verify native
  process ownership and real path identity.
- A test that writes files inside its own package can't be cached; keep test scratch files in
  the OS temp directory.
- `git push --no-verify` bypasses the gate for one push.

`vp run knip:check` is not part of the gate yet; knip still has findings on `main`.

## Fold releases

This fork reserves release tags before building and publishes with `--verify-tag`.
Do not reuse a version tag for changed source. Its release workflows build Linux
and Android. The standalone **Fold Android release** workflow uses Expo’s
development signing key; it cannot replace a BreakTheBeta APK signed with a
different key. Configure `T3CODE_EXPO_OWNER` and `T3CODE_EAS_PROJECT_ID` for EAS
builds using your own account.

When asked to **do a release**, ship Linux and Android together under one visible
**T3 Code Fold <version> — Linux & Android** release (`fold-preview-v<version>`).
Use the next desktop/server version as the public release number. Android keeps its
own increasing app version and versionCode for installation compatibility.

1. Build both from the same release commit. Run **Fold desktop release** with the
   version and its default Linux platform; it publishes the matching server and
   attaches the AppImage and Debian package to `fold-preview-v<version>`.
2. Build a standalone Fold Android release APK incrementally, with the existing
   sideload signing certificate, bundled JavaScript and OTA disabled. Bump the
   Android version/versionCode as needed. Do not publish a separate Android release
   or substitute a Play-signed APK. Verify its signature and package metadata.
3. Run `node scripts/finalize-fold-release.cjs <version> <verified-apk-path> --delete-old-releases`.
   This attaches the APK and its checksum, writes concise Linux/Android download
   notes, marks the combined release Latest, and deletes older published releases and
   their attached files so the release list stays short.
   Both Linux installers must exist before it changes anything. Use `--dry-run`
   to inspect the planned changes. Never mark a Linux-only build as a completed release.

The finalizer retains the matching `fold-server-v<version>` and public rolling
update feeds (`fold-server-latest`, `fold-server-nightly`, `fold-desktop-latest`,
`fold-desktop-nightly`, and `mobile-ota` when present). Installed clients require
those URLs. The maintainer chose permanent cleanup of older published releases; do not keep
adding archived drafts to the signed-in release list. Existing drafts are left alone.
Omit `--delete-old-releases` only when recoverable drafts are explicitly wanted.
The script saves release metadata in an OS temporary directory, not a backup of
binaries. Never delete Git tags or the retained update-feed assets.

The upstream npm release workflow is disabled on forks. Fold is distributed from
`whattheflop/T3codefold`, not the npm `t3` package. The server workflow builds
self-contained CLI archives and an npm-compatible tarball; its rolling feeds retain
`t3.tgz` for older launchers. Never reuse a version for a different commit.

Desktop platform YAML files must stay with their referenced installers and
blockmaps in `fold-desktop-latest` or `fold-desktop-nightly`. Windows and macOS are
explicit opt-ins, not part of an ordinary Linux/Android release. macOS requires
signing and notarization credentials for automatic updates; without them, only a
manual download is published.

Fold 0.4.0 is the first release on upstream's orchestrator v2. Its server upgrades
an earlier Fold database in place on first start (see
[thread migration](../user/thread-migration.md#upgrading-from-an-earlier-fold-build)),
so smoke-test it against a copy of real pre-0.4.0 data, and keep later versions on
0.4.0 or above. Mobile moves to 1.4.0 (versionCode 21) on Expo SDK 58; that first
build changes the native runtime and must ship as an APK, not an OTA update.

OTA updates must match the installed native runtime fingerprint.

> For maintainers. Using T3 Code? See [docs/user](../user/).

## Shared Android build caches

A cold Android build takes about an hour, almost all of it compiling NDK C++. Maintainers run many
worktrees at once, and pnpm gives each one its own `node_modules`, so without shared caches every
worktree pays that hour again. Two host-level caches avoid it, and they solve different halves of
the problem:

- **Gradle's local build cache** reuses JVM, resource, and dex task outputs. It lives in the Gradle
  user home, not the project, so it is shared across worktrees as soon as it is enabled.
  `withAndroidBuildCache.cjs` sets `org.gradle.caching` in the generated `gradle.properties`.
- **ccache** reuses the compiled NDK objects, which Gradle cannot: `externalNativeBuild` tasks are
  not cacheable. Install it once per machine (`sudo apt install ccache`, or Homebrew on macOS).
  `mobile-native-client.ts` detects it and warns when it is absent.

ccache only shares across worktrees because the build sets `CCACHE_BASEDIR` to the checkout root,
which rewrites checkout-absolute paths to be relative before hashing, and relaxes the timestamp
comparisons that differ between two pnpm copies of the same dependency. The Android NDK lives
outside any checkout, so a toolchain change stays a miss, which is what you want. Precompiled
headers are the exception to that path rewriting: they live under AGP's `.cxx/<variant>/<hash>`
directory, whose hash derives from the absolute project path, so the same plugin turns PCH off for
ccache builds. Leaving it on drops cross-worktree hits to about half. Those settings are only read
when CMake configures, so a worktree that already configured `.cxx` before ccache was installed
keeps missing until the next prebuild regenerates its native project.

Do not try to share anything else. The generated `apps/mobile/android/` tree and its `.gradle`,
`build`, and `.cxx` directories record absolute paths; symlinking or copying them between worktrees
produces builds that fail in confusing ways. Keep them per-worktree and let the content-addressed
caches carry the work across.

Inspect effectiveness with `ccache -s`. Cleaning is a last resort, not routine hygiene: see the
incremental-build rule in [AGENTS.md](../../AGENTS.md).
