import { useAtomValue } from "@effect/atom-react";
import {
  collectMergedPullRequests,
  sameMerges,
  type MergedPullRequest,
} from "@t3tools/shared/mergeSplatters";
import { Atom } from "effect/reactivity";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

/**
 * Every merged PR across connected environments, for the dynamic splatter.
 * Hands back the previous array while the merges are unchanged, so thread
 * activity that is not a merge never re-renders its readers. Unmounted, it
 * is not computed at all.
 */
let previousMergedPullRequests: ReadonlyArray<MergedPullRequest> = [];
const mergedPullRequestsAtom = Atom.make((get) => {
  const next = collectMergedPullRequests(
    get(environmentThreadShells.threadShellsAtom),
    get(environmentProjects.projectsAtom),
  );
  if (sameMerges(previousMergedPullRequests, next)) return previousMergedPullRequests;
  previousMergedPullRequests = next;
  return next;
}).pipe(Atom.withLabel("web-merged-pull-requests"));

export function useMergedPullRequests(): ReadonlyArray<MergedPullRequest> {
  return useAtomValue(mergedPullRequestsAtom);
}
