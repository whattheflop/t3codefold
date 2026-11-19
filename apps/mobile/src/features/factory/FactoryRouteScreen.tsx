import { m } from "../../i18n/messages";
import { msg, useGT, useMessages } from "gt-react-native";
import { HerdrFactoryScreen } from "./HerdrFactoryScreen";
import {
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

const factoryLabels = {
  decision: msg("Decision"),
  housekeeping: msg("Housekeeping"),
  "fyi-chose": msg("Agent chose · FYI"),
  now: msg("Now"),
  today: msg("Today"),
  "this-week": msg("This week"),
  commander: msg("Commander"),
  subcommander: msg("Subcommander"),
  worker: msg("Worker"),
  launching: msg("Launching"),
  active: msg("Active"),
  parked: msg("Parked"),
  retired: msg("Retired"),
  closed: msg("Closed"),
  queued: msg("Queued"),
  running: msg("Running"),
  quarantined: msg("Quarantined"),
  terminal: msg("Finished"),
  reversible: msg("Reversible"),
  costly: msg("Costly to reverse"),
  irreversible: msg("Irreversible"),
};

async function confirmOutwardDecision(): Promise<string | null> {
  if (
    !(await LocalAuthentication.hasHardwareAsync()) ||
    !(await LocalAuthentication.isEnrolledAsync())
  )
    return m(msg("Enrol biometrics to answer an outward-action card here, or answer on desktop."));
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: m(msg("Confirm Factory decision")),
    disableDeviceFallback: true,
    biometricsSecurityLevel: "strong",
  });
  return auth.success
    ? null
    : m(msg("Biometric confirmation was not completed. Nothing was sent."));
}

export function FactoryPin() {
  const gt = useGT();
  const navigation = useNavigation();
  return (
    <View className="px-4 py-2">
      <Button label={gt("Factory")} onPress={() => navigation.navigate("Factory", {})} />
    </View>
  );
}

export function FactoryRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId?: EnvironmentId; readonly cardId?: string }>) {
  const gt = useGT();
  const [backend, setBackend] = useState<"t3" | "herdr">("t3");
  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-4 py-2">
        <Button
          label={gt("T3 Factory")}
          tone={backend === "t3" ? "primary" : "secondary"}
          onPress={() => setBackend("t3")}
        />
        <Button
          label={gt("Herdr Core")}
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
  const gt = useGT();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const { environment, cardId } = selectFactoryTarget(environments, selected, destination);
  return (
    <SettingsScreen title={gt("Factory")}>
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
              {gt("Connect this environment before opening its Factory.")}
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
  const gt = useGT();
  const resolve = useMessages();
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
          <Text className="text-xs text-foreground-muted">{gt("FACTORY")}</Text>
          <Text className="font-t3-bold" numberOfLines={1}>
            {environmentLabel}
          </Text>
        </View>
        {query.data && (
          <Text className="text-xs text-foreground-muted">
            {query.data.status.stopping
              ? gt("Stopping")
              : query.data.status.enabled
                ? gt("On")
                : gt("Off")}
          </Text>
        )}
      </View>
      {query.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error}
        </Text>
      )}
      {!query.data ? (
        <Text className="text-foreground-muted">{gt("Loading Factory…")}</Text>
      ) : !query.data.status.enabled ? (
        <View className="gap-4 rounded-[22px] border border-border-subtle bg-card p-5">
          <Text className="text-xs text-foreground-muted">
            {gt("OFF BY DEFAULT · YOUR SERVER, YOUR CALL")}
          </Text>
          <Text className="font-t3-bold text-2xl">{gt("A workspace for your agents.")}</Text>
          <Text className="leading-relaxed text-foreground-muted">
            {gt(
              "Review decisions. Follow your crew. Open their threads. Enable Factory for this server when you’re ready; your regular T3 threads continue normally.",
            )}
          </Text>
          <Text className="text-foreground-muted">
            {query.data.status.forcedOff
              ? gt(
                  "The server forces Factory off. Remove T3CODE_FACTORY_DISABLED and restart the server to allow enabling it.",
                )
              : query.data.status.stopping
                ? gt("Waiting for active Factory turns and commands to stop. History is retained.")
                : gt(
                    "Enable Factory to use its Commander, checks and automation. Turning it off cancels queued work and requests stops for active turns and commands.",
                  )}
          </Text>
          <FactoryPowerControl environmentId={environmentId} status={query.data.status} />
          {query.data.status.stopping &&
            query.data.jobs
              .filter((job) => job.state !== "terminal")
              .map((job) => (
                <Text key={job.id} className="text-foreground-muted">
                  {gt("{command} · {state} · cancellation requested", {
                    command: job.argv.join(" "),
                    state: resolve(factoryLabels[job.state]),
                  })}
                </Text>
              ))}
        </View>
      ) : (
        <>
          <FactoryPowerControl environmentId={environmentId} status={query.data.status} />
          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border-subtle bg-card p-4">
            <Text className="font-t3-bold text-lg">
              {gt("Needs you · {count}", { count: cards.length })}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {gt("{count} blocking", { count: cards.filter((c) => c.body.blocking).length })}
            </Text>
          </View>
          {query.data.executions.some((execution) => execution.state === "unknown") && (
            <Text accessibilityRole="alert" className="text-danger">
              {gt(
                "An action result is unknown. Verify its external result before authorising another action.",
              )}
            </Text>
          )}
          {commander && (
            <Button
              label={gt("Open Commander")}
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
              {gt("This decision is unavailable. The inbox below shows current decisions.")}
            </Text>
          )}
          {card ? (
            <>
              <Button label={gt("Back to decisions")} onPress={() => setSelected("")} />
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
                  title={gt("You’re all caught up.")}
                  detail={gt(
                    "Your agents can keep working. New questions will appear here when they need your input.",
                  )}
                />
              )}
              {cards.map((c) => (
                <View
                  key={c.id}
                  className="gap-3 rounded-2xl border border-border-subtle bg-card p-4"
                >
                  <Text className="text-foreground-muted">
                    {resolve(factoryLabels[c.body.kind])} · {c.ownerId} ·{" "}
                    {resolve(factoryLabels[c.body.urgency])}
                    {c.body.blocking ? ` · ${gt("blocking")}` : ""}
                  </Text>
                  <Button label={c.body.title} onPress={() => setSelected(c.id)} />
                </View>
              ))}
              <Text className="font-t3-bold text-lg">{gt("Fleet")}</Text>
              <Text className="text-xs text-foreground-muted">
                {gt("Roles and lifecycle. Open a thread for live activity.")}
              </Text>
              {factoryAgentRows(query.data.agents).map(({ agent: a, depth }) => (
                <View
                  key={a.id}
                  className="gap-2 rounded-xl border border-border-subtle bg-card px-3 py-3"
                  style={{ marginLeft: Math.min(depth, 3) * 12 }}
                >
                  <Button
                    label={`${a.id} · ${resolve(factoryLabels[a.role])}`}
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
                    {resolve(factoryLabels[a.lifecycle])} · {a.next}
                  </Text>
                  {a.needs && <Text>{gt("Needs: {needs}", { needs: a.needs })}</Text>}
                </View>
              ))}
              <Text className="font-t3-bold text-lg">{gt("Triggers")}</Text>
              {query.data.triggers.map((t) => (
                <Text
                  key={t.id}
                  className="rounded-xl border border-border-subtle bg-card p-3 text-foreground-muted"
                >
                  {t.id} · {t.shadow ? gt("shadow") : gt("live")} ·{" "}
                  {t.failing ? gt("failing") : gt("healthy")}
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
  const gt = useGT();
  const allowed = useAtomValue(serverEnvironment.factorySetEnabled.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(
    serverEnvironment.factorySetEnabled,
    gt("Change Factory availability"),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={
        busy
          ? gt("Updating…")
          : status.enabled
            ? gt("Turn Factory off")
            : status.stopping
              ? gt("Stopping Factory…")
              : gt("Enable Factory")
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
  const gt = useGT();
  const resolve = useMessages();
  const selectDetail = useSelectWorkspaceDetail();
  const noteRef = useRef<TextInputInstance>(null);
  const [option, setOption] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(serverEnvironment.factoryAnswerCard.permissionAtom(environmentId));
  const answer = useAtomCommand(serverEnvironment.factoryAnswerCard, gt("Answer Factory decision"));
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
      ? await confirmOutwardDecision().catch(() =>
          gt("Biometric confirmation is unavailable. Nothing was sent."),
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
    }).catch(() => setError(gt("The decision could not be sent. Reload it before trying again.")));
    setBusy(false);
  };
  return (
    <View className="gap-4 rounded-2xl border border-border-subtle bg-card p-4">
      <Text className="font-t3-bold text-xl">{card.body.title}</Text>
      <Text className="text-foreground-muted">
        {gt("{kind} · {owner} · revision {revision}", {
          kind: resolve(factoryLabels[card.body.kind]),
          owner: card.ownerId,
          revision: card.revision,
        })}
      </Text>
      {ownerThreadId && (
        <Button
          label={gt("Open owner thread")}
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
            label={link.label ?? gt("Open thread")}
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
                setError(gt("This link could not be opened.")),
              );
            }}
          />
        ) : (
          <Text key={`${link.kind}:${link.ref}`} selectable className="text-foreground-muted">
            {link.label ?? link.ref}
          </Text>
        ),
      )}
      <Text>{gt("Doing: {detail}", { detail: card.body.context.doing })}</Text>
      <Text>{gt("Why you: {detail}", { detail: card.body.context.whyNotMe })}</Text>
      <Text>{gt("Waiting: {detail}", { detail: card.body.context.costOfWaiting })}</Text>
      {card.body.action && (
        <View className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
          <Text className="font-t3-medium">{gt("Exact action awaiting your decision")}</Text>
          <Text selectable className="text-xs text-foreground-muted">
            {gt("SHA-256 {hash}", { hash: card.body.action.payloadSha256 })}
          </Text>
          <Text selectable>
            {payload.data
              ? JSON.stringify(payload.data.envelope, null, 2)
              : (payload.error ?? gt("Loading action…"))}
          </Text>
        </View>
      )}
      {card.body.options.map((o) => (
        <View key={o.id} className="gap-3 rounded-2xl border border-border-subtle bg-card p-4">
          <Button
            label={
              option === o.id
                ? o.recommended
                  ? gt("Selected: {id} · {label} · recommended", { id: o.id, label: o.label })
                  : gt("Selected: {id} · {label}", { id: o.id, label: o.label })
                : o.recommended
                  ? gt("{id} · {label} · recommended", { id: o.id, label: o.label })
                  : `${o.id} · ${o.label}`
            }
            tone={option === o.id ? "primary" : "secondary"}
            disabled={!allowed || busy}
            onPress={() => setOption(o.id)}
          />
          <Text>{gt("Next: {detail}", { detail: o.nextStep })}</Text>
          <Text className="text-foreground-muted">
            {o.cost} · {resolve(factoryLabels[o.reversibility])}
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
        label={gt("Defer to agent (uses recommendation)")}
        tone={option === "default" ? "primary" : "secondary"}
        disabled={!allowed || busy}
        onPress={() => setOption("default")}
      />
      <Button
        label={gt("Write my own direction")}
        tone="text"
        disabled={!allowed || busy}
        onPress={() => {
          setOption(null);
          noteRef.current?.focus();
        }}
      />
      <TextInput
        ref={noteRef}
        accessibilityLabel={gt("Decision note")}
        multiline
        value={note}
        onChangeText={setNote}
        placeholder={gt("Add a note or your own direction")}
        className="min-h-24 rounded-xl border border-border-subtle bg-card p-4 text-foreground"
      />
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      <Text className="text-foreground-muted">
        {option
          ? `${gt("Staged: {choice}.", {
              choice:
                option === "default"
                  ? gt("take the recommendation")
                  : (card.body.options.find((item) => item.id === option)?.label ?? option),
            })} `
          : ""}
        {gt("Your choice is staged until Send.")}
        {card.body.action ? ` ${gt("Biometric confirmation is required.")}` : ""}
      </Text>
      <Button
        label={gt("Send")}
        tone="primary"
        loading={busy}
        disabled={!allowed || (!option && !note.trim()) || (!!card.body.action && !payload.data)}
        onPress={() => void send()}
      />
    </View>
  );
}
