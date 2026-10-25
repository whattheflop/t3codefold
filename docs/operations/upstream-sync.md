# Syncing Fold with upstream T3 Code

This fork tracks [BreakTheBeta/T3codefold](https://github.com/BreakTheBeta/T3codefold) as
`upstream` and [pingdotgg/t3code](https://github.com/pingdotgg/t3code) as `core`; `origin`
points at `whattheflop/T3codefold`. Merge `upstream/main` before `core/main`. Every sync so far is a real
merge commit, and that is the whole maintenance strategy: the merge base is what lets the next
sync present only the conflicts that appeared since this one.

## The rule: a sync never loses a feature

Every Fold feature must still work after a sync. The README's "More than upstream" table is the
list to check against; a sync that drops a row from it without upstream supplying the same thing
is wrong, however hard the conflict was.

- **Upstream now ships the same feature: take upstream's.** Delete Fold's implementation rather
  than carrying two. Keep only the pieces of Fold's behavior that upstream's version lacks, built
  on top of upstream's code — for example, the mobile pull request viewer is upstream's, and Fold
  keeps just the extra entry points (Android sidebar, command palette) that open it. Move the
  feature out of the README table into the upstream-supplied list.
- **Upstream has nothing equivalent: keep Fold's.** Port it onto upstream's new APIs and
  structure; a conflict, a moved file, or a renamed service is never a reason to drop it. If
  upstream deleted the code a Fold feature lived in, rebuild the feature in a Fold-owned module.
- **Upstream's version covers only part of it, or you can't tell:** keep Fold's behavior and ask a
  maintainer before removing anything. Note the overlap in the merge commit.

Record each "took upstream's" decision in the merge commit message with what Fold behavior, if
any, was given up, so a maintainer can object before the PR merges.

## Android Fold layout contract

Fold's Android split workspace puts **Chats / PRs at the top of the sidebar** and keeps
**New thread reachable in that sidebar**. All horizontal space between the system safe-area
insets belongs to the workspace panes; navigation must not reserve a separate left rail.
This saves reading and editing width on unfolded phones. Preserve the compact phone layout,
fold/hinge alignment, pane resizing, and remembered sidebar state as the window changes.

Upstream navigation rails are not equivalent to this layout. When upstream changes navigation,
port its behavior improvements into Fold's top navigation and existing controls. Review both the
Chats and PRs branches, including search, filters, Settings access, and New thread; clean merges
can replace these integrations without producing conflicts. Changing this contract requires an
explicit maintainer request.

The width guarantee is covered by
[`fold-workspace-geometry.test.tsx`](../../apps/mobile/src/features/layout/fold-workspace-geometry.test.tsx).
Retain that guarantee when adapting the test to changed APIs; restoring a rail is a regression,
not a reason to change the expected pane width. The test covers geometry; confirming the top
switcher and reachable actions also requires tracing their rendered branches.

## The procedure

Use the repository's [upstream skill](../../.agents/skills/upstream/SKILL.md) for preparation,
resolution, verification, and delivery. It supports a local sync, a requested PR, or an explicitly
requested direct landing on Fold's `main`. Preserve a real merge commit in every path: rebasing or
squashing discards the merge base and makes later syncs replay integrated conflicts.

The merge commit records why each non-obvious conflict was settled that way. The next maintainer
should be able to recover the feature-preservation decision without repeating the investigation.

## Keeping Fold's footprint small

Conflicts come only from Fold's edits inside upstream-owned files; Fold-only files merge for free.
New Fold behavior goes in a Fold-owned module (`fold*` names, `*.fold.test.ts` tests, or a feature
folder only Fold has), and the upstream file gets a seam: one import plus a call, spread, or
wrapper, placed on lines upstream rarely edits. `packages/contracts/src/foldRpc.ts`,
`apps/server/src/foldWs.ts`, `apps/web/src/fold.css`, and `apps/mobile/foldAppConfig.ts` are the
patterns to copy. When Fold must replace an upstream component wholesale, fork it into a Fold file
and leave upstream's copy untouched rather than rewriting it in place: the copy merges cleanly,
at the price of picking up its upstream fixes by hand.

## Resolving conflicts

Fold's divergence falls into a few recurring shapes. Recognising which one a conflict is usually
decides it:

- **Upstream reworks a region Fold moved.** Fold relocated the chat header's script, open-in, and
  Git controls into `ThreadDetailsPanel`, and replaced the queued-message timeline row with its own
  queue UI. Upstream changes aimed at the old locations do not apply; take Fold's side and check
  whether the change has a home in Fold's replacement.
- **Both sides add a variant of the same component.** Prefer upstream's prop name and fold Fold's
  variant in as an extra union member — see the `presentation` prop on `OpenInPicker`,
  `ProjectScriptsControl`, and `GitActionsControl`. Renaming upstream's API to match Fold's
  convention makes every later upstream hunk on that prop conflict.
- **Upstream extracts shared JSX.** Reuse the extraction (`editorItems`, `scriptItems`, `gitItems`)
  from Fold's branches too, rather than keeping a second inline copy that has to be edited twice.
- **A deleted file comes back as modify/delete.** Orchestration v2 removed the v1 harnesses
  (`apps/server/src/bin.test.ts`, `apps/server/src/server.test.ts`). They stay deleted.

Upstream code that Fold does not currently reach — such as the collapsed-header `presentation:
"menu"` branches — is still worth carrying. It costs nothing at runtime and keeps those files
merging cleanly.

Git auto-merges hunks that are textually disjoint but semantically incompatible, so a sync is not
finished when the conflict markers are gone. Typecheck the workspaces you touched before
committing; that is what catches leftover references to props Fold removed.

## Afterwards

Walk the README's "More than upstream" table and confirm each feature still has its code, entry
points, and settings on every surface it lists. Then update the upstream baseline commit and date
in that section's preamble, and move any feature upstream now ships out of the table, so it stays
honest about what is Fold's.
