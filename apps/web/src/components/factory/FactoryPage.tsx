import { T, useGT } from "gt-react";
import {
  FACTORY_CARD_KIND_LABEL,
  factoryAgentRows,
  openFactoryCards,
  recentFactoryAnswers,
  selectFactoryTarget,
} from "@t3tools/client-runtime/factory-view";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  ThreadId,
  type EnvironmentId,
  type FactoryBoard,
  type FactoryCard,
  type FactoryStatus,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  FactoryIcon,
  CheckIcon,
  CheckCircle2Icon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UsersIcon,
  PlayIcon,
  RefreshCwIcon,
  StarIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useEnvironmentIdentities } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";

const TABS = ["Decisions", "Fleet", "Checks"] as const;

export function FactoryPage() {
  const gt = useGT();
  const environments = useEnvironmentIdentities();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const { environment } = selectFactoryTarget(environments, selected);
  const environmentId = environment?.environmentId;
  const environmentPicker =
    environments.length > 1 || (selected && selected !== environments[0]?.environmentId) ? (
      <div className="w-36 min-w-0 sm:w-44">
        <Select
          value={environmentId ?? ""}
          onValueChange={(id) => setSelected(id as EnvironmentId)}
        >
          <SelectTrigger size="sm" aria-label={gt("Factory environment")}>
            <SelectValue>
              {environments.find((env) => env.environmentId === environmentId)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {environments.map((env) => (
              <SelectItem key={env.environmentId} value={env.environmentId}>
                {env.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    ) : null;
  return (
    <div
      {...workspaceAreaProps("factory", 2, "Factory")}
      data-factory-canvas
      className="@container/factory flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {environment && environmentId ? (
        <EnvironmentFactory
          key={environmentId}
          environmentId={environmentId}
          environmentLabel={environment.label}
          environmentPicker={environmentPicker}
        />
      ) : (
        <>
          <WorkspacePageHeader electron={isElectron}>
            <h1 className="text-sm font-semibold">
              <T>Factory</T>
            </h1>
            <div className="ml-auto">{environmentPicker}</div>
          </WorkspacePageHeader>
          <p className="p-4 text-sm text-muted-foreground">
            {selected
              ? gt("The selected server is unavailable. Reconnect it or choose another server.")
              : gt("Connect an environment to open its Factory.")}
          </p>
        </>
      )}
    </div>
  );
}

function EnvironmentFactory({
  environmentId,
  environmentLabel,
  environmentPicker,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly environmentPicker: ReactNode;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(serverEnvironment.factoryBoard({ environmentId, input: {} }));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Decisions");
  const board = query.data;
  const commander = board?.agents.find(
    (a) => a.role === "commander" && a.lifecycle !== "closed" && a.lifecycle !== "retired",
  );
  const cards = board?.cards.filter((c) => c.state === "open") ?? [];
  const unknown =
    board?.executions.filter((execution) => execution.state === "unknown").length ?? 0;
  const failing = board?.triggers.filter((trigger) => trigger.failing).length ?? 0;
  const undelivered = board?.wakes.filter((wake) => wake.state === "undelivered").length ?? 0;
  const tabs = (
    <nav className="flex gap-1" aria-label={gt("Factory sections")}>
      {TABS.map((name) => (
        <Button
          key={name}
          variant={tab === name ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={tab === name}
          onClick={() => setTab(name)}
        >
          {name === "Decisions" ? (
            <MessageSquareIcon />
          ) : name === "Fleet" ? (
            <UsersIcon />
          ) : (
            <CheckCircle2Icon />
          )}
          {name === "Decisions" ? gt("Decisions") : name === "Fleet" ? gt("Fleet") : gt("Checks")}
          {board && (
            <Badge variant="secondary" size="sm">
              {name === "Decisions"
                ? cards.length
                : name === "Fleet"
                  ? board.agents.filter((agent) => !["closed", "retired"].includes(agent.lifecycle))
                      .length
                  : board.triggers.length}
            </Badge>
          )}
        </Button>
      ))}
    </nav>
  );
  return (
    <>
      <WorkspacePageHeader electron={isElectron} className="border-b border-border bg-background">
        <h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          <FactoryIcon className="size-4 text-primary" />
          <T>Factory</T>
        </h1>
        <div className="hidden @min-[64rem]/factory:block">{board?.status.enabled && tabs}</div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {environmentPicker ?? (
            <span className="truncate text-xs text-muted-foreground">{environmentLabel}</span>
          )}
          {board?.status.enabled && (
            <FactoryPowerControl environmentId={environmentId} status={board.status} />
          )}
          {commander && (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: commander.threadId }}
              aria-label={gt("Open Commander")}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm p-1 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="hidden sm:inline">
                <T>Commander</T>
              </span>
              <ArrowUpRightIcon className="size-4" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={query.refresh}
            aria-label={gt("Refresh Factory")}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </WorkspacePageHeader>
      {board?.status.enabled && (
        <div className="shrink-0 border-b border-border bg-background px-3 py-1.5 @min-[64rem]/factory:hidden">
          {tabs}
        </div>
      )}
      {!!(unknown || failing || undelivered) && (
        <div className="shrink-0 px-4 py-2">
          <Alert variant={unknown ? "error" : "warning"}>
            <AlertDescription>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {!!unknown && (
                  <button
                    type="button"
                    onClick={() => setTab("Fleet")}
                    className="rounded-sm text-left underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {gt(
                      "{count, plural, one {{count} action result} other {{count} action results}} unknown. Verify before authorising another action.",
                      { count: unknown },
                    )}
                  </button>
                )}
                {!!failing && (
                  <button
                    type="button"
                    onClick={() => setTab("Checks")}
                    className="rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {gt(
                      "{count, plural, one {{count} failing check} other {{count} failing checks}}",
                      { count: failing },
                    )}
                  </button>
                )}
                {!!undelivered && (
                  <button
                    type="button"
                    onClick={() => setTab("Checks")}
                    className="rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {gt(
                      "{count, plural, one {{count} undelivered wake} other {{count} undelivered wakes}}",
                      { count: undelivered },
                    )}
                  </button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {query.error && (
        <p role="alert" className="px-6 py-4 text-destructive">
          {query.error}
        </p>
      )}
      {!board ? (
        <p className="p-4 text-sm text-muted-foreground">
          {query.error ? gt("Factory is unavailable. Refresh to retry.") : gt("Loading Factory…")}
        </p>
      ) : !board.status.enabled ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <section className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="mx-auto my-4 max-w-2xl rounded-2xl border border-border bg-card/95 p-5 shadow-sm sm:my-12 sm:p-8">
              <div className="mb-6 flex items-center justify-between gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <FactoryIcon className="size-6" />
                </div>
                <Badge variant={board.status.stopping ? "warning" : "secondary"}>
                  {board.status.stopping
                    ? gt("Stopping")
                    : board.status.forcedOff
                      ? gt("Disabled by server")
                      : gt("Off by default")}
                </Badge>
              </div>
              <p className="mb-2 truncate text-xs font-medium text-muted-foreground">
                {environmentLabel}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                <T>A workspace for your agents.</T>
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
                <T>
                  Your Commander coordinates the work. You make the calls that matter. Enable
                  Factory for this server when you’re ready; your regular T3 threads continue
                  normally.
                </T>
              </p>
              <div className="my-6 grid gap-4 border-y border-border py-5 sm:grid-cols-3">
                {[
                  {
                    icon: MessageSquareIcon,
                    title: gt("Make the call"),
                    text: gt("Review decisions, then explicitly send your answer."),
                  },
                  {
                    icon: UsersIcon,
                    title: gt("See the crew"),
                    text: gt("Follow the hierarchy and open each agent’s thread."),
                  },
                  {
                    icon: ShieldCheckIcon,
                    title: gt("Stay in control"),
                    text: gt("Enable and turn off Factory separately on each server."),
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <div key={title}>
                    <Icon className="mb-2 size-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                {board.status.forcedOff
                  ? gt(
                      "This server forces Factory off with T3CODE_FACTORY_DISABLED. Remove that setting and restart the server before enabling it.",
                    )
                  : board.status.stopping
                    ? gt(
                        "Waiting for Factory turns and command jobs to stop. History is retained; enable becomes available after shutdown is confirmed.",
                      )
                    : gt(
                        "Turning it off cancels queued work and requests stops for active turns and commands. Outward actions already in progress may finish; unexecuted action approvals are withdrawn.",
                      )}
              </p>
              <FactoryPowerControl environmentId={environmentId} status={board.status} />
            </div>
          </section>
          {board.status.stopping && <Fleet environmentId={environmentId} board={board} />}
        </div>
      ) : (
        <>
          {!commander && <CommanderSetup environmentId={environmentId} />}
          {tab === "Decisions" ? (
            <Decisions environmentId={environmentId} board={board} />
          ) : tab === "Checks" ? (
            <Triggers environmentId={environmentId} board={board} />
          ) : (
            <Fleet environmentId={environmentId} board={board} />
          )}
        </>
      )}
    </>
  );
}

function FactoryPowerControl({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: FactoryStatus;
}) {
  const gt = useGT();
  const allowed = useAtomValue(serverEnvironment.factorySetEnabled.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(
    serverEnvironment.factorySetEnabled,
    "Change Factory availability",
  );
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!allowed || busy || status.forcedOff || (!status.enabled && status.stopping)}
      onClick={async () => {
        setBusy(true);
        await setEnabled({ environmentId, input: { enabled: !status.enabled } });
        setBusy(false);
      }}
    >
      {busy
        ? gt("Updating…")
        : status.enabled
          ? gt("Turn Factory off")
          : status.stopping
            ? gt("Stopping Factory…")
            : gt("Enable Factory")}
    </Button>
  );
}

function CommanderSetup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const allowed = useAtomValue(
    serverEnvironment.factoryEnsureCommander.permissionAtom(environmentId),
  );
  const ensure = useAtomCommand(
    serverEnvironment.factoryEnsureCommander,
    "Start Factory Commander",
  );
  const [modelKey, setModelKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const models = (config?.providers ?? [])
    .filter((p) => p.enabled && p.installed)
    .flatMap((p) =>
      p.models.map((m) => ({
        key: `${p.instanceId}:${m.slug}`,
        instanceId: p.instanceId,
        model: m.slug,
        label: `${p.instanceId} · ${m.name}`,
      })),
    );
  const selected =
    models.find((m) => m.key === modelKey) ??
    models.find((m) => m.model === "claude-opus-5-5") ??
    models[0];
  return (
    <section className="mx-4 mt-4 shrink-0 space-y-4 rounded-xl border border-border bg-card/95 p-5 shadow-sm">
      <h2 className="font-medium">
        <T>Open your Factory</T>
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        <T>
          A pinned Commander coordinates Subcommanders and Workers across this environment.
          Decisions appear here when your answer is needed.
        </T>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full min-w-0 sm:w-80">
          <Select value={selected?.key ?? ""} onValueChange={(key) => setModelKey(key)}>
            <SelectTrigger aria-label={gt("Commander model")}>
              <SelectValue placeholder={gt("Choose a model")}>{selected?.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {models.map((model) => (
                <SelectItem key={model.key} value={model.key}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          disabled={!allowed || busy || !selected}
          onClick={async () => {
            if (!selected) return;
            setBusy(true);
            await ensure({
              environmentId,
              input: { modelSelection: { instanceId: selected.instanceId, model: selected.model } },
            });
            setBusy(false);
          }}
        >
          {busy ? gt("Starting…") : gt("Start Commander")}
        </Button>
      </div>
      <p className="max-w-3xl text-xs text-muted-foreground">
        <T>
          Factory action tools enforce approval for outward actions. Agents are instructed to use
          them; direct shells, other tools and script effects can bypass this workflow.
        </T>
      </p>
    </section>
  );
}

export function Decisions({
  environmentId,
  board,
}: {
  readonly environmentId: EnvironmentId;
  readonly board: FactoryBoard;
}) {
  const gt = useGT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const cards = openFactoryCards(board.cards);
  const selected = cards.find((c) => c.id === selectedId) ?? cards[0];
  return (
    <div className="grid min-h-0 flex-1 gap-3 p-3 @min-[48rem]/factory:grid-cols-[18rem_minmax(0,1fr)] lg:p-4">
      <aside
        {...workspaceAreaProps("factory-decisions", 1, "Open decisions")}
        role="complementary"
        className={cn(
          "min-h-0 overflow-y-auto rounded-xl border border-border bg-card/95 p-2 shadow-sm",
          showDetail && selected && "hidden @min-[48rem]/factory:block",
        )}
      >
        <div className="mb-2 flex items-center justify-between border-b border-border px-3 pb-3 pt-2">
          <h2 className="text-xs font-semibold text-muted-foreground">
            <T>Needs you</T>
          </h2>
          <Badge variant="secondary">{cards.length}</Badge>
        </div>
        {!cards.length && (
          <p className="p-3 text-sm text-muted-foreground">
            <T>No decisions need your answer.</T>
          </p>
        )}
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            data-vim-list-item=""
            onClick={() => {
              setSelectedId(card.id);
              setShowDetail(true);
            }}
            aria-pressed={selected?.id === card.id}
            className={cn(
              "mb-1 w-full rounded-md border border-transparent px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring",
              selected?.id === card.id ? "border-primary/25 bg-primary/8" : "hover:bg-accent/60",
            )}
          >
            <span className="block text-sm font-medium leading-snug">{card.body.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {card.body.blocking && (
                <Badge variant="warning" size="sm">
                  <T>Blocking</T>
                </Badge>
              )}
              <span>{FACTORY_CARD_KIND_LABEL[card.body.kind]}</span>
              <span>{card.body.urgency.replace("this-week", "this week")}</span>
              <time
                dateTime={new Date(card.createdAt).toISOString()}
                aria-label={gt("Created {date}", {
                  date: new Date(card.createdAt).toLocaleString(),
                })}
              >
                {new Date(card.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {card.ownerId}
            </span>
          </button>
        ))}
        {board.cards.some((card) => card.state === "answered" || card.state === "acked") && (
          <details className="px-2 py-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              <T>Recent answers</T>
            </summary>
            {recentFactoryAnswers(board.cards).map((card) => (
              <p key={card.id} className="px-2 py-1 text-sm">
                <span className="text-muted-foreground">
                  {card.outcome === "DEFAULTED"
                    ? gt("Deferred to agent")
                    : card.outcome === "RULED"
                      ? gt("Your direction")
                      : card.outcome === "CHOSE-against"
                        ? gt("Chose another option")
                        : gt("Chosen")}
                </span>{" "}
                · {card.body.title}
              </p>
            ))}
          </details>
        )}
      </aside>
      {selected ? (
        <div
          {...workspaceAreaProps("factory-card", 2, "Decision")}
          className={cn(
            "min-h-0 min-w-0 overflow-y-auto rounded-xl border border-border bg-card/95 shadow-sm",
            !showDetail && "hidden @min-[48rem]/factory:block",
          )}
        >
          <div className="border-b border-border px-4 py-2 @min-[48rem]/factory:hidden">
            <Button variant="ghost" size="sm" onClick={() => setShowDetail(false)}>
              <ArrowLeftIcon />
              {gt("All decisions · {count}", { count: cards.length })}
            </Button>
          </div>
          <CardDetail
            key={`${selected.id}:${selected.revision}`}
            environmentId={environmentId}
            card={selected}
            owner={board.agents.find((agent) => agent.id === selected.ownerId)}
          />
        </div>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-border bg-card/95 p-8 text-center shadow-sm">
          <CheckCircle2Icon className="mb-4 size-8 text-success-foreground" />
          <h2 className="text-lg font-semibold">
            <T>You’re all caught up.</T>
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            <T>
              Your agents can keep working. New questions will appear here when they need your
              input.
            </T>
          </p>
        </div>
      )}
    </div>
  );
}

export function CardDetail({
  environmentId,
  card,
  owner,
}: {
  readonly environmentId: EnvironmentId;
  readonly card: FactoryCard;
  readonly owner: FactoryBoard["agents"][number] | undefined;
}) {
  const gt = useGT();
  const [staged, setStaged] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const allowed = useAtomValue(serverEnvironment.factoryAnswerCard.permissionAtom(environmentId));
  const answer = useAtomCommand(serverEnvironment.factoryAnswerCard, "Answer Factory decision");
  const action = card.body.action;
  const payload = useEnvironmentQuery(
    action
      ? serverEnvironment.factoryPayload({ environmentId, input: { sha256: action.payloadSha256 } })
      : null,
  );
  const send = async () => {
    if (
      !allowed ||
      busy ||
      (!staged && !note.trim()) ||
      (staged === "ruled" && !note.trim()) ||
      (!!action && !payload.data)
    )
      return;
    setBusy(true);
    await answer({
      environmentId,
      input: {
        cardId: card.id,
        revision: card.revision,
        ...(staged === "default"
          ? { yourCall: true }
          : staged && staged !== "ruled"
            ? { optionId: staged }
            : {}),
        ...(note.trim() ? { note } : {}),
      },
    });
    setBusy(false);
  };
  return (
    <section className="flex min-h-full min-w-0 flex-col" aria-label={card.body.title}>
      <div className="w-full max-w-4xl space-y-4 p-4 lg:px-6">
        <div>
          <p className="text-xs text-muted-foreground">
            {card.body.blocking && (
              <span className="mr-2 font-medium text-warning-foreground">
                <T>Blocking</T>
              </span>
            )}
            {FACTORY_CARD_KIND_LABEL[card.body.kind]} ·{" "}
            {card.body.urgency.replace("this-week", "this week")}{" "}
            {gt("· revision {revision}", { revision: card.revision })}
            {owner ? (
              <>
                {" "}
                ·{" "}
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: owner.threadId }}
                  className="rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {owner.id} ↗
                </Link>
              </>
            ) : (
              ` · ${card.ownerId}`
            )}
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold tracking-tight">
            {card.body.title}
          </h2>
        </div>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <dt className="text-muted-foreground">
            <T>Doing</T>
          </dt>
          <dd>{card.body.context.doing}</dd>
          <dt className="text-muted-foreground">
            <T>Why you</T>
          </dt>
          <dd>{card.body.context.whyNotMe}</dd>
          <dt className="text-muted-foreground">
            <T>Waiting</T>
          </dt>
          <dd>{card.body.context.costOfWaiting}</dd>
        </dl>
        {action && (
          <div className="space-y-2 rounded-md border border-border p-4">
            <p className="text-sm font-medium">
              <T>Exact action payload</T>
            </p>
            <p className="break-all font-mono text-xs">
              <T>SHA-256</T> {action.payloadSha256}
            </p>
            {payload.data ? (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(payload.data.envelope, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {payload.error ?? gt("Loading action…")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              <T>
                A changed merge head voids consent. An uncertain execution result requires
                reconciliation, never an automatic repeat.
              </T>
            </p>
          </div>
        )}
        <div className="space-y-2" aria-label={gt("Options")}>
          {card.body.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!allowed || busy}
              aria-pressed={staged === option.id}
              onClick={() => setStaged(option.id)}
              className={cn(
                "w-full space-y-1.5 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
                staged === option.id
                  ? "border-primary bg-primary/8"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words font-medium">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-flex size-5 items-center justify-center rounded-full border border-border bg-background"
                  >
                    {staged === option.id && <CheckIcon className="size-3.5" />}
                  </span>
                  {option.id} · {option.label}
                </span>
                {option.recommended && (
                  <Badge variant="success">
                    <StarIcon />
                    <T>Recommended</T>
                  </Badge>
                )}
              </span>
              <span className="block text-sm text-muted-foreground">
                <T>Next:</T> {option.nextStep}
              </span>
              <span className="block text-xs text-muted-foreground">
                <T>Cost:</T> {option.cost} ·{" "}
                <Badge
                  variant={
                    option.reversibility === "irreversible"
                      ? "error"
                      : option.reversibility === "costly"
                        ? "warning"
                        : "secondary"
                  }
                  size="sm"
                >
                  {option.reversibility}
                </Badge>
              </span>
              <span className="block text-sm">{option.consequences}</span>
            </button>
          ))}
        </div>
        <details className="space-y-2 text-sm">
          <summary className="cursor-pointer font-medium">
            <T>Reasoning</T>
          </summary>
          <p className="text-muted-foreground">{card.body.rationale}</p>
        </details>
        {[...new Set(card.body.caveats)].map((text) => (
          <p key={text} className="text-sm text-muted-foreground">
            {text}
          </p>
        ))}
        <div className="flex flex-wrap gap-3 text-sm">
          {Array.from(
            new Map(
              card.body.links.map((link) => [`${link.kind}:${link.ref}:${link.label ?? ""}`, link]),
            ).values(),
          ).map((link) =>
            /^https?:\/\//.test(link.ref) ? (
              <a
                key={`${link.kind}:${link.ref}:${link.label ?? ""}`}
                href={link.ref}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {link.label ?? link.ref}
              </a>
            ) : link.kind === "thread" ? (
              <Link
                key={`${link.kind}:${link.ref}:${link.label ?? ""}`}
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: ThreadId.make(link.ref) }}
                className="rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {link.label ?? gt("Open thread")}
              </Link>
            ) : (
              <span
                key={`${link.kind}:${link.ref}:${link.label ?? ""}`}
                className="text-muted-foreground"
              >
                {link.label ?? link.ref}
              </span>
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={staged === "default" ? "secondary" : "outline"}
            size="sm"
            onClick={() => setStaged("default")}
            disabled={!allowed || busy}
            aria-pressed={staged === "default"}
          >
            <T>Defer to agent (uses recommendation)</T>
          </Button>
          <Button
            variant={staged === "ruled" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={staged === "ruled"}
            disabled={!allowed || busy}
            onClick={() => {
              setStaged("ruled");
              noteRef.current?.focus();
            }}
          >
            <T>Write my own direction</T>
          </Button>
        </div>
        <Textarea
          size="sm"
          ref={noteRef}
          aria-label={gt("Decision note")}
          disabled={!allowed || busy}
          placeholder={gt("Add a note, or write your own direction…")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <footer className="sticky bottom-0 mt-auto flex items-center justify-between gap-4 border-t border-border bg-background px-4 py-3">
        <p className="min-w-0 text-sm text-muted-foreground" role="status">
          {staged
            ? gt("Staged: {choice}", {
                choice:
                  staged === "default"
                    ? gt("defer to agent")
                    : staged === "ruled"
                      ? gt("your own direction")
                      : (card.body.options.find((option) => option.id === staged)?.label ?? staged),
              })
            : gt("Choose an option. Nothing is sent until Send.")}
        </p>
        <Button
          disabled={
            !allowed ||
            busy ||
            (!staged && !note.trim()) ||
            (staged === "ruled" && !note.trim()) ||
            (!!action && !payload.data)
          }
          onClick={() => void send()}
        >
          {busy ? gt("Sending…") : gt("Send")}
        </Button>
      </footer>
    </section>
  );
}

function Triggers({
  environmentId,
  board,
}: {
  readonly environmentId: EnvironmentId;
  readonly board: FactoryBoard;
}) {
  const gt = useGT();
  const run = useAtomCommand(serverEnvironment.factoryRunTrigger, "Run Factory check");
  const shadow = useAtomCommand(
    serverEnvironment.factorySetTriggerShadow,
    "Change Factory shadow mode",
  );
  const retry = useAtomCommand(serverEnvironment.factoryRetryWake, "Retry Factory wake");
  const allowed = useAtomValue(serverEnvironment.factoryRunTrigger.permissionAtom(environmentId));
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <CheckCircle2Icon className="size-4 text-muted-foreground" />
        <T>Checks & run history</T>
      </h2>
      {!board.triggers.length && (
        <div className="rounded-xl border border-border bg-card/95 p-6 shadow-sm">
          <h3 className="text-sm font-medium">
            <T>No checks configured</T>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <T>Checks will appear here with their latest results and run history.</T>
          </p>
        </div>
      )}
      {board.triggers.map((trigger) => (
        <section
          key={trigger.id}
          className="space-y-3 rounded-xl border border-border bg-card/95 p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">{trigger.id}</h3>
              <p className="text-xs text-muted-foreground">
                {gt("Every {minutes} min ·", { minutes: Math.round(trigger.intervalMs / 60_000) })}{" "}
                {!trigger.enabled
                  ? gt("disabled")
                  : trigger.shadow
                    ? gt("observe only")
                    : gt("live")}{" "}
                · {trigger.failing ? gt("last check failed") : gt("no failure recorded")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!allowed}
                onClick={() =>
                  void shadow({ environmentId, input: { id: trigger.id, shadow: !trigger.shadow } })
                }
              >
                {trigger.shadow ? gt("Make live") : gt("Use shadow")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!allowed}
                onClick={() => void run({ environmentId, input: { id: trigger.id } })}
              >
                <PlayIcon />
                <T>Run now</T>
              </Button>
            </div>
          </div>
          {board.runs
            .filter((r) => r.triggerId === trigger.id)
            .slice(-5)
            .reverse()
            .map((record) => (
              <details key={record.id} className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {gt("{outcome} · {newCount}/{total} new · {duration} ms", {
                    outcome: record.outcome,
                    newCount: record.newItemCount,
                    total: record.itemCount,
                    duration: Math.round(record.tookMs),
                  })}
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
                  {record.stderr || gt("No stderr.")}
                </pre>
              </details>
            ))}
        </section>
      ))}
      <h3 className="font-medium">
        <T>Undelivered wakes</T>
      </h3>
      {board.wakes
        .filter((w) => w.state === "undelivered")
        .map((wake) => (
          <div
            key={wake.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
          >
            <span>{wake.text}</span>
            <Button
              size="sm"
              disabled={!allowed}
              onClick={() => void retry({ environmentId, input: { wakeId: wake.id } })}
            >
              <T>Retry</T>
            </Button>
          </div>
        ))}
    </div>
  );
}

function Fleet({
  environmentId,
  board,
}: {
  readonly environmentId: EnvironmentId;
  readonly board: FactoryBoard;
}) {
  const gt = useGT();
  const cancel = useAtomCommand(serverEnvironment.factoryCancelLaneJob, "Cancel Factory command");
  const allowed = useAtomValue(
    serverEnvironment.factoryCancelLaneJob.permissionAtom(environmentId),
  );
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <UsersIcon className="size-4 text-muted-foreground" />
        <T>Your crew</T>
      </h2>
      <p className="text-xs text-muted-foreground">
        <T>Factory roles and lifecycle. Open a thread for its live activity.</T>
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm">
        {factoryAgentRows(board.agents).map(({ agent, depth }) => (
          <section
            key={agent.id}
            className="px-3 py-2.5"
            style={{ paddingLeft: `${12 + Math.min(depth, 3) * 20}px` }}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: agent.threadId }}
                className="inline-flex min-w-0 items-center gap-1 rounded-sm text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="break-all">{agent.id}</span>
                <ArrowUpRightIcon className="size-3.5 shrink-0" />
              </Link>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{agent.role}</Badge>
                <Badge variant={agent.needs ? "warning" : "outline"}>{agent.lifecycle}</Badge>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.next || gt("No next step recorded")}
            </p>
            {agent.needs && (
              <p className="mt-1 text-sm text-warning-foreground">
                <T>Needs:</T> {agent.needs}
              </p>
            )}
            {agent.parentId && (
              <p className="mt-1 text-xs text-muted-foreground">
                <T>Reports to</T> {agent.parentId}
              </p>
            )}
          </section>
        ))}
        {!board.agents.some((agent) => agent.lifecycle !== "closed") && (
          <p className="p-3 text-sm text-muted-foreground">
            <T>No agents enrolled yet.</T>
          </p>
        )}
      </div>
      <h3 className="text-sm font-medium">
        <T>Waiting for capacity ·</T>{" "}
        {board.spawns.filter((spawn) => spawn.state === "held").length}
      </h3>
      {board.spawns
        .filter((s) => s.state === "held")
        .map((spawn) => (
          <p key={spawn.id} className="text-sm text-muted-foreground">
            {gt("{title} · held for {model}", {
              title: spawn.title,
              model: spawn.modelSelection.model,
            })}
          </p>
        ))}
      <h3 className="text-sm font-medium">
        {gt("Command lanes · {count} in progress", {
          count: board.jobs.filter((job) => job.state !== "terminal").length,
        })}
      </h3>
      {board.jobs.slice(-20).map((job) => (
        <div
          key={job.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3"
        >
          <div>
            <p className="text-sm">{job.argv.join(" ")}</p>
            <p className="text-xs text-muted-foreground">
              {job.state} · {job.status ?? job.gitRoot}
            </p>
          </div>
          {job.state !== "terminal" && (
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed}
              onClick={() => void cancel({ environmentId, input: { id: job.id } })}
            >
              <T>Cancel</T>
            </Button>
          )}
        </div>
      ))}
      {board.executions
        .filter((e) => e.state === "unknown")
        .map((execution) => (
          <p
            key={execution.id}
            role="alert"
            className="rounded-md border border-destructive p-4 text-sm"
          >
            {gt(
              "Action {cardId} has an unknown result. Verify its external result before authorising any new action.",
              { cardId: execution.cardId },
            )}
          </p>
        ))}
    </div>
  );
}
