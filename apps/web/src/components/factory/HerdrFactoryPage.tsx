import { desktopHerdrTransport } from "./desktopHerdrTransport";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HerdrWorkspace } from "@t3tools/client-runtime/herdr/workspace";
import { type CoreModule, type CoreResource } from "@t3tools/client-runtime/herdr/protocol";
import {
  validateHerdrTarget,
  type HerdrDestination,
} from "@t3tools/client-runtime/herdr/destinations";
import { randomUUID } from "../../lib/utils";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { FactoryIcon, FolderIcon, PanelRightIcon, SettingsIcon } from "lucide-react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { HerdrThreadView } from "./HerdrThreadView";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { HerdrFleetList, groupFleet } from "./HerdrFleetList";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";
import {
  saveHerdrDestination,
  removeHerdrDestination,
  useHerdrDestinations,
} from "./herdrDestinations";

export function HerdrFactoryPage() {
  const destinations = useHerdrDestinations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [socketPath, setSocketPath] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const destination =
    destinations.find((item) => item.id === selected) ?? (selected ? null : destinations[0]);
  const connections = (
    <div className="px-3 pb-3">
      <select
        aria-label="Factory connection"
        className="w-full rounded-md bg-transparent py-2 text-sm font-medium outline-none"
        value={destination?.id ?? ""}
        onChange={(event) => setSelected(event.target.value)}
      >
        {destinations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      {destination ? (
        <CoreWorkspace
          key={destination.id}
          destination={destination}
          connections={connections}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <main
          {...workspaceAreaProps("factory", 2, "Factory")}
          role="main"
          className="flex min-w-0 flex-1 items-center justify-center"
        >
          <div className="max-w-sm space-y-4 text-center">
            <FactoryIcon className="mx-auto size-8 text-muted-foreground" />
            <h1 className="text-lg font-medium">Your factory, in Fold</h1>
            <p className="text-sm text-muted-foreground">
              Connect an existing Herdr Core to follow your commanders and conversations.
            </p>
            <Button onClick={() => setSettingsOpen(true)}>Connect factory</Button>
          </div>
        </main>
      )}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Factory connections</DialogTitle>
            <DialogDescription>
              Use an existing Herdr Core socket through your desktop account or SSH agent.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              className="flex flex-wrap gap-2 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  validateHerdrTarget(socketPath, sshHost.trim() || undefined);
                  const id = randomUUID();
                  saveHerdrDestination({
                    id,
                    label: label.trim() || "Herdr",
                    socketPath,
                    ...(sshHost.trim() ? { sshHost: sshHost.trim() } : {}),
                    readOnly,
                    pins: [],
                  });
                  setSelected(id);
                  setSocketPath("");
                  setLabel("");
                  setError(null);
                  setSettingsOpen(false);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not save connection");
                }
              }}
            >
              <Input
                aria-label="Core label"
                placeholder="Factory name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <Input
                aria-label="Core socket path"
                placeholder="/run/user/1000/herdr-core/factory.sock"
                value={socketPath}
                onChange={(event) => setSocketPath(event.target.value)}
                required
              />
              <Input
                aria-label="SSH host alias"
                placeholder="SSH alias (blank for local)"
                value={sshHost}
                onChange={(event) => setSshHost(event.target.value)}
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={readOnly}
                  onChange={(event) => setReadOnly(event.target.checked)}
                />
                Read-only connection
              </label>
              <Button type="submit">Save connection</Button>
            </form>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {destination && (
              <Button
                variant="ghost"
                onClick={() => {
                  removeHerdrDestination(destination.id);
                  setSelected(null);
                }}
              >
                Remove {destination.label}
              </Button>
            )}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function CoreWorkspace({
  destination,
  connections,
  onSettings,
}: {
  destination: HerdrDestination;
  connections: import("react").ReactNode;
  onSettings: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [workspace] = useState(() => new HerdrWorkspace());
  const [initialDestination] = useState(destination);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [filter, setFilter] = useState("");
  const [showFinished, setShowFinished] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [views, setViews] = useState<Record<string, "chat" | "terminal">>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [transcriptPath, setTranscriptPath] = useState("");
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    await operation().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Core operation failed"),
    );
    setBusy(false);
  };
  const transport = desktopHerdrTransport(destination);
  const connect = async () => {
    const coreId = await workspace.connect(destination, transport);
    if (coreId && !destination.coreId) saveHerdrDestination({ ...destination, coreId });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The mounted destination owns an external Core socket.
  useEffect(() => {
    void workspace
      .connect(initialDestination, desktopHerdrTransport(initialDestination))
      .then((coreId) => {
        if (coreId && !initialDestination.coreId)
          saveHerdrDestination({ ...initialDestination, coreId });
      })
      .catch(() => setError("Could not save Core identity."));
    return () => workspace.close();
  }, [initialDestination, workspace]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Core has no file watch API; refresh the visible destination's recorded transcript.
  useEffect(() => {
    if (state.connection !== "connected") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (!document.hidden) {
          await workspace.refresh();
          await workspace.syncHistory();
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Core refresh failed");
      }
      if (!stopped)
        timer = setTimeout(() => {
          void tick();
        }, 3000);
    };
    timer = setTimeout(() => {
      void tick();
    }, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [workspace, state.connection]);
  const agent = state.selected;
  const conversationKey = agent?.conversationId ?? agent?.id ?? "";
  const source = agent ? workspace.transcriptSource(agent.id) : null;
  const draft = drafts[conversationKey] ?? "";
  const module = state.modules.find((item) => item.id === moduleId);
  const pins = destination.pins;
  const visible = state.agents.filter(
    (item) =>
      (showFinished || item.processState === "live") &&
      `${item.label} ${item.role ?? ""} ${item.status}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const fleet = groupFleet(visible, pins);
  const parent = agent?.parentId
    ? (state.agents.find((item) => item.id === agent.parentId) ?? null)
    : null;
  const errorBanner =
    error || state.error ? (
      <p role="alert" className="px-6 py-2 text-sm text-destructive">
        {error ?? state.error}
      </p>
    ) : null;
  const sidebar = (
    <>
      {connections}
      <SidebarContent
        fixedHeader={
          <div className="px-3 pb-2">
            <Input
              aria-label="Filter fleet"
              placeholder="Search conversations…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        }
      >
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={!module}
                onClick={() => {
                  workspace.cancelPrepared();
                  setModuleId(null);
                }}
              >
                <FactoryIcon />
                <span>Factory</span>
                <span className="ml-auto text-xs text-muted-foreground">{visible.length}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {state.modules.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={moduleId === item.id}
                  onClick={() => {
                    workspace.cancelPrepared();
                    setModuleId(item.id);
                    const first = item.resources[0];
                    setKind(first?.kind ?? "");
                    if (first) void run(() => workspace.resources(item.id, first.kind));
                  }}
                >
                  <FolderIcon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          {fleet.map((group) => (
            <section key={group.tab ?? ""} className="pb-2" aria-label={group.tab ?? "Agents"}>
              <p className="truncate px-4 pb-1 text-xs font-medium text-muted-foreground">
                {group.tab ?? "Agents"}
              </p>
              <HerdrFleetList
                nodes={group.nodes}
                activeId={module ? null : (agent?.id ?? null)}
                pins={pins}
                disabled={state.connection !== "connected"}
                onSelect={(item) => {
                  setModuleId(null);
                  void run(() => workspace.select(item));
                }}
              />
            </section>
          ))}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSettings}>
              <SettingsIcon />
              <span>Factory settings</span>
              <span className="ml-auto text-xs text-muted-foreground">{state.connection}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside
        {...workspaceAreaProps("factory-fleet", 1, "Factory conversations")}
        role="complementary"
        className="flex w-60 shrink-0 flex-col border-r bg-sidebar pt-3"
      >
        {sidebar}
      </aside>
      <main
        {...workspaceAreaProps("factory", 2, "Factory")}
        role="main"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
      >
        {module || !agent ? (
          <>
            <WorkspacePageHeader electron={isElectron}>
              <WorkspaceBreadcrumb ariaLabel="Factory conversation">
                <WorkspaceBreadcrumbItem>
                  <WorkspaceBreadcrumbText>Factory</WorkspaceBreadcrumbText>
                </WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current>
                  <WorkspaceBreadcrumbText>
                    {module?.label ?? agent?.label ?? destination.label}
                  </WorkspaceBreadcrumbText>
                </WorkspaceBreadcrumbItem>
              </WorkspaceBreadcrumb>
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {agent?.status}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Conversation details"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                >
                  <PanelRightIcon />
                </Button>
              </div>
            </WorkspacePageHeader>
            {errorBanner}
          </>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Herdr conversation">
            {module ? (
              <div className="min-h-0 flex-1 overflow-auto p-6">
                <div className="mb-4 flex gap-2">
                  {module.resources.map((resource) => (
                    <Button
                      key={resource.kind}
                      variant={kind === resource.kind ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => {
                        setKind(resource.kind);
                        void run(() => workspace.resources(module.id, resource.kind));
                      }}
                    >
                      {resource.label}
                    </Button>
                  ))}
                </div>
                <ResourcePanel
                  module={module}
                  kind={kind}
                  resources={state.resources}
                  workspace={workspace}
                  busy={busy}
                  run={run}
                />
                {state.resourceNext && (
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => workspace.resources(module.id, kind, true))}
                  >
                    Load more resources
                  </Button>
                )}
              </div>
            ) : agent ? (
              <HerdrThreadView
                workspace={workspace}
                state={state}
                agent={agent}
                parent={parent}
                readOnly={destination.readOnly}
                busy={busy}
                run={run}
                draft={draft}
                onDraftChange={(value) =>
                  setDrafts((previous) => ({ ...previous, [conversationKey]: value }))
                }
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen(!detailsOpen)}
                banner={errorBanner}
                view={views[agent.id] ?? (agent.conversationId ? "chat" : "terminal")}
                onViewChange={(next) => setViews((previous) => ({ ...previous, [agent.id]: next }))}
                attachTarget={
                  state.connection === "connected" && state.hello
                    ? {
                        socketPath: destination.socketPath,
                        sshHost: destination.sshHost,
                        coreId: state.hello.core.id,
                      }
                    : null
                }
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select a conversation from your factory.
              </div>
            )}
          </section>
          {detailsOpen && (
            <aside
              {...workspaceAreaProps("factory-details", 3, "Conversation details")}
              role="complementary"
              className="w-80 shrink-0 space-y-5 overflow-auto border-l p-5"
            >
              <div className="space-y-2">
                <h2 className="text-sm font-medium">Session</h2>
                <p className="text-sm">{agent?.label ?? destination.label}</p>
                <p className="text-xs text-muted-foreground">
                  {[agent?.provider, agent?.model, agent?.role].filter(Boolean).join(" · ")}
                </p>
                <p className="break-all text-xs text-muted-foreground">{agent?.cwd}</p>
                {agent?.parentId && (
                  <p className="text-xs text-muted-foreground">Parent: {agent.parentId}</p>
                )}
                {agent && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      saveHerdrDestination({
                        ...destination,
                        pins: pins.includes(agent.id)
                          ? pins.filter((id) => id !== agent.id)
                          : [...pins, agent.id],
                      })
                    }
                  >
                    {pins.includes(agent.id) ? "Unpin conversation" : "Pin conversation"}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-sm font-medium">Connection</h2>
                <p className="text-xs text-muted-foreground">
                  {state.hello?.core.name ?? destination.label} · {state.connection}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || state.connection === "connecting"}
                  onClick={() => void run(connect)}
                >
                  Reconnect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => workspace.close()}>
                  Disconnect
                </Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showFinished}
                    onChange={(event) => setShowFinished(event.target.checked)}
                  />
                  Include finished terminals
                </label>
              </div>
              {agent && (
                <div className="space-y-2">
                  <h2 className="text-sm font-medium">Conversation source</h2>
                  <p className="text-xs text-muted-foreground">
                    Recorded Claude or Codex history, read through Core.
                  </p>
                  {source && (
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {source.discovered ? "Detected" : "Attached"} {source.provider}: {source.path}
                    </p>
                  )}
                  <details open={!source}>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {source ? "Use a different file" : "Attach a transcript"}
                    </summary>
                    <form
                      className="my-2 flex flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          await workspace.bindTranscript(transcriptPath, provider);
                          saveHerdrDestination({
                            ...destination,
                            bindings: {
                              ...destination.bindings,
                              [agent.id]: { path: transcriptPath, provider },
                            },
                          });
                        });
                      }}
                    >
                      <Input
                        aria-label="Transcript file on Core host"
                        placeholder="Absolute provider JSONL transcript path"
                        value={transcriptPath}
                        onChange={(event) => setTranscriptPath(event.target.value)}
                        required
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant={provider === "claude" ? "secondary" : "ghost"}
                        onClick={() => setProvider("claude")}
                      >
                        Claude
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={provider === "codex" ? "secondary" : "ghost"}
                        onClick={() => setProvider("codex")}
                      >
                        Codex
                      </Button>
                      <Button type="submit" size="sm">
                        Attach history
                      </Button>
                    </form>
                  </details>
                </div>
              )}
              {state.unsupportedModules > 0 && (
                <p className="text-xs text-muted-foreground">
                  {state.unsupportedModules} unsupported modules
                </p>
              )}
            </aside>
          )}
        </div>
        {state.prepared && (
          <section className="max-h-80 overflow-auto border-t p-4" aria-label="Review Core action">
            <h2 className="text-sm font-semibold">{state.prepared.summary}</h2>
            <pre className="my-3 whitespace-pre-wrap break-words text-xs">
              {state.prepared.payload}
            </pre>
            <p className="text-xs text-muted-foreground">
              Payload hash: {state.prepared.payloadHash}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={busy || state.connection !== "connected"}
                onClick={() => void run(() => workspace.execute(randomUUID()))}
              >
                Confirm exact action
              </Button>
              <Button variant="outline" onClick={() => workspace.cancelPrepared()}>
                Cancel
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ResourcePanel({
  module,
  kind,
  resources,
  workspace,
  busy,
  run,
}: {
  module: CoreModule;
  kind: string;
  resources: readonly CoreResource[];
  workspace: HerdrWorkspace;
  busy: boolean;
  run: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [input, setInput] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      {resources.map((resource) => (
        <article key={resource.id} className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{resource.id}</h3>
          <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(resource.fields).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">
                  {typeof value === "string"
                    ? value
                    : (JSON.stringify(value, null, 2) ?? "Unknown")}
                </dd>
              </div>
            ))}
          </dl>
          {module.actions
            .filter((action) => action.targetKind === "*" || action.targetKind === kind)
            .map((action) => (
              <form
                key={action.id}
                className="my-2 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = Object.fromEntries(
                    action.input.map((field) => [
                      field.name,
                      input[`${resource.id}:${action.id}:${field.name}`] ?? "",
                    ]),
                  );
                  void run(() => workspace.prepare(module.id, action.id, resource, values));
                }}
              >
                {action.input.map((field) => (
                  <Input
                    key={field.name}
                    aria-label={`${action.label}: ${field.label}`}
                    placeholder={field.label}
                    required={field.required}
                    value={input[`${resource.id}:${action.id}:${field.name}`] ?? ""}
                    onChange={(event) =>
                      setInput((old) => ({
                        ...old,
                        [`${resource.id}:${action.id}:${field.name}`]: event.target.value,
                      }))
                    }
                  />
                ))}
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    !workspace.permits(action.permission) ||
                    !workspace.supports("machine.exec") ||
                    !workspace.supports("machine.exec")
                  }
                >
                  {action.label}…
                </Button>
              </form>
            ))}
        </article>
      ))}
    </div>
  );
}
