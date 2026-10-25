---
name: upstream
description: Sync pingdotgg/t3code main into T3 Code Fold while preserving Fold features. Use for upstream merges, auditing a completed sync, or landing a prepared sync on Fold main. Does not update the installed server or publish releases.
---

# Sync Fold with upstream

Read [the upstream policy](../../../docs/operations/upstream-sync.md) first. It owns the feature
preservation rule and conflict patterns; this skill owns the procedure. A completed sync preserves
upstream ancestry, accounts for every Fold feature, and records verified resolutions.

## Establish the base and scope

Inspect `git status`, remotes, and `git worktree list`. Fetch `origin`, `upstream`, and `core` with `--prune`.
Confirm `origin` is whattheflop/T3codefold, `upstream` is BreakTheBeta/T3codefold,
and `core` is pingdotgg/t3code. Merge `upstream/main` first, then `core/main`. Record the starting Fold
commit and fetched upstream commit as immutable SHAs for comparisons and the merge record.

- For a new sync, use a clean task branch at fetched `origin/main`, or create an isolated worktree
  there. Preserve unrelated working changes and commits. A local branch named `main` may be stale,
  divergent, or checked out elsewhere; it is not the remote baseline.
- If a sync is already prepared, inspect its parents and ancestry and finish it rather than starting
  over. If upstream is already an ancestor, report that or perform the requested preservation audit.
- A sync request authorizes preparing and committing the merge. Publish a branch, open a PR, or land
  directly on `main` only within the user's requested scope. Existing authorization carries forward.
  Installing a server update or publishing a release is a separate task.

## Merge and resolve

On the task branch, merge the recorded upstream commit with `git merge --no-ff --no-commit <sha>`.
Keep a real merge commit: rebasing or squashing loses the ancestry needed for the next sync.

Inventory conflicts with `git status --short` and `git diff --name-only --diff-filter=U`. Examine
modify/delete and add/add cases explicitly: a deleted Fold integration often needs porting to a new
upstream location. Trace the reason for each side's change before resolving.

For more than a handful of conflicts, delegate disjoint areas (server/packages, mobile,
web/desktop/scripts). Each agent owns explicit files, preserves the policy's feature rule, and
writes per-file decisions under `/tmp`; only the primary agent stages and commits. Keep production
changes small by moving Fold extensions into Fold-owned modules with narrow upstream seams.

Resolve workspace manifests before a conflicted lockfile. For an upstream merge, start from the
upstream lockfile and regenerate with Fold's resolved dependencies. An auto-merged lockfile can be
kept if installation validates it. Install with `vp i`, or `pnpm install` when `vp` is absent; use
`node_modules/.bin/vp` and `node_modules/.bin/tsc` after installation. Avoid letting `npx` download an
unrelated compiler when dependencies are missing.

A resolution is ready when conflict markers are gone, both sides' intended behavior is accounted
for, and notes explain every non-obvious choice. Then inspect clean merges too: moved APIs, newly
nullable returns, duplicate imports, and fixture dependencies can break without conflict markers.

## Verify behavior and feature preservation

Use the recorded starting Fold commit to identify affected workspaces and changed directories.
Install dependencies once before parallel verification; give each agent a distinct check scope.

- Typecheck every affected workspace with `node_modules/.bin/tsc --noEmit -p <workspace>`, including
  `scripts` when build helpers change. Also check the server with `--singleThreaded`; parallel
  checkers can obscure excessively deep Effect type instantiations.
- Run explicit test files in each changed directory, plus Fold regression suites for affected
  features, with `NODE_ENV=test node_modules/.bin/vp test run --maxWorkers 2 <files>`. Use the
  workspace's test configuration where needed. Web tests that import browser workers or Ghostty
  WASM require running from `apps/web`:

  ```bash
  NODE_ENV=test ../../node_modules/.bin/vp test run --project unit --maxWorkers 2 <files>
  ```

  Consult current configs if project names change.

- Run formatting and lint on changed files. Distinguish inherited lint findings from added-line
  errors; retain evidence of the baseline. Fix regressions and rerun the affected checks, without
  repeating successful unrelated suites. Keep test logs outside the repository.
- Walk every README “More than upstream” row on each listed surface. Compare settings, palette,
  keybindings, buttons, routes, CLI commands and MCP tools against the recorded Fold baseline.
  Check connections between implementation and entry points, not just file existence. Include
  Fold release feeds and older-server compatibility. For a large audit, delegate read-only feature
  groups and collect evidence and unresolved questions under `/tmp`.

Completion requires passing affected checks and an accounted-for feature inventory. Report skips
and proven baseline failures explicitly. A failed assertion is evidence to investigate, not grounds
to relax a test: establish the intended observable guarantee before changing it. Source audits and
unit tests do not establish physical-device behavior. Browser/device verification follows the
repository's explicit-authorization requirement; only the primary agent runs an integrated pass.
Do not run repo-wide checks manually; the pre-push gate handles its own scope.

## Record the sync

Update the README baseline to the merged upstream SHA and sync date. Retire a Fold feature row only
when upstream supplies the complete behavior. Record partial overlap while retaining the extension.

Review the integrated diff and commit the merge. The message records each non-obvious resolution,
every upstream replacement, any behavior relinquished, and validation results. Keep investigation
notes out of the repository. Verify the commit has both parents, includes the upstream SHA as an
ancestor, and leaves a clean working tree.

## Deliver within the requested scope

For a local-only sync, stop with the commit and check results. For a requested PR, publish the task
branch, create the PR into Fold `main`, and register it with the thread's PR-linking tool if available.
Preserve the merge commit when landing the PR.

For an explicitly requested direct landing:

1. Fetch `origin` again. Require `origin/main` to be an ancestor of the prepared branch. If main
   advanced, merge it into the task branch and verify the newly affected scope before proceeding.
2. Read [the pre-push gate](../../../docs/operations/fold.md#pre-push-gate). Push the checked-out,
   clean, verified branch with `git push origin HEAD:main`. Keep the gate enabled. A rejected
   non-fast-forward push means fetch and reconcile; never force-push main.
3. Confirm the remote main SHA equals the delivered commit. Leave any other worktree's local main
   and uncommitted work intact. Report the landed SHA, verification, and remaining limitations.

A hook failure requires fixing or establishing the cause, not bypassing it. Remote branch protection
may require a PR; report that constraint and use a PR only when authorized. Once the remote SHA is
confirmed, the direct landing is complete; it does not imply deployment or release publication.
