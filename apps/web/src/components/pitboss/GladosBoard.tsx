import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";
import { FolderIcon, GitBranchIcon, BotIcon, ArrowUpRightIcon } from "lucide-react";
import { buildGladosBoard, managedWorkerRows } from "@t3tools/client-runtime/glados-board";
import {
  pitbossMessageHeadline,
  type PitbossSnapshot,
  type PitbossTask,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { Button } from "../ui/button";

const dots = {
  attention: "bg-warning",
  working: "bg-sky-500",
  review: "bg-violet-500",
  done: "bg-emerald-500",
  muted: "bg-muted-foreground/50",
};

/** GLaDOS outcomes in the compact live-column layout of t3code-custom's board. */
export function GladosBoard(props: {
  state: PitbossSnapshot;
  search: string;
  onSearch: (value: string) => void;
  projectFilter: string;
  onProjectFilter: (value: string) => void;
  projectName: (id: ProjectId) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenWorker: (task: PitbossTask, threadId: ThreadId) => void;
  onTalkToGlados: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const lanes = buildGladosBoard(
    props.state,
    {
      query: props.search,
      projectId: props.projectFilter,
    },
    m,
  );
  const [limits, setLimits] = useState<Record<string, number>>({});
  const count = lanes.reduce((total, lane) => total + lane.items.length, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h3 className="mr-auto text-sm font-semibold">
          <T>Board </T>
          <span className="ml-2 font-normal text-muted-foreground">{count} cards</span>
        </h3>
        <input
          type="search"
          aria-label={gt("Search Glados board")}
          placeholder={gt("Find an outcome…")}
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          className="h-9 min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <select
          aria-label={gt("Board project")}
          value={props.projectFilter}
          onChange={(event) => props.onProjectFilter(event.target.value)}
          className="h-9 max-w-56 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">
            <T>All projects</T>
          </option>
          {[...new Set(props.state.tasks.map((task) => task.projectId))].map((id) => (
            <option key={id} value={id}>
              {props.projectName(id)}
            </option>
          ))}
        </select>
        <p className="w-full text-xs text-muted-foreground">
          <T>
            GLaDOS manages this work. Follow progress here; give direction and answer questions in
            chat.
          </T>
        </p>
      </div>
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain p-4"
        role="region"
        aria-label={gt("Glados Kanban board")}
        tabIndex={0}
      >
        {lanes.map((lane) => (
          <section
            key={lane.id}
            aria-label={gt("{label}, {length} cards", {
              label: lane.label,
              length: lane.items.length,
            })}
            className="flex min-h-0 w-72 shrink-0 flex-col rounded-2xl border border-border/70 bg-muted/15"
          >
            <h4 className="flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium">
              <span aria-hidden className={`size-2 rounded-full ${dots[lane.tone]}`} />
              {lane.label}
              <span className="font-normal tabular-nums text-muted-foreground">
                {lane.items.length}
              </span>
            </h4>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2 pb-3">
              {lane.items.length === 0 && (
                <p className="px-2 py-5 text-xs text-muted-foreground">
                  <T>No work here</T>
                </p>
              )}
              {lane.items.slice(0, limits[lane.id] ?? 30).map((item) =>
                item.task ? (
                  <article
                    key={item.key}
                    className={`rounded-xl border bg-card transition-colors hover:border-primary/50 ${props.selectedId === item.task.id ? "border-primary" : "border-border/70"}`}
                  >
                    <button
                      type="button"
                      aria-pressed={props.selectedId === item.task.id}
                      onClick={() => props.onSelect(item.task.id)}
                      className="block w-full p-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="flex items-start gap-2">
                        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">
                          {item.task.title}
                        </span>
                        <span
                          aria-hidden
                          className={`mt-1.5 size-2 shrink-0 rounded-full ${dots[lane.tone]}`}
                        />
                      </span>
                      <span className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <FolderIcon className="size-3 shrink-0" />
                        {props.projectName(item.task.projectId)}
                      </span>
                      {item.task.workspaceStrategy.type === "worktree" && (
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <GitBranchIcon className="size-3" />
                          <T>Isolated worktree</T>
                        </span>
                      )}
                      <span className="mt-2 block line-clamp-2 text-xs text-muted-foreground">
                        {item.task.note || item.task.outcome}
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                        <span>
                          {item.task.evidence.length}
                          <T> evidence · </T>
                          {item.task.attempts.length} attempts
                        </span>
                        <span className="flex min-w-0 items-center gap-1">
                          <BotIcon className="size-3 shrink-0" />
                          <span className="truncate">
                            {item.task.attempts.at(-1)?.model.model ?? "GLaDOS"}
                          </span>
                        </span>
                      </span>
                    </button>
                    {managedWorkerRows(item.task, props.state.awaitingApproval, m)
                      .slice(0, 1)
                      .map((worker) => (
                        <Button
                          key={worker.attemptId}
                          size="sm"
                          variant="ghost"
                          className="mx-2 mb-2 w-[calc(100%-1rem)] justify-between"
                          onClick={() => props.onOpenWorker(item.task, worker.threadId)}
                        >
                          <span className="truncate">
                            <T>Worker </T>
                            {worker.generation} · {worker.state}
                          </span>
                          <ArrowUpRightIcon className="size-3 shrink-0" />
                        </Button>
                      ))}
                  </article>
                ) : (
                  <article
                    key={item.key}
                    className="rounded-xl border border-warning/30 bg-card p-3"
                  >
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        {pitbossMessageHeadline(item.message)}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                        {item.message.text}
                      </p>
                    </details>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={props.onTalkToGlados}
                    >
                      <T>Talk to GLaDOS</T>
                    </Button>
                  </article>
                ),
              )}
              {lane.items.length > (limits[lane.id] ?? 30) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={() =>
                    setLimits((current) => ({
                      ...current,
                      [lane.id]: (current[lane.id] ?? 30) + 30,
                    }))
                  }
                >
                  <T>Show more · </T>
                  {lane.items.length - (limits[lane.id] ?? 30)} remaining
                </Button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
