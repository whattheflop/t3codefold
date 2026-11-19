import { HerdrFactoryScreen } from "./HerdrFactoryScreen";
import {
  FACTORY_CARD_KIND_LABEL,
  factoryAgentRows,
  openFactoryCards,
  selectFactoryTarget,
} from "@t3tools/client-runtime/factory-view";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentId, FactoryCard, FactoryStatus, ThreadId } from "@t3tools/contracts";
import * as LocalAuthentication from "expo-local-authentication";
import { useRef, useState } from "react";
import { Linking, TextInput, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollViewSurface } from "../../components/ui/ScreenScrollView";
import { EmptyState } from "../../components/ui/EmptyState";
import { ThreadCanvasBackdrop } from "../threads/ThreadCanvasBackdrop";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";

async function confirmOutwardDecision(): Promise<string | null> {
  if (
    !(await LocalAuthentication.hasHardwareAsync()) ||
    !(await LocalAuthentication.isEnrolledAsync())
  )
    return "Enrol biometrics to answer an outward-action card here, or answer on desktop.";
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm Factory decision",
    disableDeviceFallback: true,
    biometricsSecurityLevel: "strong",
  });
  return auth.success ? null : "Biometric confirmation was not completed. Nothing was sent.";
}

export function FactoryPin() {
  const navigation = useNavigation();
  return (
    <View className="px-4 py-2">
      <Button label="Factory" onPress={() => navigation.navigate("Factory", {})} />
    </View>
  );
}

export function FactoryRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId?: EnvironmentId; readonly cardId?: string }>) {
  const [backend, setBackend] = useState<"t3" | "herdr">("t3");
  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-4 py-2">
        <Button
          label="T3 Factory"
          tone={backend === "t3" ? "primary" : "secondary"}
          onPress={() => setBackend("t3")}
        />
        <Button
          label="Herdr Core"
          tone={backend === "herdr" ? "primary" : "secondary"}
          onPress={() => setBackend("herdr")}
        />
      </View>
      {backend === "herdr" ? (
        <HerdrFactoryScreen />
      ) : (
        <FactoryScreen
          key={`${route.params.environmentId ?? ""}:${route.params.cardId ?? ""}`}
          destination={route.params}
        />
      )}
    </View>
  );
}

function FactoryScreen({
  destination,
}: {
  readonly destination: { readonly environmentId?: EnvironmentId; readonly cardId?: string };
}) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const { environment, cardId } = selectFactoryTarget(environments, selected, destination);
  return (
    <SettingsScreen title="Factory">
      <View className="flex-1 overflow-hidden">
        <View pointerEvents="none" className="absolute inset-0 overflow-hidden bg-screen">
          <ThreadCanvasBackdrop />
        </View>
        <ScreenScrollViewSurface value="bg-transparent">
          <View className="flex-row flex-wrap gap-2 border-b border-border-subtle bg-card px-4 py-3">
            {environments.map((e) => (
              <Button
                key={e.environmentId}
                label={e.label}
                tone={environment?.environmentId === e.environmentId ? "primary" : "secondary"}
                onPress={() => setSelected(e.environmentId)}
              />
            ))}
          </View>
          {environment ? (
            <FactoryInbox
              key={environment.environmentId}
              environmentId={environment.environmentId}
              environmentLabel={environment.label}
              cardId={cardId}
            />
          ) : (
            <Text className="p-5 text-foreground-muted">
              Connect this environment before opening its Factory.
            </Text>
          )}
        </ScreenScrollViewSurface>
      </View>
    </SettingsScreen>
  );
}

function FactoryInbox({
  environmentId,
  environmentLabel,
  cardId,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly cardId?: string;
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const query = useEnvironmentQuery(serverEnvironment.factoryBoard({ environmentId, input: {} }));
  const [selected, setSelected] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const cards = openFactoryCards(query.data?.cards ?? []);
  const commander = query.data?.agents.find(
    (agent) =>
      agent.role === "commander" && agent.lifecycle !== "closed" && agent.lifecycle !== "retired",
  );
  const card = cards.find((c) => c.id === (selected ?? cardId));
  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 px-4 py-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
    >
      <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border-subtle bg-card px-4 py-3">
        <View className="flex-1 gap-1">
          <Text className="text-xs text-foreground-muted">FACTORY</Text>
          <Text className="font-t3-bold" numberOfLines={1}>
            {environmentLabel}
          </Text>
        </View>
        {query.data && (
          <Text className="text-xs text-foreground-muted">
            {query.data.status.stopping ? "Stopping" : query.data.status.enabled ? "On" : "Off"}
          </Text>
        )}
      </View>
      {query.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error}
        </Text>
      )}
      {!query.data ? (
        <Text className="text-foreground-muted">Loading Factory…</Text>
      ) : !query.data.status.enabled ? (
        <View className="gap-4 rounded-[22px] border border-border-subtle bg-card p-5">
          <Text className="text-xs text-foreground-muted">
            OFF BY DEFAULT · YOUR SERVER, YOUR CALL
          </Text>
          <Text className="font-t3-bold text-2xl">A workspace for your agents.</Text>
          <Text className="leading-relaxed text-foreground-muted">
            Review decisions. Follow your crew. Open their threads. Enable Factory for this server
            when you’re ready; your regular T3 threads continue normally.
          </Text>
          <Text className="text-foreground-muted">
            {query.data.status.forcedOff
              ? "The server forces Factory off. Remove T3CODE_FACTORY_DISABLED and restart the server to allow enabling it."
              : query.data.status.stopping
                ? "Waiting for active Factory turns and commands to stop. History is retained."
                : "Enable Factory to use its Commander, checks and automation. Turning it off cancels queued work and requests stops for active turns and commands."}
          </Text>
          <FactoryPowerControl environmentId={environmentId} status={query.data.status} />
          {query.data.status.stopping &&
            query.data.jobs
              .filter((job) => job.state !== "terminal")
              .map((job) => (
                <Text key={job.id} className="text-foreground-muted">
                  {job.argv.join(" ")} · {job.state} · cancellation requested
                </Text>
              ))}
        </View>
      ) : (
        <>
          <FactoryPowerControl environmentId={environmentId} status={query.data.status} />
          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border-subtle bg-card p-4">
            <Text className="font-t3-bold text-lg">Needs you · {cards.length}</Text>
            <Text className="text-xs text-foreground-muted">
              {cards.filter((c) => c.body.blocking).length} blocking
            </Text>
          </View>
          {query.data.executions.some((execution) => execution.state === "unknown") && (
            <Text accessibilityRole="alert" className="text-danger">
              An action result is unknown. Verify its external result before authorising another
              action.
            </Text>
          )}
          {commander && (
            <Button
              label="Open Commander"
              tone="secondary"
              onPress={() =>
                selectDetail({
                  name: "Thread",
                  params: {
                    environmentId: String(environmentId),
                    threadId: String(commander.threadId),
                  },
                })
              }
            />
          )}
          {cardId && !query.data.cards.some((c) => c.id === cardId) && (
            <Text className="text-foreground-muted">
              This decision is unavailable. The inbox below shows current decisions.
            </Text>
          )}
          {card ? (
            <>
              <Button label="Back to decisions" onPress={() => setSelected("")} />
              <MobileCard
                key={`${card.id}:${card.revision}`}
                environmentId={environmentId}
                card={card}
                ownerThreadId={
                  query.data.agents.find((agent) => agent.id === card.ownerId)?.threadId
                }
              />
            </>
          ) : (
            <>
              {!cards.length && (
                <EmptyState
                  title="You’re all caught up."
                  detail="Your agents can keep working. New questions will appear here when they need your input."
                />
              )}
              {cards.map((c) => (
                <View
                  key={c.id}
                  className="gap-3 rounded-2xl border border-border-subtle bg-card p-4"
                >
                  <Text className="text-foreground-muted">
                    {FACTORY_CARD_KIND_LABEL[c.body.kind]} · {c.ownerId} · {c.body.urgency}
                    {c.body.blocking ? " · blocking" : ""}
                  </Text>
                  <Button label={c.body.title} onPress={() => setSelected(c.id)} />
                </View>
              ))}
              <Text className="font-t3-bold text-lg">Fleet</Text>
              <Text className="text-xs text-foreground-muted">
                Roles and lifecycle. Open a thread for live activity.
              </Text>
              {factoryAgentRows(query.data.agents).map(({ agent: a, depth }) => (
                <View
                  key={a.id}
                  className="gap-2 rounded-xl border border-border-subtle bg-card px-3 py-3"
                  style={{ marginLeft: Math.min(depth, 3) * 12 }}
                >
                  <Button
                    label={`${a.id} · ${a.role}`}
                    tone="text"
                    onPress={() =>
                      selectDetail({
                        name: "Thread",
                        params: {
                          environmentId: String(environmentId),
                          threadId: String(a.threadId),
                        },
                      })
                    }
                  />
                  <Text className="text-foreground-muted">
                    {a.lifecycle} · {a.next}
                  </Text>
                  {a.needs && <Text>Needs: {a.needs}</Text>}
                </View>
              ))}
              <Text className="font-t3-bold text-lg">Triggers</Text>
              {query.data.triggers.map((t) => (
                <Text
                  key={t.id}
                  className="rounded-xl border border-border-subtle bg-card p-3 text-foreground-muted"
                >
                  {t.id} · {t.shadow ? "shadow" : "live"} · {t.failing ? "failing" : "healthy"}
                </Text>
              ))}
            </>
          )}
        </>
      )}
    </ScreenScrollView>
  );
}

function FactoryPowerControl({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: FactoryStatus;
}) {
  const allowed = useAtomValue(serverEnvironment.factorySetEnabled.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(
    serverEnvironment.factorySetEnabled,
    "Change Factory availability",
  );
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={
        busy
          ? "Updating…"
          : status.enabled
            ? "Turn Factory off"
            : status.stopping
              ? "Stopping Factory…"
              : "Enable Factory"
      }
      tone="secondary"
      disabled={!allowed || busy || status.forcedOff || (!status.enabled && status.stopping)}
      onPress={async () => {
        setBusy(true);
        await setEnabled({ environmentId, input: { enabled: !status.enabled } });
        setBusy(false);
      }}
    />
  );
}

function MobileCard({
  environmentId,
  card,
  ownerThreadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly card: FactoryCard;
  readonly ownerThreadId: ThreadId | undefined;
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const noteRef = useRef<TextInputInstance>(null);
  const [option, setOption] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(serverEnvironment.factoryAnswerCard.permissionAtom(environmentId));
  const answer = useAtomCommand(serverEnvironment.factoryAnswerCard, "Answer Factory decision");
  const payload = useEnvironmentQuery(
    card.body.action
      ? serverEnvironment.factoryPayload({
          environmentId,
          input: { sha256: card.body.action.payloadSha256 },
        })
      : null,
  );
  const send = async () => {
    if (busy || !allowed || (!option && !note.trim()) || (card.body.action && !payload.data))
      return;
    setBusy(true);
    setError(null);
    const approvalError = card.body.action
      ? await confirmOutwardDecision().catch(
          () => "Biometric confirmation is unavailable. Nothing was sent.",
        )
      : null;
    if (approvalError) {
      setError(approvalError);
      setBusy(false);
      return;
    }
    await answer({
      environmentId,
      input: {
        cardId: card.id,
        revision: card.revision,
        ...(option === "default" ? { yourCall: true } : option ? { optionId: option } : {}),
        ...(note.trim() ? { note } : {}),
      },
    }).catch(() => setError("The decision could not be sent. Reload it before trying again."));
    setBusy(false);
  };
  return (
    <View className="gap-4 rounded-2xl border border-border-subtle bg-card p-4">
      <Text className="font-t3-bold text-xl">{card.body.title}</Text>
      <Text className="text-foreground-muted">
        {FACTORY_CARD_KIND_LABEL[card.body.kind]} · {card.ownerId} · revision {card.revision}
      </Text>
      {ownerThreadId && (
        <Button
          label="Open owner thread"
          tone="text"
          onPress={() =>
            selectDetail({
              name: "Thread",
              params: { environmentId: String(environmentId), threadId: String(ownerThreadId) },
            })
          }
        />
      )}
      {Array.from(
        new Map(card.body.links.map((link) => [`${link.kind}:${link.ref}`, link])).values(),
      ).map((link) =>
        link.kind === "thread" ? (
          <Button
            key={`${link.kind}:${link.ref}`}
            label={link.label ?? "Open thread"}
            tone="text"
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: { environmentId: String(environmentId), threadId: link.ref },
              })
            }
          />
        ) : /^https?:\/\//.test(link.ref) ? (
          <Button
            key={`${link.kind}:${link.ref}`}
            label={link.label ?? link.ref}
            tone="text"
            onPress={() => {
              void Linking.openURL(link.ref).catch(() =>
                setError("This link could not be opened."),
              );
            }}
          />
        ) : (
          <Text key={`${link.kind}:${link.ref}`} selectable className="text-foreground-muted">
            {link.label ?? link.ref}
          </Text>
        ),
      )}
      <Text>Doing: {card.body.context.doing}</Text>
      <Text>Why you: {card.body.context.whyNotMe}</Text>
      <Text>Waiting: {card.body.context.costOfWaiting}</Text>
      {card.body.action && (
        <View className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
          <Text className="font-t3-medium">Exact action awaiting your decision</Text>
          <Text selectable className="text-xs text-foreground-muted">
            SHA-256 {card.body.action.payloadSha256}
          </Text>
          <Text selectable>
            {payload.data
              ? JSON.stringify(payload.data.envelope, null, 2)
              : (payload.error ?? "Loading action…")}
          </Text>
        </View>
      )}
      {card.body.options.map((o) => (
        <View key={o.id} className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
          <Button
            label={`${option === o.id ? "Selected: " : ""}${o.id} · ${o.label}${o.recommended ? " · recommended" : ""}`}
            tone={option === o.id ? "primary" : "secondary"}
            disabled={!allowed || busy}
            onPress={() => setOption(o.id)}
          />
          <Text>Next: {o.nextStep}</Text>
          <Text className="text-foreground-muted">
            {o.cost} · {o.reversibility}
          </Text>
          <Text>{o.consequences}</Text>
        </View>
      ))}
      <Text>{card.body.rationale}</Text>
      {[...new Set(card.body.caveats)].map((c) => (
        <Text key={c} className="text-foreground-muted">
          {c}
        </Text>
      ))}
      <Button
        label="Defer to agent (uses recommendation)"
        tone={option === "default" ? "primary" : "secondary"}
        disabled={!allowed || busy}
        onPress={() => setOption("default")}
      />
      <Button
        label="Write my own direction"
        tone="text"
        disabled={!allowed || busy}
        onPress={() => {
          setOption(null);
          noteRef.current?.focus();
        }}
      />
      <TextInput
        ref={noteRef}
        accessibilityLabel="Decision note"
        multiline
        value={note}
        onChangeText={setNote}
        placeholder="Add a note or your own direction"
        className="min-h-24 rounded-xl border border-border-subtle bg-card p-4 text-foreground"
      />
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      <Text className="text-foreground-muted">
        {option
          ? `Staged: ${option === "default" ? "take the recommendation" : (card.body.options.find((item) => item.id === option)?.label ?? option)}. `
          : ""}
        Your choice is staged until Send.
        {card.body.action ? " Biometric confirmation is required." : ""}
      </Text>
      <Button
        label="Send"
        tone="primary"
        loading={busy}
        disabled={!allowed || (!option && !note.trim()) || (!!card.body.action && !payload.data)}
        onPress={() => void send()}
      />
    </View>
  );
}
