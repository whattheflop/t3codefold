import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import type { CoreAgent } from "@t3tools/client-runtime/herdr/protocol";
import type { HerdrWorkspace, HerdrWorkspaceState } from "@t3tools/client-runtime/herdr/workspace";
import { ArrowUpIcon, EyeIcon, PanelRightIcon, SquareIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useTheme } from "~/hooks/useTheme";
import { cn, randomUUID } from "~/lib/utils";
import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ScrollToEndButton } from "../chat/TimelineOverlays";
import { useTimelineFollow } from "../chat/useTimelineFollow";
import { Button } from "../ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { ToggleGroup, Toggle } from "../ui/toggle-group";
import { HerdrPaneView, type HerdrAttachTarget } from "./HerdrPaneView";
import { coreItemsToTimelineEntries } from "./herdrTimeline";
import { herdrAgentStatus } from "./herdrAgentStatus";

// The timeline keys rows by environment; nothing behind this id loads.
const HERDR_ENVIRONMENT_ID = EnvironmentId.make("herdr");
const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_RUNS: ReadonlyArray<never> = [];
const ignore = () => {};
const LANE = "chat-content-lane px-4";

const providerDriver = (provider: string | null) =>
  provider === "claude"
    ? ProviderDriverKind.make("claudeAgent")
    : provider === "codex"
      ? ProviderDriverKind.make("codex")
      : null;

/** A Herdr agent's recorded conversation, laid out as a T3 thread. */
export function HerdrThreadView({
  workspace,
  state,
  agent,
  parent,
  readOnly,
  busy,
  run,
  draft,
  onDraftChange,
  detailsOpen,
  onToggleDetails,
  banner,
  view,
  onViewChange,
  attachTarget,
}: {
  readonly workspace: HerdrWorkspace;
  readonly state: HerdrWorkspaceState;
  readonly agent: CoreAgent;
  readonly parent: CoreAgent | null;
  readonly readOnly: boolean;
  readonly busy: boolean;
  readonly run: (operation: () => Promise<unknown>) => Promise<void>;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly detailsOpen: boolean;
  readonly onToggleDetails: () => void;
  readonly banner: ReactNode;
  readonly view: "chat" | "terminal";
  readonly onViewChange: (view: "chat" | "terminal") => void;
  readonly attachTarget: HerdrAttachTarget | null;
}) {
  // No ":" so the timeline finds no environment thread behind the key.
  const threadKey = `herdr-${agent.id}`;
  const listRef = useRef<LegendListRef | null>(null);
  const { resolvedTheme } = useTheme();
  const entries = coreItemsToTimelineEntries(state.items);
  const status = herdrAgentStatus(agent);
  const isWorking = status?.kind === "working";
  const lastUserAt =
    entries.findLast((entry) => entry.kind === "message" && entry.message.role === "user")
      ?.createdAt ?? null;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const follow = useTimelineFollow({
    legendListRef: listRef,
    composerTimelineInset: 0,
    routeThreadKey: threadKey,
    activeThreadKey: threadKey,
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: null,
    activeRunningTurnId: null,
    timelineEntries: entries,
    timelineAnchorMessageId: null,
    setTimelineAnchor: ignore,
  });
  const historyControls = {
    hasMoreHistory: state.before !== null,
    loading: loadingOlder,
    error: null,
    onLoadEarlier: () => {
      setLoadingOlder(true);
      void workspace.older().finally(() => setLoadingOlder(false));
    },
  };
  const deliveryFooter =
    state.receipt?.state === "unknown" ? (
      <div className={cn(LANE, "pb-4 text-xs text-muted-foreground")}>
        <p>
          Delivery is unconfirmed. Core has no send receipts, so check the transcript before sending
          again.
        </p>
        <Button
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => workspace.acknowledgeUnknownDelivery()}
        >
          I checked. Allow sending
        </Button>
      </div>
    ) : null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden" data-chat-column>
      <header
        data-chat-header
        className={cn(
          "relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 bg-background",
          isElectron ? "drag-region px-3 sm:px-5" : "px-(--workspace-gutter-start)",
        )}
      >
        <WorkspaceBreadcrumb ariaLabel="Factory conversation">
          {parent ? (
            <>
              <WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbText>{parent.label}</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current>
            <WorkspaceBreadcrumbText>{agent.label}</WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        {status ? (
          <span className={cn("text-xs font-medium", status.className)}>{status.label}</span>
        ) : null}
        <ToggleGroup
          aria-label="Conversation view"
          variant="segmented"
          className="ml-auto [-webkit-app-region:no-drag]"
          value={[view]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "chat" || value === "terminal") onViewChange(value);
          }}
        >
          <Toggle value="chat" disabled={agent.conversationId === null}>
            Chat
          </Toggle>
          <Toggle value="terminal">Terminal</Toggle>
        </ToggleGroup>
        <Button
          size="icon-sm"
          variant="ghost"
          className="[-webkit-app-region:no-drag]"
          aria-label="Conversation details"
          aria-pressed={detailsOpen}
          onClick={onToggleDetails}
        >
          <PanelRightIcon />
        </Button>
      </header>
      {banner}
      {view === "terminal" ? (
        attachTarget && agent.processState === "live" ? (
          <HerdrPaneView
            key={agent.id}
            target={attachTarget}
            terminal={agent.id}
            label={agent.label}
            readOnly={readOnly}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {agent.processState === "live"
              ? "Connecting to the factory…"
              : "This terminal has finished."}
          </div>
        )
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col bg-background">
            {state.history === "ready" || entries.length > 0 ? (
              <MessagesTimeline
                listRef={listRef}
                timelineEntries={entries}
                isWorking={isWorking}
                activeTurnStartedAt={isWorking ? lastUserAt : null}
                latestRun={null}
                runningRunId={null}
                turnDiffSummaries={NO_TURN_DIFFS}
                runs={NO_RUNS}
                routeThreadKey={threadKey}
                onOpenThread={ignore}
                supportsConversationRollback={false}
                onRevertToTurnCount={ignore}
                isRevertingCheckpoint={false}
                onImageExpand={ignore}
                historyControls={historyControls}
                activeThreadEnvironmentId={HERDR_ENVIRONMENT_ID}
                markdownCwd={agent.cwd ?? undefined}
                resolvedTheme={resolvedTheme}
                timestampFormat="locale"
                workspaceRoot={agent.cwd ?? undefined}
                anchorMessageId={null}
                onAnchorReady={ignore}
                onAnchorSizeChanged={ignore}
                contentInsetEndAdjustment={0}
                emptyPlaceholderInset={0}
                liveFollowEnabled={follow.timelineLiveFollowEnabled}
                onIsAtEndChange={follow.onIsAtEndChangeStable}
                onViewportAttach={follow.attachTimelineViewport}
                onFooterGrow={follow.onTimelineFooterGrowStable}
                footer={deliveryFooter}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {state.history === "loading" ? (
                  "Loading conversation…"
                ) : (
                  <span>
                    No conversation recorded for this terminal yet.{" "}
                    <Button variant="link" size="sm" onClick={onToggleDetails}>
                      Attach a transcript
                    </Button>
                  </span>
                )}
              </div>
            )}
            {follow.showScrollToBottom ? (
              <ScrollToEndButton
                summary={null}
                bottom={4}
                onScrollToEnd={() => follow.scrollToEnd(true)}
              />
            ) : null}
          </div>
          <div className={cn(LANE, "shrink-0 pb-4")}>
            <HerdrComposer
              agent={agent}
              readOnly={readOnly}
              canSend={!busy && workspace.canSend()}
              canInterrupt={
                !busy &&
                agent.capabilities.includes("interrupt") &&
                workspace.permits("session.control")
              }
              isWorking={isWorking}
              draft={draft}
              onDraftChange={onDraftChange}
              onSend={(text) =>
                run(async () => {
                  await workspace.send(text, randomUUID());
                  onDraftChange("");
                  follow.scrollToEnd(true);
                })
              }
              onInterrupt={() => run(() => workspace.interrupt(randomUUID()))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function HerdrComposer({
  agent,
  readOnly,
  canSend,
  canInterrupt,
  isWorking,
  draft,
  onDraftChange,
  onSend,
  onInterrupt,
}: {
  readonly agent: CoreAgent;
  readonly readOnly: boolean;
  readonly canSend: boolean;
  readonly canInterrupt: boolean;
  readonly isWorking: boolean;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: (text: string) => void;
  readonly onInterrupt: () => void;
}) {
  const driver = providerDriver(agent.provider);
  const providerLabel = agent.model ?? agent.provider ?? "Terminal";
  const send = () => {
    if (canSend && draft.trim()) onSend(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Same as the app composer: Enter sends, Shift+Enter adds a line, IME composition is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-3xl border border-border bg-card px-4 pt-3 pb-2.5 shadow-composer dark:shadow-composer-dark"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        data-vim-insert=""
        aria-label={`Message ${agent.label}`}
        placeholder={readOnly ? "This connection is read-only" : `Message ${agent.label}`}
        rows={2}
        value={draft}
        disabled={readOnly}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-60 min-h-12 w-full resize-none bg-transparent text-sm outline-none field-sizing-content placeholder:text-placeholder disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-3">
        <ComposerControl
          render={<span />}
          aria-label={`Agent: ${providerLabel}`}
          className="pointer-events-none min-w-0 shrink"
        >
          {driver ? (
            <ProviderInstanceIcon
              driverKind={driver}
              displayName={providerLabel}
              className="size-4"
              iconClassName="size-4"
            />
          ) : null}
          <span className="min-w-0 truncate">{providerLabel}</span>
        </ComposerControl>
        {readOnly ? (
          <ComposerControl
            render={<span />}
            aria-label="Read-only connection"
            className="pointer-events-none"
          >
            <ComposerControlIcon icon={EyeIcon} />
            <span>Read only</span>
          </ComposerControl>
        ) : null}
        <span className="min-w-0 flex-1" />
        {isWorking && canInterrupt ? (
          <button
            type="button"
            aria-label="Interrupt"
            onClick={onInterrupt}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs hover:bg-message-action-hover focus-visible:outline-2 focus-visible:outline-ring"
          >
            <SquareIcon aria-hidden className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend || draft.trim() === ""}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs hover:bg-message-action-hover focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64"
          >
            <ArrowUpIcon aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
