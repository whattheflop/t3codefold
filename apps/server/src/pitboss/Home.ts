import {
  CommandId,
  PitbossError,
  ProjectId,
  ThreadId,
  type PitbossBrief,
  type PitbossCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { ProjectService } from "../project/ProjectService.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { WorkspacePaths } from "../workspace/WorkspacePaths.ts";
import { WorkStore } from "./WorkStore.ts";

const isPitbossError = Schema.is(PitbossError);

/** One environment-owned home. Stable identities let retries recover partial provisioning. */
export const makeHome = Effect.fn("GLaDOS.makeHome")(function* (stateDir: string) {
  const work = yield* WorkStore;
  const workspacePaths = yield* WorkspacePaths;
  const projects = yield* ProjectService;
  const threads = yield* ThreadManagementService;
  const launch = yield* ThreadLaunchService;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const provision = Effect.fn("GLaDOS.provisionHome")(function* (
    input: PitbossCommand,
    brief: PitbossBrief,
    expectedRevision: number,
  ) {
    const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(
      path.join(stateDir, "glados"),
      { createIfMissing: true },
    );
    const home = yield* projects.bootstrap({
      commandId: CommandId.make(`${input.commandId}:project`),
      projectId: ProjectId.make("glados-home"),
      title: "GLaDOS",
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: brief.workerModel,
    });
    const homeThreads = (yield* threads.listProjectThreads({
      projectId: home.project.id,
      includeSubagents: true,
    })).filter((thread) => thread.id.startsWith(`glados-home:${home.project.id}`));
    // Reuse a live home thread so retries recover partial provisioning. A reset archives the
    // old conversation, so the next home gets a new, revision-stamped identity instead.
    const live = homeThreads.at(-1);
    const originalId = ThreadId.make(`glados-home:${home.project.id}`);
    const threadId =
      live?.id ??
      ThreadId.make(
        !(yield* threads.getThreadShell(originalId))
          ? `glados-home:${home.project.id}`
          : `glados-home:${home.project.id}:${expectedRevision}`,
      );
    const runtimeMode = brief.coordinatorRuntimeMode ?? "approval-required";
    if (!live) {
      yield* launch.launch({
        commandId: CommandId.make(`${input.commandId}:thread`),
        threadId,
        projectId: home.project.id,
        title: "GLaDOS",
        modelSelection: brief.workerModel,
        runtimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      });
    } else {
      yield* threads.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make(`${input.commandId}:permissions`),
        threadId,
        runtimeMode,
      });
    }
    // The original revision fences a concurrent election; never replace its authority.
    return yield* work.command(
      {
        ...input,
        expectedRevision,
        action: {
          type: "elect",
          startCoordinator: true,
          threadId,
          projectId: home.project.id,
          brief,
        },
      },
      { type: "user" },
    );
  });
  return Effect.fn("GLaDOS.openHome")(
    function* (input: PitbossCommand) {
      const current = yield* work.read();
      if (input.action.type === "reset") {
        const role = current.role;
        if (!role)
          return yield* new PitbossError({ code: "invalid", message: "GLaDOS is not set up." });
        const cleared = yield* work.command(input, { type: "user" });
        // Only a home thread is retired; a user thread elected as GLaDOS stays theirs.
        if (role.threadId.startsWith("glados-home:")) {
          const previous = yield* threads.getProjectThreadRecords(
            {
              projectId: role.projectId,
              threadId: role.threadId,
            },
            [],
          );
          if (previous.thread.archivedAt === null)
            yield* threads.dispatch({
              type: "thread.archive",
              commandId: CommandId.make(`${input.commandId}:archive`),
              threadId: role.threadId,
            });
        }
        return yield* provision(
          { ...input, commandId: CommandId.make(`${input.commandId}:home`) },
          role.brief,
          cleared.revision,
        );
      }
      if (input.action.type !== "activate-home")
        return yield* new PitbossError({ code: "invalid", message: "Expected a home request." });
      if (current.role) {
        const elected = yield* threads.getProjectThreadRecords(
          {
            projectId: current.role.projectId,
            threadId: current.role.threadId,
          },
          [],
        );
        if (elected.thread.archivedAt !== null)
          yield* threads.dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(`${input.commandId}:restore`),
            threadId: current.role.threadId,
          });
        return current;
      }
      if (input.expectedRevision !== current.revision)
        return yield* new PitbossError({
          code: "conflict",
          message: "Work changed. Refresh before creating GLaDOS.",
        });
      return yield* provision(input, input.action.brief, input.expectedRevision);
    },
    lock.withPermit,
    Effect.mapError((cause) =>
      isPitbossError(cause)
        ? cause
        : new PitbossError({
            code: "unavailable",
            message: `GLaDOS home could not be opened: ${String(cause)}. Retry to reuse any files already created.`,
          }),
    ),
  );
});
