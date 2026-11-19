import {
  OrchestratorMcpFailure,
  PitbossCommand,
  PitbossError,
  PitbossReadInput,
  PitbossSnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import { WorkStore } from "../../../pitboss/WorkStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  success: PitbossSnapshot,
  failure: Schema.Union([PitbossError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    WorkStore,
  ],
};

const WorkReadTool = Tool.make("work_read", {
  ...shared,
  description:
    "Needs an agent running inside a T3 thread. Read your pitboss brief, task assignments, criteria and messages. Workers see only their own tasks. Read the current revision before a work_command.",
  parameters: PitbossReadInput,
})
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients)
  .annotate(Tool.Title, "Read managed work")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const WorkCommandTool = Tool.make("work_command", {
  ...shared,
  description:
    "Needs an agent running inside a T3 thread. Manage durable T3 work using a typed action. GLaDOS can create-lead and lead-message; project leads manage only their own local tasks and use lead-context/lead-report. Create action requires type=create, taskId, projectId, title, outcome, criteria, verifyCommand, priority, dependencies, workspaceStrategy. create-lead, assign, and active lead-status may include runtimeMode='approval-required' or 'full-access'; it cannot exceed the calling thread's current mode, is saved for that launch, and omission uses the saved worker default. Include authorityGeneration from your role or lead record on management commands. Managers create/assign tasks, inspect and accept evidence, request rework, and acknowledge messages. Workers report questions/progress and submit candidate evidence. Retry an uncertain call with exactly the same commandId and payload. New decisions require the current snapshot revision. At the user's direction, elected GLaDOS may use clear-board to archive the visible board after active writers drain; this retains the role, journal, threads and worktrees and grants no project scope. When the user asks in conversation, GLaDOS records brief, pause, resolve-decision, approve-verification, verification-profile and verification-recipe changes herself, including revising proof after an attempt. Only electing the role still requires the user.",
  parameters: PitbossCommand,
})
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients)
  .annotate(Tool.Title, "Command managed work")
  .annotate(Tool.Destructive, true);

export const WorkToolkit = Toolkit.make(WorkReadTool, WorkCommandTool);
