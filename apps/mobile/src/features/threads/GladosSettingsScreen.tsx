import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import {
  CommandId,
  PITBOSS_DEFAULT_QUALITY,
  pitbossAutonomy,
  type EnvironmentId,
  type PitbossAction,
  type PitbossBrief,
  type ProjectId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { type ComponentProps, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { uuidv4 } from "../../lib/uuid";
import { buildModelOptions } from "../../lib/modelOptions";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { gladosAutonomy, gladosSetup, gladosStatus, gladosToggleProject } from "./glados-inbox";

type GladosSettingsParams = {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
};

/**
 * Settings stack route (`SettingsGlados`). Threads link here with their environment; without
 * a route (e.g. hosted in a pane) it falls back to the first connected environment.
 */
export function GladosSettingsRouteScreen({
  route,
}: Partial<StaticScreenProps<GladosSettingsParams | undefined>>) {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="GLaDOS">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <GladosSettingsContent {...route?.params} />
      </ScrollView>
    </SettingsScreen>
  );
}

type BriefDraft = Partial<
  Pick<PitbossBrief, "priorities" | "quality" | "maxWorkers" | "maxAttempts">
>;

/** The GLaDOS settings body, without its own scroll container, for routes and split panes. */
export function GladosSettingsContent(props: GladosSettingsParams) {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const connectedEnvironments = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const [pickedEnvironmentId, setPickedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    props.environmentId ??
    pickedEnvironmentId ??
    connectedEnvironments[0]?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.pitbossLive({ environmentId, input: {} }) : null,
  );
  const config = useEnvironmentServerConfig(environmentId);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const mutate = useAtomCommand(serverEnvironment.pitbossCommand, "GLaDOS settings");
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BriefDraft>({});
  const state = query.data ?? undefined;
  const role = state?.role ?? null;
  const status = gladosStatus(state);
  const disabled = busy || !connected || !state;

  const send = async (action: PitbossAction) => {
    if (!environmentId || !state || inFlight.current) return false;
    if (!connected) {
      setError("Reconnect to change GLaDOS.");
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await mutate({
        environmentId,
        input: { commandId: CommandId.make(uuidv4()), expectedRevision: state.revision, action },
      });
      if (result._tag === "Failure") {
        const reason = Cause.squash(result.cause);
        setError(
          reason instanceof Error
            ? reason.message
            : "The change was not applied. Check the connection and try again.",
        );
        return false;
      }
      return true;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const saveBrief = (brief: PitbossBrief) => {
    void send({ type: "brief", brief: { ...brief, ...draft } }).then((saved) => {
      if (saved) setDraft({});
    });
  };

  const setupModel = scheduledTaskDefaultModel(
    config,
    projects.find((project) => project.id === props.projectId) ?? projects[0] ?? null,
  );

  return (
    <View className="gap-6">
      {!props.environmentId && connectedEnvironments.length > 1 ? (
        <SettingsSection title="Environment">
          {connectedEnvironments.map((entry, index) => (
            <SettingsChoiceRow
              key={entry.environmentId}
              label={entry.label}
              description={entry.displayUrl ?? "Each environment has its own GLaDOS."}
              selected={entry.environmentId === environmentId}
              separated={index > 0}
              disabled={busy}
              onPress={() => {
                setPickedEnvironmentId(entry.environmentId);
                setDraft({});
                setError(null);
              }}
            />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        <View className="gap-1 p-4">
          <Text className="text-lg font-t3-medium text-foreground">
            {!environment
              ? "No environment connected"
              : !state
                ? connected
                  ? "Loading GLaDOS…"
                  : `${environment.label} is offline`
                : status.title}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {[environment?.label, status.detail].filter(Boolean).join(" · ") ||
              "Connect an environment to set up GLaDOS."}
          </Text>
          {error || query.error ? (
            <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
              {error ?? query.error}
            </Text>
          ) : null}
        </View>
        {role ? (
          <>
            <Separator />
            <SettingsActionRow
              icon={role.paused ? "play" : "stop.fill"}
              label={role.paused ? "Resume GLaDOS" : "Pause new work"}
              disabled={disabled}
              onPress={() => void send({ type: "pause", paused: !role.paused })}
            />
            <Separator />
            <SettingsActionRow
              icon="arrow.up.right"
              label="Open GLaDOS"
              disabled={!environmentId}
              onPress={() =>
                environmentId &&
                navigation.navigate("Thread", { environmentId, threadId: role.threadId })
              }
            />
          </>
        ) : state ? (
          <>
            <Separator />
            <SettingsActionRow
              icon="plus"
              label="Set up GLaDOS"
              disabled={disabled || !setupModel}
              loading={busy}
              onPress={() =>
                setupModel &&
                void send(
                  gladosSetup({
                    modelSelection: setupModel,
                    projectIds: props.projectId ? [props.projectId] : [],
                  }),
                )
              }
            />
          </>
        ) : null}
      </SettingsSection>
      {state && !role && !setupModel ? (
        <Footnote>Connect a provider on this environment to choose GLaDOS's worker model.</Footnote>
      ) : null}

      {role ? (
        <>
          <SettingsSection title="Brief">
            <View className="gap-2 p-4">
              <Text className="text-lg text-foreground android:text-base">Priorities</Text>
              <TextInput
                accessibilityLabel="GLaDOS priorities"
                value={draft.priorities ?? role.brief.priorities}
                onChangeText={(priorities) => setDraft((current) => ({ ...current, priorities }))}
                editable={!disabled}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholder="What should GLaDOS work on first?"
                placeholderTextColorClassName="accent-foreground-muted"
                className="max-h-48 min-h-24 font-sans text-base text-foreground"
              />
            </View>
            {draft.priorities !== undefined && draft.priorities !== role.brief.priorities ? (
              <>
                <Separator />
                <SettingsActionRow
                  icon="checkmark"
                  label="Save priorities"
                  disabled={disabled}
                  loading={busy}
                  onPress={() => saveBrief(role.brief)}
                />
              </>
            ) : null}
          </SettingsSection>

          <SettingsSection title="Projects">
            {projects.length === 0 ? (
              <Text className="p-4 text-sm text-foreground-muted">
                No projects in this environment yet.
              </Text>
            ) : (
              projects.map((project, index) => {
                const checked = role.brief.projectIds.includes(project.id);
                return (
                  <Pressable
                    key={project.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled }}
                    disabled={disabled}
                    onPress={() =>
                      void send({
                        type: "brief",
                        brief: gladosToggleProject(role.brief, project.id),
                      })
                    }
                    className={
                      index > 0
                        ? "flex-row items-center gap-4 border-t border-border-subtle p-4 active:opacity-70 disabled:opacity-40"
                        : "flex-row items-center gap-4 p-4 active:opacity-70 disabled:opacity-40"
                    }
                  >
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="text-lg text-foreground android:text-base" numberOfLines={1}>
                        {project.title}
                      </Text>
                      <Text
                        className="text-sm text-foreground-muted"
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {project.workspaceRoot}
                      </Text>
                    </View>
                    {checked ? (
                      <SymbolView
                        name="checkmark"
                        size={18}
                        tintColorClassName="accent-icon"
                        type="monochrome"
                        weight="semibold"
                      />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </SettingsSection>
          <Footnote>GLaDOS only plans and assigns work in checked projects.</Footnote>

          <HowGladosWorks
            brief={role.brief}
            draft={draft}
            setDraft={setDraft}
            disabled={disabled}
            busy={busy}
            config={config}
            onAutonomy={(autonomy) => void send(gladosAutonomy(role.brief, autonomy))}
            onSave={() => saveBrief(role.brief)}
          />
        </>
      ) : null}

      {environmentId && state ? (
        <GladosConnections environmentId={environmentId} connected={connected} />
      ) : null}

      {role ? (
        <>
          <SettingsSection title="Danger zone">
            <SettingsActionRow
              icon="arrow.clockwise"
              label="Reset GLaDOS"
              tone="danger"
              disabled={disabled}
              onPress={() =>
                Alert.alert(
                  "Reset GLaDOS?",
                  "Open work on this environment is cancelled and GLaDOS starts again in a fresh thread. Your brief is kept and the old GLaDOS thread is archived.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Reset",
                      style: "destructive",
                      onPress: () => void send({ type: "reset" }),
                    },
                  ],
                )
              }
            />
            <Separator />
            <SettingsActionRow
              icon="xmark"
              label="Dismiss GLaDOS"
              tone="danger"
              disabled={disabled}
              onPress={() =>
                Alert.alert(
                  "Dismiss GLaDOS?",
                  "GLaDOS stops coordinating on this environment. Tasks and history stay, and you can set GLaDOS up again later.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Dismiss",
                      style: "destructive",
                      onPress: () => void send({ type: "dismiss" }),
                    },
                  ],
                )
              }
            />
          </SettingsSection>
        </>
      ) : null}
    </View>
  );
}

function HowGladosWorks(props: {
  readonly brief: PitbossBrief;
  readonly draft: BriefDraft;
  readonly setDraft: (update: (current: BriefDraft) => BriefDraft) => void;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly config: ReturnType<typeof useEnvironmentServerConfig>;
  readonly onAutonomy: (autonomy: "ask" | "full-auto") => void;
  readonly onSave: () => void;
}) {
  const autonomy = pitbossAutonomy(props.brief);
  const model = props.brief.workerModel;
  const modelLabel = useMemo(() => {
    // The brief may span several projects, so the label reads from the unfiltered catalog.
    const option = buildModelOptions(props.config, model, undefined, null).find(
      (entry) =>
        entry.selection.instanceId === model.instanceId && entry.selection.model === model.model,
    );
    return [option?.label ?? model.model, ...(model.options ?? []).map((entry) => entry.value)]
      .map(String)
      .join(" · ");
  }, [props.config, model]);
  const workers = props.draft.maxWorkers ?? props.brief.maxWorkers;
  const attempts = props.draft.maxAttempts ?? props.brief.maxAttempts;
  const quality = props.draft.quality ?? props.brief.quality;
  const advancedDirty =
    workers !== props.brief.maxWorkers ||
    attempts !== props.brief.maxAttempts ||
    quality !== props.brief.quality;

  return (
    <>
      <SettingsSection title="How GLaDOS works">
        <SettingsChoiceRow
          label="Ask me"
          description="GLaDOS and its workers ask before acting, and you approve new evidence checks."
          selected={autonomy === "ask"}
          separated={false}
          disabled={props.disabled}
          onPress={() => {
            if (autonomy !== "ask") props.onAutonomy("ask");
          }}
        />
        <SettingsChoiceRow
          label="Full auto"
          description="GLaDOS and new workers run without approval prompts and set up their own evidence checks."
          selected={autonomy === "full-auto"}
          separated
          disabled={props.disabled}
          onPress={() => {
            if (autonomy === "full-auto") return;
            Alert.alert(
              "Use full auto?",
              "GLaDOS and new workers will act within the checked projects without asking first. Workers already running keep their current permissions.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Use full auto", onPress: () => props.onAutonomy("full-auto") },
              ],
            );
          }}
        />
        <View className="border-t border-border-subtle">
          <ListRowLayout
            icon="brain"
            label="Model"
            description="Used by new workers. Change models on web or desktop."
            detail={modelLabel}
          />
        </View>
      </SettingsSection>
      {autonomy === "custom" ? (
        <Footnote>
          This brief uses a custom mix of permissions set elsewhere. Choosing Ask me or Full auto
          replaces it.
        </Footnote>
      ) : null}

      <SettingsSection title="Advanced">
        <Stepper
          icon="person.2"
          label="Workers"
          subtitle="Tasks GLaDOS runs at the same time"
          value={workers}
          min={1}
          max={10}
          disabled={props.disabled}
          onChange={(maxWorkers) => props.setDraft((current) => ({ ...current, maxWorkers }))}
        />
        <View className="border-t border-border-subtle">
          <Stepper
            icon="arrow.clockwise"
            label="Attempts"
            subtitle="Tries per task before GLaDOS asks you"
            value={attempts}
            min={1}
            max={5}
            disabled={props.disabled}
            onChange={(maxAttempts) => props.setDraft((current) => ({ ...current, maxAttempts }))}
          />
        </View>
        <View className="gap-2 border-t border-border-subtle p-4">
          <Text className="text-lg text-foreground android:text-base">Quality bar</Text>
          <TextInput
            accessibilityLabel="GLaDOS quality bar"
            value={quality}
            onChangeText={(value) => props.setDraft((current) => ({ ...current, quality: value }))}
            editable={!props.disabled}
            multiline
            scrollEnabled
            textAlignVertical="top"
            placeholder={PITBOSS_DEFAULT_QUALITY}
            placeholderTextColorClassName="accent-foreground-muted"
            className="max-h-40 min-h-16 font-sans text-base text-foreground"
          />
        </View>
        {advancedDirty ? (
          <View className="border-t border-border-subtle">
            <SettingsActionRow
              icon="checkmark"
              label="Save advanced settings"
              disabled={props.disabled}
              loading={props.busy}
              onPress={props.onSave}
            />
          </View>
        ) : null}
      </SettingsSection>
    </>
  );
}

function GladosConnections(props: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const sources = useEnvironmentQuery(
    serverEnvironment.pitbossSources({ environmentId: props.environmentId, input: {} }),
  );
  const peers = useEnvironmentQuery(
    serverEnvironment.pitbossPeers({ environmentId: props.environmentId, input: {} }),
  );
  const mutate = useAtomCommand(
    serverEnvironment.pitbossPeerCommand,
    "approve shared coordination",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sourceList = sources.data?.sources ?? [];
  const failing = sourceList.filter((source) => source.error).length;
  const peerList = peers.data?.peers ?? [];
  const localId = peers.data?.environmentId;
  const decide = (type: "approve" | "decline", peerId: string, proposalId: string) => {
    setBusy(true);
    void mutate({
      environmentId: props.environmentId,
      input: { type, peerId, proposalId },
    }).then((result) => {
      setBusy(false);
      if (result._tag === "Failure")
        setError(
          `${type === "approve" ? "Approval" : "Decision"} could not be applied. Resolve active workers and refresh.`,
        );
      peers.refresh();
    });
  };

  return (
    <>
      <SettingsSection title="Connections">
        <ListRowLayout
          icon="ticket"
          label="Task sources"
          description={
            sources.error
              ? sources.error
              : failing
                ? `${failing} ${failing === 1 ? "source needs" : "sources need"} attention`
                : undefined
          }
          detail={
            sources.data
              ? `${sourceList.filter((source) => source.config.enabled).length} connected`
              : "—"
          }
        />
        <View className="border-t border-border-subtle">
          <ListRowLayout
            icon="point.3.connected.trianglepath.dotted"
            label="Peers"
            description={error ?? peers.error ?? undefined}
            detail={peers.data ? `${peerList.length} paired` : "—"}
          />
        </View>
        {peerList.map((peer) => (
          <View key={peer.config.id} className="gap-2 border-t border-border-subtle p-4">
            <Text className="text-base text-foreground">{peer.config.id}</Text>
            <Text className="text-sm text-foreground-muted">
              {peer.error ?? "Paired"} · {peer.pendingMessages ?? 0} messages pending
            </Text>
            {peer.view.proposals.map((proposal) => {
              const approved =
                localId !== undefined && peer.view.approvals[localId] === proposal.id;
              const declined =
                localId !== undefined &&
                (peer.view.rejections?.[localId]?.includes(proposal.id) ?? false);
              return (
                <View key={proposal.id} className="gap-2 rounded-xl bg-subtle p-3">
                  <Text className="text-sm text-foreground">
                    Coordinator:{" "}
                    {proposal.coordinator === localId ? "this environment" : peer.config.id} · Task
                    home: {proposal.homeEnvironmentId ?? proposal.coordinator}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {proposal.participants.every((id) => peer.view.approvals[id] === proposal.id)
                      ? "Approved by both environments"
                      : declined
                        ? "Declined here"
                        : "Awaiting approvals"}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {localId !== undefined && !approved ? (
                      <PeerButton
                        label="Approve"
                        disabled={busy || !props.connected}
                        onPress={() => decide("approve", peer.config.id, proposal.id)}
                      />
                    ) : null}
                    {localId !== undefined && !declined ? (
                      <PeerButton
                        label={approved ? "Withdraw approval" : "Decline"}
                        disabled={busy || !props.connected || !peer.config.enabled}
                        onPress={() => decide("decline", peer.config.id, proposal.id)}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        <View className="border-t border-border-subtle">
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Refresh"
            disabled={busy}
            onPress={() => {
              setError(null);
              sources.refresh();
              peers.refresh();
            }}
          />
        </View>
      </SettingsSection>
      <Footnote>Add task sources and pair peers from GLaDOS settings on web or desktop.</Footnote>
    </>
  );
}

function Stepper(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly subtitle: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <ListRowLayout
      icon={props.icon}
      label={props.label}
      description={props.subtitle}
      accessory={
        <View className="flex-row items-center gap-3">
          <StepButton
            symbol="minus"
            label={`Fewer ${props.label.toLowerCase()}`}
            disabled={props.disabled || props.value <= props.min}
            onPress={() => props.onChange(props.value - 1)}
          />
          <Text className="min-w-6 text-center text-lg tabular-nums text-foreground">
            {props.value}
          </Text>
          <StepButton
            symbol="plus"
            label={`More ${props.label.toLowerCase()}`}
            disabled={props.disabled || props.value >= props.max}
            onPress={() => props.onChange(props.value + 1)}
          />
        </View>
      }
    />
  );
}

function StepButton(props: {
  readonly symbol: "minus" | "plus";
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      hitSlop={6}
      onPress={props.onPress}
      className="size-9 items-center justify-center rounded-full bg-subtle active:opacity-70 disabled:opacity-40"
    >
      <SymbolView
        name={props.symbol}
        size={16}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="semibold"
      />
    </Pressable>
  );
}

function PeerButton(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-11 justify-center rounded-lg bg-primary/10 px-3 active:opacity-70 disabled:opacity-40"
    >
      <Text className="text-sm text-primary">{props.label}</Text>
    </Pressable>
  );
}

function Separator() {
  return <View className="h-px bg-border-subtle" />;
}

function Footnote(props: { readonly children: string }) {
  return <Text className="-mt-4 px-2 text-sm text-foreground-muted">{props.children}</Text>;
}
