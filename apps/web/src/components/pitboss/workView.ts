import { msg } from "gt-react";
import { m } from "../../i18n/messages";
import {
  pitbossTaskNextAction,
  pitbossTaskNextActionLabel,
  workNeedsYou,
} from "@t3tools/contracts";
import type { PitbossSnapshot, PitbossTask, PitbossVerificationRecipe } from "@t3tools/contracts";

export const workFilters = ["All", "Needs you", "Working", "Delivered"] as const;
export type WorkFilter = (typeof workFilters)[number];

export function nextActionLabel(state: PitbossSnapshot, task: PitbossTask) {
  return pitbossTaskNextActionLabel(pitbossTaskNextAction(state, task));
}

/** Filters never truncate: every matching outcome remains reachable in the work list. */
export function filterWork<
  T extends Pick<
    PitbossTask,
    | "title"
    | "outcome"
    | "projectId"
    | "status"
    | "decisions"
    | "proposedVerificationRecipe"
    | "priority"
    | "attempts"
  >,
>(
  tasks: readonly T[],
  filter: WorkFilter,
  search: string,
  projectId: string,
  awaitingApproval?: PitbossSnapshot["awaitingApproval"],
) {
  const query = search.trim().toLocaleLowerCase();
  const needsYou = (task: T) => workNeedsYou(task, awaitingApproval);
  return tasks
    .filter(
      (task) =>
        (!projectId || task.projectId === projectId) &&
        (!query || `${task.title} ${task.outcome}`.toLocaleLowerCase().includes(query)) &&
        (filter === "All" ||
          (filter === "Needs you" && needsYou(task)) ||
          (filter === "Working" &&
            !["done", "cancelled"].includes(task.status) &&
            !needsYou(task)) ||
          (filter === "Delivered" && task.status === "done")),
    )
    .toSorted((a, b) => a.priority - b.priority);
}

export function evidenceKind(recipe: Pick<PitbossVerificationRecipe, "mode"> | undefined) {
  if (!recipe) return m(msg("Outcome"));
  if (recipe.mode === "artifact") return m(msg("Files & research"));
  if (recipe.mode === "observation") return m(msg("Host observation"));
  return m(msg("Code"));
}
