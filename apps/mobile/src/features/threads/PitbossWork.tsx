import { GladosBoard } from "./GladosBoard";
import { managedWorkerStateLabel } from "@t3tools/client-runtime/glados-board";
import { useAssetUrlState } from "../../state/assets";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Cause from "effect/Cause";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  gladosInboxRows,
  gladosReceiptStatus,
  gladosInboxLayout,
  gladosNewTask,
  gladosWorkKind,
  gladosWorkStatus,
  type GladosInboxTab,
  type GladosInboxRow,
} from "./glados-inbox";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  CommandId,
  isPitbossLeadActive,
  hasCurrentVerification,
  pitbossMessageHeadline,
  verificationProposalApprovalAction,
  verificationProposalSaveAction,
  verificationRecipeForTask,
  type EnvironmentId,
  type ModelSelection,
  type PitbossAction,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";

function VerificationArtifact({
  environmentId,
  artifact,
}: {
  environmentId: EnvironmentId;
  artifact: { name: string; attachmentId: string };
}) {
  const asset = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId: artifact.attachmentId,
    fileName: artifact.name,
  });
  return (
    <Pressable
      accessibilityRole="link"
      disabled={asset._tag !== "Success"}
      onPress={() => {
        if (asset._tag === "Success") void Linking.openURL(asset.url);
      }}
    >
      <Text className="text-sm underline">Download {artifact.name}</Text>
    </Pressable>
  );
}
export function PitbossWork(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  modelSelection: ModelSelection;
  connected?: boolean;
  onComposeWork?: () => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.pitbossLive({ environmentId: props.environmentId, input: {} }),
  );
  useEffect(() => {
    if (props.connected) query.refresh();
  }, [props.connected, query.refresh]);
  const mutate = useAtomCommand(serverEnvironment.pitbossCommand, "GLaDOS work");
  const navigation = useNavigation();
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const [surface, setSurface] = useState({ width: dimensions.width, height: dimensions.height });
  const { split, listWidth } = gladosInboxLayout(surface.width, surface.height);
  const [workView, setWorkView] = useState<"board" | "advanced">("board");
  const [tab, setTab] = useState<GladosInboxTab>("all");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<ProjectId | undefined>();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<"inbox" | "settings" | "create">("inbox");
  const [isolatedCode, setIsolatedCode] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState(props.projectId);
  const [showHistory, setShowHistory] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const serverConfigs = useServerConfigs();
  const [visible, setVisible] = useState(false);
  const composeAfterDismiss = useRef(false);
  const finishDismiss = useCallback(() => {
    if (!composeAfterDismiss.current) return;
    composeAfterDismiss.current = false;
    props.onComposeWork?.();
  }, [props.onComposeWork]);
  useEffect(() => {
    // iOS reports the completed native dismissal; Android removes the modal on commit.
    if (visible || Platform.OS === "ios") return;
    const frame = requestAnimationFrame(finishDismiss);
    return () => cancelAnimationFrame(frame);
  }, [visible, finishDismiss]);
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const state = query.data;
  const role = state?.role;
  const isBoss = role?.threadId === props.threadId;
  useEffect(() => {
    if (!visible) return;
    const listener = AppState.addEventListener("change", (value) => {
      if (value === "active") setNow(Date.now());
    });
    return () => listener.remove();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const expiry = Math.min(
      ...(state?.tasks ?? [])
        .map((task) => Date.parse(task.verification?.receipt?.expiresAt ?? ""))
        .filter((value) => value > now),
    );
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [visible, state, now]);
  const inbox = useMemo(
    () => ({
      all: state ? gladosInboxRows(state, "all") : [],
      "needs-you": state ? gladosInboxRows(state, "needs-you") : [],
      working: state ? gladosInboxRows(state, "working") : [],
      delivered: state ? gladosInboxRows(state, "delivered") : [],
    }),
    [state],
  );
  const command = async (action: PitbossAction) => {
    if (!state) return false;
    if (inFlight.current) return false;
    if (query.error || props.connected === false) {
      setError("Reconnect to send this change. Your draft is still here.");
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await mutate({
        environmentId: props.environmentId,
        input: { commandId: CommandId.make(uuidv4()), expectedRevision: state.revision, action },
      });
      if (result._tag === "Failure") {
        const reason = Cause.squash(result.cause);
        setError(
          reason instanceof Error
            ? reason.message
            : "The action was not applied. Check the connection and current work before retrying.",
        );
        return false;
      }
      return true;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (!state) return null;
  // The work bar belongs to GLaDOS's own thread. Every other thread is an ordinary
  // conversation and must look like one, so it gets no header and no modal.
  if (!isBoss) return null;
  const rows = gladosInboxRows(state, tab, {
    query: search,
    ...(projectFilter ? { projectId: projectFilter } : {}),
  });
  const selectedRow = inbox.all.find((row) => row.key === selectedKey);
  const selectedTask = selectedRow?.task;
  const projectName = (id: ProjectId) =>
    projects.find((project) => project.id === id)?.title ?? "Project";
  const leaveDetail = () => {
    setSelectedKey(null);
    setShowHistory(false);
    setShowProfiles(false);
    setShowCriteria(false);
    setShowManagement(false);
  };
  const openSettings = () => {
    setVisible(false);
    // "SettingsGlados" is registered in the settings content stack by the settings navigator.
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: { screen: "SettingsGlados", params: { environmentId: props.environmentId } },
    });
  };
  const goBack = () => {
    if (panel !== "inbox") setPanel("inbox");
    else if (selectedKey) leaveDetail();
    else setVisible(false);
  };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      accessibilityState={{
        disabled: busy || disabled,
      }}
      style={{
        minHeight: 44,
        justifyContent: "center",
        opacity: busy || disabled ? 0.45 : 1,
      }}
      onPress={action}
      className="rounded-lg bg-primary/10 px-3 py-2"
    >
      <Text className="text-sm text-primary">{label}</Text>
    </Pressable>
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setNow(Date.now());
          setVisible(true);
        }}
        className="flex-row items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-2"
      >
        <Text className="font-semibold text-primary">♛ {isBoss ? "GLaDOS" : "GLaDOS work"}</Text>
        <Text className="text-xs text-foreground-muted">
          {isBoss
            ? role.paused
              ? "Paused"
              : `${state.tasks.filter((task) => task.status === "active").length} working`
            : "Manage"}
        </Text>
      </Pressable>
      {/* Android modal surfaces retain their creation density; rebuild the surface, not the draft. */}
      <Modal
        key={dimensions.scale}
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={goBack}
        onDismiss={finishDismiss}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 bg-screen"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
          onLayout={(event) =>
            setSurface({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })
          }
        >
          <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
            <View className="flex-1">
              <Text className="text-xl font-semibold">GLaDOS</Text>
              <Text className="text-xs text-foreground-muted">
                {role?.paused ? "New work paused" : "Your projects, one conversation"}
              </Text>
            </View>
            {button("Back to chat", () => setVisible(false))}
          </View>
          {(error || query.error || props.connected === false) && (
            <View className="border-b border-border px-4 py-3">
              <Text accessibilityRole="alert" className="text-red-500">
                {query.error || props.connected === false
                  ? "Disconnected — showing retained work. Actions resume when reconnected."
                  : error}
              </Text>
              {props.connected !== false && query.error && button("Reconnect work", query.refresh)}
            </View>
          )}
          {panel === "inbox" ? (
            <>
              <View className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-2">
                {button("Team", () => setPanel("settings"))}
                {button("Settings", openSettings)}
                {isBoss &&
                  button("Talk to GLaDOS", () => {
                    composeAfterDismiss.current = true;
                    setVisible(false);
                  })}
                {isBoss &&
                  button(
                    role.paused ? "Resume" : "Pause",
                    () => void command({ type: "pause", paused: !role.paused }),
                  )}
              </View>
              <View className="flex-row gap-2 px-4 pb-2">
                {(["board", "advanced"] as const).map((view) => (
                  <Pressable
                    key={view}
                    accessibilityRole="button"
                    accessibilityState={{ selected: workView === view }}
                    onPress={() => {
                      setWorkView(view);
                      leaveDetail();
                    }}
                    className={`min-h-12 justify-center rounded-xl px-4 ${workView === view ? "bg-secondary" : "bg-subtle"}`}
                  >
                    <Text>{view === "board" ? "Board" : "Advanced"}</Text>
                  </Pressable>
                ))}
              </View>
              {workView === "board" ? (
                <GladosBoard
                  state={state}
                  width={surface.width}
                  search={search}
                  onSearch={setSearch}
                  projectFilter={projectFilter}
                  onProjectFilter={setProjectFilter}
                  projectName={(id) =>
                    projects.find((project) => project.id === id)?.title ?? "Project"
                  }
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  onOpenWorker={(task, threadId) => {
                    setVisible(false);
                    navigation.navigate("Thread", {
                      environmentId: task.homeEnvironmentId ?? props.environmentId,
                      threadId,
                    });
                  }}
                  onTalkToGlados={() => {
                    composeAfterDismiss.current = true;
                    setVisible(false);
                  }}
                />
              ) : (
                <>
                  <View
                    className="flex-row border-b border-border px-2"
                    accessibilityRole="tablist"
                  >
                    {(
                      [
                        ["all", "All"],
                        ["needs-you", "Needs you"],
                        ["working", "Working"],
                        ["delivered", "Delivered"],
                      ] as const
                    ).map(([key, label]) => (
                      <Pressable
                        key={key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: tab === key }}
                        accessibilityLabel={`${label}, ${inbox[key].length}`}
                        onPress={() => {
                          setTab(key);
                          leaveDetail();
                        }}
                        style={{
                          minHeight: 48,
                          flex: 1,
                          justifyContent: "center",
                          borderBottomWidth: tab === key ? 2 : 0,
                        }}
                        className="border-primary px-1"
                      >
                        <Text
                          className={
                            tab === key
                              ? "text-center font-semibold text-primary"
                              : "text-center text-foreground-muted"
                          }
                        >
                          {label} · {inbox[key].length}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View className="flex-1 flex-row">
                    {(split || !selectedKey) && (
                      <View
                        style={{ width: split ? listWidth : "100%" }}
                        className="border-r border-border"
                      >
                        <View className="gap-2 border-b border-border px-3 py-2">
                          <TextInput
                            accessibilityLabel="Search outcomes"
                            placeholder="Search outcomes"
                            value={search}
                            onChangeText={setSearch}
                            clearButtonMode="while-editing"
                            className="min-h-11 rounded-lg bg-subtle px-3 text-foreground"
                          />
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                          >
                            <View className="flex-row gap-2">
                              {[{ id: undefined, title: "All projects" }, ...projects].map(
                                (project) => (
                                  <Pressable
                                    key={project.id ?? "all"}
                                    accessibilityRole="radio"
                                    accessibilityState={{ checked: projectFilter === project.id }}
                                    onPress={() => setProjectFilter(project.id)}
                                    className={`min-h-11 justify-center rounded-lg px-3 ${projectFilter === project.id ? "bg-primary/10" : "bg-subtle"}`}
                                  >
                                    <Text className="text-sm">{project.title}</Text>
                                  </Pressable>
                                ),
                              )}
                            </View>
                          </ScrollView>
                        </View>
                        <FlatList<GladosInboxRow>
                          data={rows}
                          keyExtractor={(row) => row.key}
                          contentContainerStyle={{ padding: 12, gap: 8 }}
                          extraData={selectedKey}
                          keyboardShouldPersistTaps="handled"
                          ListEmptyComponent={
                            <View className="gap-2 p-5">
                              <Text className="font-semibold">
                                {search.trim() || projectFilter
                                  ? "No matching outcomes"
                                  : tab === "needs-you"
                                    ? "Nothing needs your attention"
                                    : tab === "working"
                                      ? "Ready for your next outcome"
                                      : "Completed outcomes will appear here"}
                              </Text>
                              <Text className="text-sm text-foreground-muted">
                                Describe the outcome in chat. GLaDOS prepares the task, success
                                criteria and checks, then reports back here.
                              </Text>
                            </View>
                          }
                          renderItem={({ item }) => (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={
                                item.task
                                  ? `Review ${item.task.title}`
                                  : `Read ${pitbossMessageHeadline(item.message)}`
                              }
                              accessibilityState={{ selected: selectedKey === item.key }}
                              onPress={() => {
                                setSelectedKey(item.key);
                                setShowHistory(false);
                                setShowProfiles(false);
                                setShowCriteria(false);
                                setShowManagement(false);
                              }}
                              style={{ minHeight: 88 }}
                              className={`gap-1 rounded-xl border p-3 ${selectedKey === item.key ? "border-primary bg-primary/10" : "border-transparent"}`}
                            >
                              <Text className="text-xs text-foreground-muted">
                                {item.task
                                  ? `${projectName(item.task.projectId)} · ${gladosWorkStatus(item.task, state)}`
                                  : `GLaDOS · ${item.message.kind}`}
                              </Text>
                              <Text className="font-semibold" numberOfLines={2}>
                                {item.task ? item.task.title : pitbossMessageHeadline(item.message)}
                              </Text>
                              <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                                {item.task?.note ||
                                  item.task?.outcome ||
                                  "A decision from your team"}
                              </Text>
                            </Pressable>
                          )}
                        />
                      </View>
                    )}
                    {(split || selectedKey) && (
                      <ScrollView
                        className="flex-1"
                        contentContainerStyle={{ padding: 16, gap: 12 }}
                        keyboardShouldPersistTaps="handled"
                      >
                        {selectedKey && button("Back to outcomes", leaveDetail)}
                        {!selectedRow && (
                          <View className="gap-2 py-8">
                            <Text className="text-xl font-semibold">Choose an outcome</Text>
                            <Text className="text-foreground-muted">
                              See the recommendation, evidence and next decision together.
                            </Text>
                          </View>
                        )}
                        {selectedRow?.message && (
                          <View className="gap-3">
                            <Text className="text-lg font-semibold">
                              {pitbossMessageHeadline(selectedRow.message)}
                            </Text>
                            <Text selectable>{selectedRow.message.text}</Text>
                            {button("Acknowledge", () => {
                              void command({
                                type: "acknowledge",
                                messageId: selectedRow.message!.id,
                              });
                            })}
                          </View>
                        )}
                        {selectedTask &&
                          (() => {
                            const task = selectedTask;
                            return (
                              <View className="gap-3">
                                <Text className="text-xs text-foreground-muted">
                                  {projectName(task.projectId)} ·{" "}
                                  {task.leadId
                                    ? `Project lead ${task.leadId}`
                                    : "Managed by GLaDOS"}{" "}
                                  ·{" "}
                                  {task.homeEnvironmentId
                                    ? `Task home ${task.homeEnvironmentId}`
                                    : "This environment"}
                                </Text>
                                <Text className="text-xl font-semibold">{task.title}</Text>
                                <Text className="text-xs text-foreground-muted">
                                  {gladosWorkKind(task, state)} · {gladosWorkStatus(task, state)}
                                </Text>
                                {task.proposedVerificationRecipe && (
                                  <View className="rounded-xl border border-primary p-3">
                                    <Text className="font-semibold">
                                      Verification setup proposed
                                    </Text>
                                    <Text>{task.proposedVerificationRecipe.name}</Text>
                                    <Text className="text-sm text-foreground-muted">
                                      Review the checks GLaDOS prepared. Saving approves this
                                      profile for the outcome.
                                    </Text>
                                    {[
                                      [
                                        "Work type",
                                        task.proposedVerificationRecipe.mode ?? "commit",
                                      ],
                                      [
                                        "Environment",
                                        task.proposedVerificationRecipe.environmentId,
                                      ],
                                      ["Target", task.proposedVerificationRecipe.target],
                                      ["Input files", task.proposedVerificationRecipe.inputPath],
                                      ["Allowed effects", task.proposedVerificationRecipe.effects],
                                      [
                                        "Evidence lifetime",
                                        task.proposedVerificationRecipe.maxAgeSeconds
                                          ? `${task.proposedVerificationRecipe.maxAgeSeconds} seconds`
                                          : undefined,
                                      ],
                                      ["Readiness", task.proposedVerificationRecipe.doctor],
                                      ["Verification", task.proposedVerificationRecipe.verify],
                                      ["Cleanup", task.proposedVerificationRecipe.cleanup],
                                    ]
                                      .filter(([, value]) => value)
                                      .map(([label, value]) => (
                                        <View key={label} className="gap-1 py-2">
                                          <Text className="text-sm font-semibold">{label}</Text>
                                          <Text selectable className="text-xs">
                                            {value}
                                          </Text>
                                        </View>
                                      ))}
                                    <Text className="text-xs text-foreground-muted">
                                      {task.proposedVerificationRecipe.timeoutSeconds}s limit ·{" "}
                                      {task.proposedVerificationRecipe.artifacts.join(", ") ||
                                        "No captured files"}
                                    </Text>
                                    {verificationProposalSaveAction(task) &&
                                      button(
                                        verificationProposalApprovalAction(task)
                                          ? "Approve and save exact proposal"
                                          : "Save evidence profile",
                                        () => {
                                          const action = verificationProposalSaveAction(task);
                                          if (action) void command(action);
                                        },
                                        !!task.homeEnvironmentId,
                                      )}
                                  </View>
                                )}
                                {task.status !== "cancelled" &&
                                  task.decisions
                                    ?.filter((decision) => decision.answer === undefined)
                                    .map((decision) => (
                                      <View
                                        key={decision.id}
                                        className="gap-3 rounded-xl border border-primary bg-primary/5 p-4"
                                      >
                                        <Text className="text-lg font-semibold">Your decision</Text>
                                        <Text>{decision.question}</Text>
                                        <Text className="font-semibold">Recommendation</Text>
                                        <Text>
                                          {decision.recommendation || "No recommendation yet."}
                                        </Text>
                                        <Text className="text-sm text-foreground-muted">
                                          This decision pauses this outcome. Independent work can
                                          continue.
                                        </Text>
                                        {verificationProposalApprovalAction(task)?.decisionId ===
                                          decision.id && (
                                          <View className="gap-2">
                                            {button(
                                              "Approve and save evidence profile",
                                              () => {
                                                const action =
                                                  verificationProposalApprovalAction(task);
                                                if (action) void command(action);
                                              },
                                              !!task.homeEnvironmentId,
                                            )}
                                            <Text className="text-xs text-foreground-muted">
                                              Other choices and written replies do not change proof
                                              requirements.
                                            </Text>
                                          </View>
                                        )}
                                        {decision.options.map((option) => (
                                          <View key={option}>
                                            {button(
                                              option,
                                              () =>
                                                void command({
                                                  type: "resolve-decision",
                                                  taskId: task.id,
                                                  decisionId: decision.id,
                                                  answer: option,
                                                }),
                                              !!task.homeEnvironmentId,
                                            )}
                                          </View>
                                        ))}
                                        <TextInput
                                          accessibilityLabel="Your decision answer"
                                          placeholder="Or give your own direction"
                                          multiline
                                          value={decisionDrafts[decision.id] ?? ""}
                                          onChangeText={(value) =>
                                            setDecisionDrafts((drafts) => ({
                                              ...drafts,
                                              [decision.id]: value,
                                            }))
                                          }
                                          className="min-h-12 rounded-lg border border-border p-3 text-foreground"
                                        />
                                        {button(
                                          "Send decision",
                                          () => {
                                            if (decisionDrafts[decision.id]?.trim())
                                              void command({
                                                type: "resolve-decision",
                                                taskId: task.id,
                                                decisionId: decision.id,
                                                answer: decisionDrafts[decision.id]!.trim(),
                                              }).then((saved) => {
                                                if (saved)
                                                  setDecisionDrafts((drafts) => ({
                                                    ...drafts,
                                                    [decision.id]: "",
                                                  }));
                                              });
                                          },
                                          !decisionDrafts[decision.id]?.trim() ||
                                            !!task.homeEnvironmentId,
                                        )}
                                        {button("Decide later", leaveDetail)}
                                      </View>
                                    ))}
                                <Text>{task.outcome}</Text>
                                {task.dependencies.length > 0 && (
                                  <View className="gap-2">
                                    <Text className="text-sm font-semibold">Depends on</Text>
                                    {task.dependencies.map((id) => {
                                      const dependency = state.tasks.find(
                                        (candidate) => candidate.id === id,
                                      );
                                      return (
                                        <View key={id}>
                                          {button(
                                            dependency?.title ?? id,
                                            () => setSelectedKey(`task:${id}`),
                                            !dependency,
                                          )}
                                        </View>
                                      );
                                    })}
                                  </View>
                                )}
                                {button(
                                  showCriteria ? "Hide success criteria" : "What success means",
                                  () => setShowCriteria(!showCriteria),
                                )}
                                {showCriteria && (
                                  <Text className="text-sm text-foreground-muted">
                                    {task.criteria}
                                  </Text>
                                )}
                                <Text className="font-semibold">
                                  {gladosReceiptStatus(task, state, now)}
                                </Text>
                                <Text>
                                  {task.note || "The team has not reported a recommendation yet."}
                                </Text>
                                {task.closedReason && (
                                  <Text className="text-xs text-foreground-muted">
                                    Closure history · {task.closedReason}
                                    {task.closedAt
                                      ? ` · ${new Date(task.closedAt).toLocaleString()}`
                                      : ""}
                                  </Text>
                                )}
                                {state.messages
                                  .filter(
                                    (message) =>
                                      message.taskId === task.id &&
                                      !message.acknowledged &&
                                      !task.decisions?.some(
                                        (decision) =>
                                          decision.id === message.id &&
                                          decision.answer === undefined,
                                      ),
                                  )
                                  .map((message) => (
                                    <View
                                      key={message.id}
                                      className="gap-2 rounded-xl border border-primary/30 p-3"
                                    >
                                      <Text className="font-semibold">
                                        {pitbossMessageHeadline(message)}
                                      </Text>
                                      <Text selectable>{message.text}</Text>
                                      {button(
                                        "Acknowledge",
                                        () =>
                                          void command({
                                            type: "acknowledge",
                                            messageId: message.id,
                                          }),
                                      )}
                                    </View>
                                  ))}
                                {task.source && (
                                  <Text className="text-xs text-foreground-muted">
                                    {task.source.kind} · {task.source.key} · Source:{" "}
                                    {task.source.status} · T3 work: {task.status}
                                  </Text>
                                )}

                                {task.verification && (
                                  <View className="gap-2 rounded-lg bg-subtle p-3">
                                    <Text className="font-semibold">
                                      Captured verification · {task.verification.state}
                                    </Text>
                                    <Text>
                                      {task.verification.receipt?.summary ??
                                        "Waiting for the environment runner."}
                                    </Text>
                                    <Text className="text-xs">
                                      {task.verification.candidate} · recipe v
                                      {task.verification.recipe.version}
                                    </Text>
                                    {task.verification.receipt?.expiresAt && (
                                      <Text className="text-sm">
                                        Valid until{" "}
                                        {new Date(
                                          task.verification.receipt.expiresAt,
                                        ).toLocaleString()}
                                      </Text>
                                    )}
                                    {task.verification.receipt?.target && (
                                      <Text>Target: {task.verification.receipt.target}</Text>
                                    )}
                                    {button(
                                      showHistory
                                        ? "Hide logs and history"
                                        : "Show logs and history",
                                      () => setShowHistory(!showHistory),
                                    )}
                                    {showHistory &&
                                      task.verification.receipt?.checks.map((check) => (
                                        <View key={check.name}>
                                          <Text>
                                            {check.name}:{" "}
                                            {check.timedOut ? "timed out" : `exit ${check.code}`}
                                          </Text>
                                          <Text selectable className="text-xs">
                                            {check.stdout}
                                            {check.stderr}
                                          </Text>
                                        </View>
                                      ))}
                                  </View>
                                )}
                                {verificationRecipeForTask(state, task) &&
                                  verificationRecipeForTask(state, task)?.enabled !== false &&
                                  button(
                                    "Run captured verification",
                                    () => {
                                      const latest = task.evidence.at(-1);
                                      if (latest)
                                        void command({
                                          type: "verify",
                                          taskId: task.id,
                                          evidenceId: latest.id,
                                        });
                                    },
                                    busy ||
                                      !!role?.paused ||
                                      !task.evidence.length ||
                                      task.verification?.state === "pending" ||
                                      task.verification?.state === "running" ||
                                      task.attempts.some((attempt) =>
                                        [
                                          "pending",
                                          "running",
                                          "submitted",
                                          "stop_requested",
                                        ].includes(attempt.state),
                                      ),
                                  )}
                                {task.decisions
                                  ?.filter((decision) => decision.answer !== undefined)
                                  .map((decision) => (
                                    <View
                                      key={decision.id}
                                      className="gap-1 rounded-lg bg-subtle p-3"
                                    >
                                      <Text className="font-semibold">Your decision recorded</Text>
                                      <Text>{decision.question}</Text>
                                      <Text>{decision.answer}</Text>
                                    </View>
                                  ))}
                                {button(
                                  showProfiles
                                    ? "Close profile choices"
                                    : "Change evidence profile",
                                  () => setShowProfiles(!showProfiles),
                                )}
                                <Text className="text-xs">
                                  Evidence profile:{" "}
                                  {verificationRecipeForTask(state, task)?.name ??
                                    "Reported evidence"}
                                </Text>
                                {showProfiles &&
                                  (state.verificationRecipes ?? [])
                                    .filter(
                                      (recipe) =>
                                        recipe.projectId === task.projectId &&
                                        recipe.enabled !== false,
                                    )
                                    .map((recipe) => (
                                      <View key={recipe.profileId ?? "default"}>
                                        {button(
                                          `Use ${recipe.name}`,
                                          () => {
                                            void command({
                                              type: "verification-profile",
                                              taskId: task.id,
                                              profileId: recipe.profileId ?? "default",
                                            });
                                          },
                                          busy ||
                                            task.verification?.state === "running" ||
                                            task.verification?.state === "pending",
                                        )}
                                      </View>
                                    ))}
                                {showProfiles &&
                                  button(
                                    "Use reported evidence",
                                    () => {
                                      void command({
                                        type: "verification-profile",
                                        taskId: task.id,
                                        profileId: null,
                                      });
                                    },
                                    busy,
                                  )}

                                {(showHistory ? task.evidence : task.evidence.slice(-1)).map(
                                  (evidence) => (
                                    <View
                                      key={evidence.id}
                                      className="gap-1 rounded-lg bg-subtle p-3"
                                    >
                                      <Text className="text-sm">
                                        {evidence.verdict} ·{" "}
                                        {evidence.provenance.replaceAll("_", " ")}
                                      </Text>
                                      <Text className="text-sm">{evidence.summary}</Text>
                                      <Text className="text-xs">{evidence.candidate}</Text>
                                      {evidence.capture?.receipt.artifacts.map((artifact) => (
                                        <VerificationArtifact
                                          key={artifact.attachmentId}
                                          artifact={artifact}
                                          environmentId={
                                            task.homeEnvironmentId ?? props.environmentId
                                          }
                                        />
                                      ))}
                                      {task.evidence.at(-1)?.id === evidence.id &&
                                        task.status === "verifying" &&
                                        evidence.verdict === "pass" &&
                                        (!verificationRecipeForTask(state, task) ||
                                          verificationRecipeForTask(state, task)?.enabled ===
                                            false ||
                                          hasCurrentVerification(
                                            task,
                                            verificationRecipeForTask(state, task),
                                            evidence.candidate,
                                            now,
                                          )) &&
                                        button(
                                          "Accept inspected evidence",
                                          () =>
                                            void command({
                                              type: "accept",
                                              taskId: task.id,
                                              evidenceId: evidence.id,
                                              note: "User inspected and accepted evidence.",
                                            }),
                                        )}
                                    </View>
                                  ),
                                )}
                                {button(
                                  showManagement ? "Close work controls" : "Manage work",
                                  () => setShowManagement(!showManagement),
                                )}
                                {showManagement && (
                                  <View className="gap-2">
                                    {task.status === "queued" &&
                                      task.attempts.length === 0 &&
                                      button(
                                        "Assign worker",
                                        () => void command({ type: "assign", taskId: task.id }),
                                      )}
                                    {task.status !== "cancelled" &&
                                      !task.revisionRequest &&
                                      (task.attempts.length > 0 || task.evidence.length > 0) &&
                                      button(
                                        "Revise result",
                                        () =>
                                          void command({
                                            type: "revise-result",
                                            taskId: task.id,
                                            note: "Revise the retained result within the current scope.",
                                          }),
                                      )}
                                    {task.status === "cancelled" &&
                                      button(
                                        "Restore to queue",
                                        () => void command({ type: "reopen", taskId: task.id }),
                                      )}
                                    {task.status !== "cancelled" &&
                                      button(
                                        "Close outcome",
                                        () =>
                                          void command({
                                            type: "close",
                                            taskId: task.id,
                                            reason:
                                              "Closed by user as historical or superseded work.",
                                          }),
                                      )}
                                  </View>
                                )}

                                {showHistory && (
                                  <View className="gap-2">
                                    {" "}
                                    {task.attempts.map((attempt) => (
                                      <View key={attempt.id}>
                                        {button(
                                          serverConfigs.has(
                                            task.homeEnvironmentId ?? props.environmentId,
                                          )
                                            ? `Worker ${attempt.generation} · ${managedWorkerStateLabel(task, attempt, state.awaitingApproval)}${attempt.workspacePath ? ` · ${attempt.workspacePath}` : ""}`
                                            : "Connect task home first",
                                          () => {
                                            setVisible(false);
                                            navigation.navigate("Thread", {
                                              environmentId:
                                                task.homeEnvironmentId ?? props.environmentId,
                                              threadId: attempt.threadId,
                                            });
                                          },
                                          !serverConfigs.has(
                                            task.homeEnvironmentId ?? props.environmentId,
                                          ),
                                        )}
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                            );
                          })()}
                      </ScrollView>
                    )}
                  </View>
                </>
              )}
            </>
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: 16, gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {button("Back to outcomes", () => setPanel("inbox"))}
              {panel === "settings" && (
                <>
                  <Text className="text-sm text-foreground-muted">
                    Tell GLaDOS what you want in chat. Use these controls when you want to manage
                    the details yourself.
                  </Text>
                  {isBoss && button("Add outcome manually", () => setPanel("create"))}
                  {(state.leads ?? []).map((lead) => {
                    const active = isPitbossLeadActive(role, lead);
                    return (
                      <View key={lead.id} className="gap-2 rounded-xl border border-border p-3">
                        <Text className="font-semibold">
                          {lead.id} · {active ? "Managing" : "Dormant"}
                        </Text>
                        <Text className="text-sm text-foreground-muted">
                          {lead.model.model} · up to {lead.maxWorkers} shared workers
                        </Text>
                        <Text className="text-sm">{lead.charter}</Text>
                        <Text className="text-xs text-foreground-muted">
                          {projectName(lead.projectId)} · this environment · thread {lead.threadId}
                        </Text>
                        <Text className="text-sm">
                          Context v{lead.contextRevision}: {lead.context || "Not recorded yet"}
                        </Text>
                        {button("Open lead thread", () => {
                          setVisible(false);
                          navigation.navigate("Thread", {
                            environmentId: props.environmentId,
                            threadId: lead.threadId,
                          });
                        })}
                        {role?.brief.projectIds.includes(lead.projectId) &&
                          button(
                            active ? "Return to GLaDOS" : "Reactivate lead",
                            () =>
                              void command({
                                type: "lead-status",
                                leadId: lead.id,
                                status: active ? "dormant" : "active",
                              }),
                          )}
                      </View>
                    );
                  })}
                  <Text className="text-sm text-foreground-muted">
                    Priorities, projects, autonomy, models, sources and peers live in GLaDOS
                    settings.
                  </Text>
                  {button("Open GLaDOS settings", openSettings)}
                </>
              )}
              {panel === "create" && isBoss && (
                <>
                  <Text className="mt-3 font-semibold">Add an outcome</Text>
                  <TextInput
                    accessibilityLabel="Task title"
                    value={title}
                    onChangeText={setTitle}
                    className="rounded-xl border border-border p-3 text-foreground"
                    placeholder="What should get done?"
                  />
                  <TextInput
                    accessibilityLabel="Acceptance criteria"
                    value={criteria}
                    onChangeText={setCriteria}
                    multiline
                    className="rounded-xl border border-border p-3 text-foreground"
                    placeholder="How will we prove it works?"
                  />
                  <Text className="font-semibold">Project</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {projects
                      .filter((project) => role.brief.projectIds.includes(project.id))
                      .map((project) => (
                        <Pressable
                          key={project.id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: taskProjectId === project.id }}
                          onPress={() => setTaskProjectId(project.id)}
                          style={{ minHeight: 44, justifyContent: "center" }}
                          className={`rounded-lg border px-3 ${taskProjectId === project.id ? "border-primary bg-primary/10" : "border-border"}`}
                        >
                          <Text>{project.title}</Text>
                        </Pressable>
                      ))}
                  </View>
                  <Text className="font-semibold">Workspace</Text>
                  {button(isolatedCode ? "Use project files" : "Use isolated code checkout", () =>
                    setIsolatedCode(!isolatedCode),
                  )}
                  <Text className="text-sm text-foreground-muted">
                    {isolatedCode
                      ? "Creates a Git worktree for code changes."
                      : "Uses this project's files. Suitable for research and home-server work; Git is not required."}
                  </Text>
                  {button(
                    "Create outcome",
                    () => {
                      if (title.trim() && criteria.trim())
                        void command(
                          gladosNewTask({
                            id: uuidv4(),
                            projectId: taskProjectId,
                            title,
                            criteria,
                            isolatedCode,
                          }),
                        ).then((saved) => {
                          if (saved) {
                            setTitle("");
                            setCriteria("");
                            setPanel("inbox");
                            setTab("working");
                            leaveDetail();
                          }
                        });
                    },
                    !title.trim() ||
                      !criteria.trim() ||
                      !role.brief.projectIds.includes(taskProjectId),
                  )}
                </>
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

export function PitbossPins({
  environments,
}: {
  environments: readonly { environmentId: EnvironmentId; label: string }[];
}) {
  return (
    <View>
      {environments.map((environment) => (
        <PitbossPin key={environment.environmentId} {...environment} />
      ))}
    </View>
  );
}
function PitbossPin({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const query = useEnvironmentQuery(serverEnvironment.pitbossLive({ environmentId, input: {} }));
  const navigation = useNavigation();
  const role = query.data?.role;
  if (!role) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open GLaDOS in ${label}`}
      onPress={() => navigation.navigate("Thread", { environmentId, threadId: role.threadId })}
      className="mx-3 my-2 flex-row items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4"
    >
      <View>
        <Text className="font-semibold text-primary">♛ GLaDOS</Text>
        <Text className="text-xs text-foreground-muted">{label}</Text>
      </View>
      <Text className="text-xs text-foreground-muted">
        {query.error ? "Offline" : role.paused ? "Paused" : "Open work"}
      </Text>
    </Pressable>
  );
}
