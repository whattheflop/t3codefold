import { GladosBoard } from "./GladosBoard";
import { isUserWorkMessage, workNeedsYou } from "@t3tools/contracts";
import { WorkInspector } from "./WorkInspector";
import {
  evidenceKind,
  filterWork,
  nextActionLabel,
  workFilters,
  type WorkFilter,
} from "./workView";
import { managedWorkerStateLabel } from "@t3tools/client-runtime/glados-board";
import { CreateHome } from "./CreateHome";
import { TaskDecisionCard } from "./TaskDecisionCard";
import { VerificationCard, VerificationArtifact } from "./VerificationCard";
import { useProjects, useServerConfigs } from "../../state/entities";
import { randomUUID } from "../../lib/utils";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CrownIcon,
  ArrowUpRightIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  MessageSquareIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ArrowLeftIcon,
  Settings2Icon,
} from "lucide-react";
import {
  CommandId,
  isPitbossLeadActive,
  hasCurrentVerification,
  pitbossMessageHeadline,
  verificationRecipeForTask,
  type EnvironmentId,
  type RuntimeMode,
  type PitbossAction,
  type PitbossTask,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/50";
const statusLabel: Record<PitbossTask["status"], string> = {
  queued: "Planned",
  active: "Working",
  verifying: "In review",
  done: "Delivered",
  blocked: "Waiting",
  cancelled: "Closed",
};
const statusClass: Record<PitbossTask["status"], string> = {
  queued: "text-muted-foreground",
  active: "text-sky-600 dark:text-sky-400",
  verifying: "text-amber-600 dark:text-amber-400",
  done: "text-emerald-600 dark:text-emerald-400",
  blocked: "text-orange-600 dark:text-orange-400",
  cancelled: "text-muted-foreground",
};

export function PitbossPin({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const query = useEnvironmentQuery(serverEnvironment.pitbossLive({ environmentId, input: {} }));
  const navigate = useNavigate();
  const reopen = useAtomCommand(serverEnvironment.pitbossCommand, { label: "Open GLaDOS" });
  const [openError, setOpenError] = useState<string | null>(null);
  const role = query.data?.role;
  const questions =
    query.data?.tasks.filter((task) => workNeedsYou(task, query.data?.awaitingApproval)).length ??
    0;
  return (
    <>
      <CreateHome environmentId={environmentId} label={label} />
      {role && (
        <button
          type="button"
          onClick={() => {
            if (!query.data) return;
            void reopen({
              environmentId,
              input: {
                commandId: CommandId.make(randomUUID()),
                expectedRevision: query.data.revision,
                action: { type: "activate-home", brief: role.brief },
              },
            }).then((result) => {
              if (result._tag === "Failure") {
                setOpenError(String(squashAtomCommandFailure(result)));
                return;
              }
              setOpenError(null);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: role.threadId },
              });
            });
          }}
          className="mx-1 my-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-3 text-left hover:bg-amber-500/10 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          <span className="rounded-lg bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
            <CrownIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">GLaDOS</span>
            <span className="block truncate text-xs text-muted-foreground">
              {openError ?? label}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {query.error
              ? "Offline"
              : role.paused
                ? "Paused"
                : questions
                  ? `${questions} need you`
                  : query.data?.tasks.some(
                        (task) => task.status === "active" || task.status === "verifying",
                      )
                    ? "Work active"
                    : "Ready"}
          </span>
        </button>
      )}
    </>
  );
}

export function PitbossPanel(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  runtimeMode: RuntimeMode;
  onComposeWork: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.pitbossLive({ environmentId: props.environmentId, input: {} }),
  );
  const mutate = useAtomCommand(serverEnvironment.pitbossCommand, { label: "GLaDOS work" });
  const serverConfigs = useServerConfigs();
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const projectName = (id: ProjectId) => projects.find((project) => project.id === id)?.title ?? id;
  const [workView, setWorkView] = useState<"board" | "list">("board");
  const [filter, setFilter] = useState<WorkFilter>("All");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [projectFilter, setProjectFilter] = useState("");
  const [isolatedWorkspace, setIsolatedWorkspace] = useState(false);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingTask, setEditingTask] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0 });
    if (selectedId) detailHeadingRef.current?.focus({ preventScroll: true });
  }, [selectedId]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({});
  const [workProjectId, setWorkProjectId] = useState<ProjectId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = query.data;
  const role = state?.role;
  const isBoss = role?.threadId === props.threadId;
  const openSettings = () =>
    void navigate({ to: "/settings/glados", search: { machine: props.environmentId } });
  const command = async (action: PitbossAction) => {
    if (!state || busy) return false;
    setBusy(true);
    setError(null);
    const result = await mutate({
      environmentId: props.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        expectedRevision: state.revision,
        action,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(String(squashAtomCommandFailure(result)));
      return false;
    }
    return true;
  };
  if (!state) return null;
  if (!isBoss) return null;
  const selected = state.tasks.find((task) => task.id === selectedId);
  const questions = state.messages.filter(isUserWorkMessage);
  const active = state.tasks.filter(
    (task) => task.status === "active" || task.status === "verifying",
  );
  const next = state.tasks
    .filter((task) => task.status === "queued")
    .toSorted((a, b) => a.priority - b.priority);
  const visibleTasks = filterWork(
    state.tasks,
    filter,
    search,
    projectFilter,
    state.awaitingApproval,
  );
  const needsYou = (task: PitbossTask) => workNeedsYou(task, state.awaitingApproval);
  const attention = state.tasks.filter(needsYou);
  const openThread = (threadId: ThreadId, environmentId?: EnvironmentId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: environmentId ?? props.environmentId, threadId },
    });
  const workList = (
    <>
      {questions.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Needs attention
          </h3>
          {questions.map((message) => (
            <div key={message.id} className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <details className="col-span-2">
                <summary className="cursor-pointer">{pitbossMessageHeadline(message)}</summary>
                <p className="mt-2 whitespace-pre-wrap">{message.text}</p>
              </details>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (message.taskId) setSelectedId(message.taskId);
                }}
              >
                Inspect
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void command({ type: "acknowledge", messageId: message.id })}
              >
                Acknowledge
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1" aria-label="Filter work">
          {workFilters.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              className={filter === value ? "bg-background shadow-sm" : "text-muted-foreground"}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search work"
          placeholder="Find an outcome…"
          className={fieldClass}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setVisibleCount(20);
          }}
        />
        <select
          aria-label="Filter work by project"
          className={fieldClass}
          value={projectFilter}
          onChange={(event) => {
            setProjectFilter(event.target.value);
            setVisibleCount(20);
          }}
        >
          <option value="">All projects</option>
          {[...new Set(state.tasks.map((task) => task.projectId))].map((id) => (
            <option key={id} value={id}>
              {projectName(id)}
            </option>
          ))}
        </select>
      </div>
      {!visibleTasks.length && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {state.tasks.length
            ? "No outcomes match these filters."
            : "Describe what you want in chat. GLaDOS can coordinate code, research, creative work or operations and bring back results for review."}
        </p>
      )}
      <div className="grid min-w-0 gap-4">
        {[
          { label: "Needs you", tasks: visibleTasks.filter(needsYou) },
          {
            label: "With GLaDOS",
            tasks: visibleTasks.filter(
              (task) => !needsYou(task) && ["active", "verifying", "blocked"].includes(task.status),
            ),
          },
          {
            label: "Up next",
            tasks: visibleTasks.filter((task) => !needsYou(task) && task.status === "queued"),
          },
          {
            label: "Delivered",
            tasks: visibleTasks.filter((task) => task.status === "done"),
          },
          { label: "Closed", tasks: visibleTasks.filter((task) => task.status === "cancelled") },
        ]
          .filter(({ tasks }) => tasks.length > 0)
          .map(({ label, tasks }) => {
            return (
              <div key={String(label)} className="min-w-0 py-1">
                <h3 className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
                  {String(label)} <span>{tasks.length}</span>
                </h3>
                {tasks.slice(0, visibleCount).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => setSelectedId(task.id)}
                    aria-pressed={selected?.id === task.id}
                    className={`group mb-1 block w-full min-w-0 rounded-lg border px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === task.id ? "border-primary/30 bg-muted/60" : "border-transparent hover:border-border/60"}`}
                  >
                    <span className="mb-1 block text-[11px] text-muted-foreground">
                      {projectName(task.projectId)} ·{" "}
                      {evidenceKind(verificationRecipeForTask(state, task))}
                    </span>
                    <span className="block text-sm font-medium leading-snug">{task.title}</span>
                    {task.leadId && (
                      <span className="block text-xs text-muted-foreground">
                        Lead ·
                        {state.leads?.find(
                          (lead) =>
                            lead.id === task.leadId &&
                            isPitbossLeadActive(role, lead) &&
                            lead.projectId === task.projectId,
                        )?.id ?? "GLaDOS"}
                      </span>
                    )}
                    <span className={`text-xs ${statusClass[task.status]}`}>
                      {statusLabel[task.status]}
                      {nextActionLabel(state, task) ? ` · ${nextActionLabel(state, task)}` : ""}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {task.note || task.outcome}
                    </span>
                  </button>
                ))}
                {tasks.length > visibleCount && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 w-full"
                    onClick={() => setVisibleCount((count) => count + 20)}
                  >
                    Show more · {tasks.length - visibleCount} remaining
                  </Button>
                )}
              </div>
            );
          })}
      </div>
      <details
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
        className="mt-4 border-t border-border pt-3"
      >
        <summary className="cursor-pointer text-sm font-medium">
          Manual work and project leads
        </summary>
        <Button
          size="sm"
          variant="ghost"
          className="mt-3"
          disabled={!role?.brief.projectIds.length}
          onClick={() => setAdding(true)}
        >
          <PlusIcon className="size-3" />
          Add work manually
        </Button>
        {role && !selected && (state.leads ?? []).length > 0 && (
          <div className="mb-4 space-y-2" aria-label="Project leads">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Project leads · report to GLaDOS</span>
              <span>{role.brief.maxWorkers} shared workers · 1 lead turn at a time</span>
            </div>
            {(state.leads ?? []).map((lead) => {
              const active = isPitbossLeadActive(role, lead);
              const tasks = state.tasks.filter((task) => task.leadId === lead.id);
              return (
                <div key={lead.id} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openThread(lead.threadId)}>
                      {lead.id}
                      <ArrowUpRightIcon className="size-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {active ? "Managing" : "Dormant"} · {lead.model.model} · up to{" "}
                      {lead.maxWorkers} workers
                    </span>
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !role.brief.projectIds.includes(lead.projectId)}
                      onClick={() =>
                        void command({
                          type: "lead-status",
                          leadId: lead.id,
                          status: active ? "dormant" : "active",
                        })
                      }
                    >
                      {active ? "Return to GLaDOS" : "Reactivate"}
                    </Button>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {projectName(lead.projectId)} · this environment · thread {lead.threadId}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm">{lead.charter}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tasks.filter((task) => task.status === "done").length} / {tasks.length}{" "}
                    outcomes accepted · Context revision {lead.contextRevision}
                  </p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Project context and decisions
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">
                      {lead.context || "The lead has not recorded project context yet."}
                    </p>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </details>
    </>
  );
  return (
    <section aria-label="GLaDOS workspace" className="contents">
      <div className="col-span-2 flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <CrownIcon className="size-4 text-amber-600 dark:text-amber-400" />
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          GLaDOS{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {role.paused ? "Paused" : `${active.length} working · ${next.length} up next`}
          </span>
          <ChevronDownIcon className="size-3" />
        </button>
        <span className="text-xs text-muted-foreground">
          {props.runtimeMode === "full-access" &&
          role.brief.workerRuntimeMode === "full-access" &&
          role.brief.verificationMode === "automatic" ? (
            "Full auto · checks by GLaDOS"
          ) : (
            <>
              GLaDOS: {props.runtimeMode.replaceAll("-", " ")} · New workers:{" "}
              {role.brief.workerRuntimeMode === "full-access" ? "full access" : "approvals"} ·{" "}
              {role.brief.verificationMode === "automatic" ? "Checks by GLaDOS" : "Recipe review"}
            </>
          )}
        </span>
        {attention.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedId(null);
              setFilter("Needs you");
              setProjectFilter("");
              setSearch("");
              setOpen(true);
            }}
          >
            Needs you · {attention.length}
          </Button>
        )}
        {role.brief.coordinatorRuntimeMode &&
          role.brief.coordinatorRuntimeMode !== props.runtimeMode && (
            <span role="status" className="text-xs text-amber-600">
              Current and saved GLaDOS permissions differ · choose autonomy in GLaDOS settings to
              apply
            </span>
          )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void command({ type: "pause", paused: !role.paused })}
        >
          {role.paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
          {role.paused ? "Resume" : "Pause"}
        </Button>
        <Button size="sm" variant="ghost" onClick={openSettings}>
          <Settings2Icon className="size-3" />
          Settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(false);
            props.onComposeWork();
          }}
        >
          <MessageSquareIcon className="size-3" />
          Talk to GLaDOS
        </Button>
      </div>
      {(error || query.error) && (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive">
          {error ?? query.error}
        </p>
      )}
      <WorkInspector
        open={open}
        onOpenChange={setOpen}
        onReturnToChat={props.onComposeWork}
        scrollRef={inspectorRef}
        selected={!!selected}
        boardMode={workView === "board"}
        list={
          isBoss && !adding ? (
            workView === "board" ? (
              <GladosBoard
                state={state}
                search={search}
                onSearch={setSearch}
                projectFilter={projectFilter}
                onProjectFilter={setProjectFilter}
                projectName={projectName}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpenWorker={(task, threadId) =>
                  openThread(threadId, task.homeEnvironmentId ?? props.environmentId)
                }
                onTalkToGlados={() => setOpen(false)}
              />
            ) : (
              workList
            )
          ) : undefined
        }
        header={
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <div className="mr-auto">
              <h2 className="text-lg font-semibold">GLaDOS work</h2>
              <p className="text-xs text-muted-foreground">
                {role?.paused
                  ? "New work paused"
                  : `${active.length} working · ${next.length} planned`}
              </p>
            </div>
            <div className="flex gap-1" aria-label="Work view">
              {(["board", "list"] as const).map((view) => (
                <Button
                  key={view}
                  size="sm"
                  variant={workView === view ? "secondary" : "ghost"}
                  aria-pressed={workView === view}
                  onClick={() => setWorkView(view)}
                >
                  {view === "board" ? "Board" : "Advanced"}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={openSettings}>
              <Settings2Icon className="size-3" /> Settings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void command({ type: "pause", paused: !role?.paused })}
            >
              {role?.paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
              {role?.paused ? "Resume" : "Pause"}
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              <MessageSquareIcon className="size-3" /> Talk to GLaDOS
            </Button>
            {(error || query.error) && (
              <p role="alert" className="w-full text-sm text-destructive">
                {error ?? query.error}
              </p>
            )}
          </div>
        }
      >
        {isBoss && adding && (
          <label className="mb-3 block text-sm">
            Project
            <select
              className={fieldClass}
              aria-label="Project"
              value={workProjectId ?? role.brief.projectIds[0] ?? ""}
              onChange={(event) =>
                setWorkProjectId(
                  role.brief.projectIds.find((id) => id === event.target.value) ?? null,
                )
              }
            >
              {role.brief.projectIds.map((id) => (
                <option key={id} value={id}>
                  {projectName(id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {isBoss && adding && (
          <label className="mb-3 grid gap-1 text-xs">
            Workspace
            <select
              className={fieldClass}
              aria-label="Workspace"
              value={isolatedWorkspace ? "worktree" : "root"}
              onChange={(event) => setIsolatedWorkspace(event.target.value === "worktree")}
            >
              <option value="root">Project files — research, creative work and operations</option>
              <option value="worktree">Isolated Git worktree — code changes</option>
            </select>
            <span className="text-muted-foreground">
              Choose where the worker operates. Evidence is configured separately for the outcome.
            </span>
          </label>
        )}
        {isBoss && adding && (
          <TaskForm
            busy={busy}
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              if (
                await command({
                  type: "create",
                  taskId: randomUUID(),
                  projectId: workProjectId ?? role.brief.projectIds[0]!,
                  ...values,
                  priority: 50,
                  dependencies: [],
                  workspaceStrategy: isolatedWorkspace
                    ? { type: "worktree", baseRef: "HEAD" }
                    : { type: "root" },
                })
              )
                setAdding(false);
            }}
          />
        )}
        {isBoss && !adding && workView === "board" && selected && (
          <div className="space-y-4 p-2">
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              Back to board
            </Button>
            <h3 ref={detailHeadingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
              {selected.title}
            </h3>
            <p className="text-sm text-muted-foreground">
              {statusLabel[selected.status]} · {projectName(selected.projectId)}
            </p>
            <p className="whitespace-pre-wrap text-sm">{selected.outcome}</p>
            {selected.note && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selected.note}</p>
            )}
            {state.messages
              .filter((message) => message.taskId === selected.id && !message.acknowledged)
              .map((message) => (
                <details key={message.id} className="rounded-lg border border-border p-3 text-sm">
                  <summary className="cursor-pointer">{pitbossMessageHeadline(message)}</summary>
                  <p className="mt-2 whitespace-pre-wrap">{message.text}</p>
                </details>
              ))}
            <p className="text-xs text-muted-foreground">
              GLaDOS coordinates workers and verification. You can give direction or answer
              questions in chat.
            </p>
            <Button onClick={() => setOpen(false)}>Talk to GLaDOS</Button>
            <h4 className="text-sm font-medium">Evidence · {selected.evidence.length}</h4>
            {selected.evidence.map((evidence) => (
              <article key={evidence.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">
                  {evidence.verdict} · {evidence.provenance.replaceAll("_", " ")}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{evidence.summary}</p>
              </article>
            ))}
          </div>
        )}
        {isBoss && !adding && workView === "list" && (
          <>
            {!selected && (
              <div className="flex min-h-64 flex-col justify-center p-5">
                <h3 className="text-xl font-semibold">Choose an outcome</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  See its progress, evidence and next decision here.
                </p>
                <p className="mt-5 text-sm text-muted-foreground">
                  For new work, tell GLaDOS what you want in chat.
                </p>
              </div>
            )}
            {selected && (
              <div className="mt-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3
                      ref={detailHeadingRef}
                      tabIndex={-1}
                      className="text-xl font-semibold outline-none"
                    >
                      {selected.title}
                    </h3>
                    <p className={`text-xs ${statusClass[selected.status]}`}>
                      {statusLabel[selected.status]}
                      {nextActionLabel(state, selected)
                        ? ` · ${nextActionLabel(state, selected)}`
                        : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                    <ArrowLeftIcon className="size-3" /> Back
                  </Button>
                </div>
                <TaskDecisionCard
                  key={`decision:${selected.id}`}
                  draft={decisionDrafts[`${props.environmentId}:${selected.id}`] ?? ""}
                  onDraftChange={(value) =>
                    setDecisionDrafts((drafts) => ({
                      ...drafts,
                      [`${props.environmentId}:${selected.id}`]: value,
                    }))
                  }
                  task={selected}
                  busy={busy}
                  command={command}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {projectName(selected.projectId)} ·{" "}
                  {selected.leadId ? `Project lead ${selected.leadId}` : "Managed by GLaDOS"} ·{" "}
                  {selected.homeEnvironmentId
                    ? `Task home ${selected.homeEnvironmentId}`
                    : "This environment"}
                  {" · "}
                  {evidenceKind(verificationRecipeForTask(state, selected))}
                </p>
                <p className="my-3 whitespace-pre-wrap text-sm leading-relaxed">
                  {selected.outcome}
                </p>
                {selected.note && (
                  <p className="mb-3 rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                    {selected.note}
                  </p>
                )}
                {selected.closedReason && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Closure history · {selected.closedReason}
                    {selected.closedAt ? ` · ${new Date(selected.closedAt).toLocaleString()}` : ""}
                  </p>
                )}
                {selected.dependencies.length > 0 && (
                  <div className="my-3 space-y-1 text-xs">
                    <h4 className="font-medium">Depends on</h4>
                    {selected.dependencies.map((id) => {
                      const dependency = state.tasks.find((task) => task.id === id);
                      return dependency ? (
                        <button
                          key={id}
                          type="button"
                          className="block text-left underline underline-offset-2"
                          onClick={() => setSelectedId(id)}
                        >
                          {dependency.title} · {dependency.status}
                        </button>
                      ) : (
                        <p key={id}>{id} · unavailable</p>
                      );
                    })}
                  </div>
                )}
                {selected.source && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    {selected.source.kind} · {selected.source.key} · Source status:{" "}
                    {selected.source.status} · T3 work: {selected.status}
                  </p>
                )}
                {selected.pendingOperationId && (
                  <p role="status" className="my-2 text-sm text-muted-foreground">
                    Waiting for the task home to acknowledge this request.
                  </p>
                )}
                <details className="my-3 rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Success criteria and verification plan
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{selected.criteria}</p>
                  {selected.verifyCommand && (
                    <pre className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                      {selected.verifyCommand}
                    </pre>
                  )}
                </details>
                <details
                  className="my-3"
                  open={selected.proposedVerificationRecipe ? true : undefined}
                >
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    Evidence profile and captured checks
                  </summary>
                  <VerificationCard
                    key={`verification:${selected.id}`}
                    task={selected}
                    automatic={role.brief.verificationMode === "automatic"}
                    recipe={state ? verificationRecipeForTask(state, selected) : undefined}
                    recipes={
                      state?.verificationRecipes?.filter(
                        (recipe) => recipe.projectId === selected.projectId,
                      ) ?? []
                    }
                    busy={busy}
                    paused={!!role?.paused}
                    environmentId={selected.homeEnvironmentId ?? props.environmentId}
                    command={command}
                  />
                </details>
                {selected.attempts.length > 0 && (
                  <details className="my-3">
                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                      Worker history · {selected.attempts.length}
                    </summary>
                    {selected.attempts.map((attempt) => (
                      <div
                        key={attempt.id}
                        className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-2 text-xs"
                      >
                        <span>
                          Attempt {attempt.generation} · {attempt.model.model} ·{" "}
                          {managedWorkerStateLabel(selected, attempt, state.awaitingApproval)}
                          {" · "}
                          {attempt.runtimeMode?.replaceAll("-", " ") ??
                            "permissions: legacy saved default"}
                          {attempt.workspacePath ? ` · ${attempt.workspacePath}` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={
                            !serverConfigs.has(selected.homeEnvironmentId ?? props.environmentId)
                          }
                          onClick={() =>
                            openThread(
                              attempt.threadId,
                              selected.homeEnvironmentId ?? props.environmentId,
                            )
                          }
                        >
                          {serverConfigs.has(selected.homeEnvironmentId ?? props.environmentId)
                            ? "Open worker"
                            : "Connect task home first"}
                          <ArrowUpRightIcon className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
                {selected.evidence.length > 0 && (
                  <h4 className="mt-5 text-xs font-medium text-muted-foreground">
                    Results and evidence
                  </h4>
                )}
                {selected.evidence.map((evidence) => (
                  <article key={evidence.id} className="mt-3 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {evidence.verdict === "pass" ? (
                        <CheckCircle2Icon className="size-4 text-emerald-600" />
                      ) : (
                        <CircleAlertIcon className="size-4 text-amber-600" />
                      )}
                      {evidence.verdict}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {evidence.provenance.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{evidence.summary}</p>
                    {evidence.capture &&
                      evidence.id !== `verification:${selected.verification?.id}` && (
                        <details className="mt-2 text-xs">
                          <summary>
                            Retained receipt · recipe v{evidence.capture.recipeVersion}
                          </summary>
                          {evidence.capture.receipt.checks.map((check) => (
                            <pre
                              key={check.name}
                              className="my-2 max-h-40 overflow-auto whitespace-pre-wrap"
                            >
                              {check.name} · exit {check.code}
                              {"\n"}
                              {check.stdout}
                              {check.stderr}
                            </pre>
                          ))}
                          {evidence.capture.receipt.artifacts.map((artifact) => (
                            <VerificationArtifact
                              key={artifact.attachmentId}
                              artifact={artifact}
                              environmentId={selected.homeEnvironmentId ?? props.environmentId}
                            />
                          ))}
                        </details>
                      )}

                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {evidence.candidate}
                    </p>
                    {evidence.artifactUrls
                      .filter((url) => /^https?:\/\//.test(url))
                      .map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block truncate text-xs underline"
                        >
                          Open evidence: {url}
                        </a>
                      ))}
                    {selected.status === "verifying" && evidence.verdict === "pass" && (
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        disabled={
                          busy ||
                          !!selected.pendingOperationId ||
                          (!!state &&
                            !!verificationRecipeForTask(state, selected) &&
                            verificationRecipeForTask(state, selected)?.enabled !== false &&
                            !hasCurrentVerification(
                              selected,
                              state ? verificationRecipeForTask(state, selected) : undefined,
                              evidence.candidate,
                            ))
                        }
                        onClick={() =>
                          void command({
                            type: "accept",
                            taskId: selected.id,
                            evidenceId: evidence.id,
                            note: "User inspected and accepted the evidence.",
                          })
                        }
                      >
                        Accept inspected evidence
                      </Button>
                    )}
                  </article>
                ))}
                {editingTask && (
                  <TaskForm
                    key={selected.id}
                    initial={selected}
                    busy={busy || !!selected.pendingOperationId}
                    onCancel={() => setEditingTask(false)}
                    onSave={async (values) => {
                      if (
                        await command({
                          type: "edit",
                          taskId: selected.id,
                          projectId: selected.projectId,
                          ...values,
                          priority: selected.priority,
                          dependencies: selected.dependencies,
                          workspaceStrategy: selected.workspaceStrategy,
                        })
                      )
                        setEditingTask(false);
                    }}
                  />
                )}
                <details className="mt-4 border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    Manage work
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !!selected.pendingOperationId}
                      onClick={() => setEditingTask(!editingTask)}
                    >
                      Edit task and criteria
                    </Button>
                    {selected.status === "queued" && selected.attempts.length === 0 && (
                      <Button
                        size="sm"
                        disabled={busy || !!selected.pendingOperationId}
                        onClick={() => void command({ type: "assign", taskId: selected.id })}
                      >
                        Assign worker
                      </Button>
                    )}
                    {selected.status !== "cancelled" &&
                      !selected.revisionRequest &&
                      (selected.attempts.length > 0 || selected.evidence.length > 0) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !!selected.pendingOperationId}
                          onClick={() =>
                            void command({
                              type: "revise-result",
                              taskId: selected.id,
                              note: "Revise the retained result within the current scope.",
                            })
                          }
                        >
                          Revise result
                        </Button>
                      )}
                    {selected.status === "cancelled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !!selected.pendingOperationId}
                        onClick={() => void command({ type: "reopen", taskId: selected.id })}
                      >
                        Restore to queue
                      </Button>
                    )}
                    {selected.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !!selected.pendingOperationId}
                        onClick={() =>
                          void command({
                            type: "close",
                            taskId: selected.id,
                            reason: "Closed by user as historical or superseded work.",
                          })
                        }
                      >
                        Close outcome
                      </Button>
                    )}
                  </div>
                </details>
              </div>
            )}
          </>
        )}
      </WorkInspector>
    </section>
  );
}

function TaskForm({
  busy,
  onSave,
  onCancel,
  initial,
}: {
  initial?: Pick<PitbossTask, "title" | "outcome" | "criteria" | "verifyCommand">;
  busy: boolean;
  onSave: (values: {
    title: string;
    outcome: string;
    criteria: string;
    verifyCommand: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [outcome, setOutcome] = useState(initial?.outcome ?? "");
  const [criteria, setCriteria] = useState(initial?.criteria ?? "");
  const [verifyCommand, setVerifyCommand] = useState(initial?.verifyCommand ?? "");
  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ title, outcome, criteria, verifyCommand });
      }}
    >
      <h3 className="font-semibold">A clear outcome, with a way to prove it</h3>
      <label className="grid gap-1 text-xs">
        Task
        <input
          required
          className={fieldClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs">
        Desired outcome
        <textarea
          required
          className={fieldClass}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs">
        Acceptance criteria
        <textarea
          required
          className={fieldClass}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs">
        Verification command or recipe
        <input
          className={fieldClass}
          value={verifyCommand}
          onChange={(event) => setVerifyCommand(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          {initial ? "Save task" : "Add task"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
