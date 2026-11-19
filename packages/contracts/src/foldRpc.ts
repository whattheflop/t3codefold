import {
  FactoryError,
  FactoryStatus,
  FactoryBoard,
  FactoryAgent,
  FactoryCard,
  FactoryPayload,
  FactoryTrigger,
  FactoryTriggerRun,
  FactoryEnsureCommanderInput,
  FactoryAnswerInput,
  FactoryLifecycleInput,
  FactoryTriggerInput,
  FactoryWakeInput,
} from "./factory.ts";
/**
 * Fold-only WebSocket RPCs: fleet routing and realtime voice. `rpc.ts` spreads
 * `FOLD_WS_METHODS` into `WS_METHODS` and merges `FoldRpcGroup` into
 * `WsRpcGroup`, so upstream syncs touch only those lines there.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  FleetConnectInput,
  FleetEnvironmentList,
  FleetExecuteInput,
  FleetInvocation,
  FleetInvokeInput,
  FleetResponse,
} from "./fleet.ts";
import { OrchestratorMcpFailure } from "./orchestratorMcp.ts";
import {
  PitbossCommand,
  PitbossError,
  PitbossReadInput,
  PitbossSnapshot,
  PitbossSourceRequest,
  PitbossSourcesResult,
} from "./pitboss.ts";
import { PitbossPeerCommand, PitbossPeerList } from "./pitbossPeer.ts";
import {
  ProviderRealtimeVoiceContextInput,
  ProviderRealtimeVoiceError,
  ProviderRealtimeVoiceEvent,
  ProviderRealtimeVoiceListResult,
  ProviderRealtimeVoiceStartInput,
  ProviderRealtimeVoiceStartResult,
  ProviderRealtimeVoiceStopInput,
} from "./realtimeVoice.ts";

export const FOLD_WS_METHODS = {
  // Pitboss (GLaDOS managed work)
  pitbossPeers: "pitboss.peers",
  pitbossPeerCommand: "pitboss.peerCommand",
  pitbossSources: "pitboss.sources",
  pitbossSourceCommand: "pitboss.sourceCommand",
  pitbossRead: "pitboss.read",
  pitbossSubscribe: "pitboss.subscribe",
  pitbossCommand: "pitboss.command",
  factorySetEnabled: "factory.setEnabled",
  factorySubscribeBoard: "factory.subscribeBoard",
  factoryEnsureCommander: "factory.ensureCommander",
  factoryAnswerCard: "factory.answerCard",
  factoryWithdrawCard: "factory.withdrawCard",
  factoryGetPayload: "factory.getPayload",
  factorySetAgentLifecycle: "factory.setAgentLifecycle",
  factoryUpsertTrigger: "factory.upsertTrigger",
  factoryRunTrigger: "factory.runTrigger",
  factorySetTriggerShadow: "factory.setTriggerShadow",
  factoryRetryWake: "factory.retryWake",
  factoryDeferWake: "factory.deferWake",
  factoryCancelLaneJob: "factory.cancelLaneJob",

  // Fleet: orchestration across a client's connected environments
  fleetConnect: "fleet.connect",
  fleetRespond: "fleet.respond",
  fleetExecute: "fleet.execute",
  fleetInvoke: "fleet.invoke",
  fleetEnvironments: "fleet.environments",

  // Realtime voice (live Codex calls)
  providerRealtimeVoiceStart: "provider.realtimeVoice.start",
  providerRealtimeVoiceStop: "provider.realtimeVoice.stop",
  providerRealtimeVoiceList: "provider.realtimeVoice.list",
  providerRealtimeVoiceContext: "provider.realtimeVoice.context",
  providerRealtimeVoiceEvents: "provider.realtimeVoice.events",
} as const;

const PitbossRpcError = Schema.Union([PitbossError, EnvironmentAuthorizationError]);
const FleetRpcError = Schema.Union([OrchestratorMcpFailure, EnvironmentAuthorizationError]);
const RealtimeVoiceRpcError = Schema.Union([
  ProviderRealtimeVoiceError,
  EnvironmentAuthorizationError,
]);

const WsPitbossPeersRpc = Rpc.make(FOLD_WS_METHODS.pitbossPeers, {
  payload: PitbossReadInput,
  success: PitbossPeerList,
  error: PitbossRpcError,
});
const WsPitbossPeerCommandRpc = Rpc.make(FOLD_WS_METHODS.pitbossPeerCommand, {
  payload: PitbossPeerCommand,
  success: PitbossPeerList,
  error: PitbossRpcError,
});
const WsPitbossSourcesRpc = Rpc.make(FOLD_WS_METHODS.pitbossSources, {
  payload: PitbossReadInput,
  success: PitbossSourcesResult,
  error: PitbossRpcError,
});
const WsPitbossSourceCommandRpc = Rpc.make(FOLD_WS_METHODS.pitbossSourceCommand, {
  payload: PitbossSourceRequest,
  success: PitbossSourcesResult,
  error: PitbossRpcError,
});
const WsPitbossReadRpc = Rpc.make(FOLD_WS_METHODS.pitbossRead, {
  payload: PitbossReadInput,
  success: PitbossSnapshot,
  error: PitbossRpcError,
});
const WsPitbossSubscribeRpc = Rpc.make(FOLD_WS_METHODS.pitbossSubscribe, {
  payload: PitbossReadInput,
  success: PitbossSnapshot,
  stream: true,
  error: PitbossRpcError,
});
const WsPitbossCommandRpc = Rpc.make(FOLD_WS_METHODS.pitbossCommand, {
  payload: PitbossCommand,
  success: PitbossSnapshot,
  error: PitbossRpcError,
});

const WsFleetConnectRpc = Rpc.make(FOLD_WS_METHODS.fleetConnect, {
  payload: FleetConnectInput,
  success: FleetInvocation,
  error: FleetRpcError,
  stream: true,
});
const WsFleetRespondRpc = Rpc.make(FOLD_WS_METHODS.fleetRespond, {
  payload: FleetResponse,
  error: FleetRpcError,
});
const WsFleetExecuteRpc = Rpc.make(FOLD_WS_METHODS.fleetExecute, {
  payload: FleetExecuteInput,
  success: Schema.Unknown,
  error: FleetRpcError,
});
const WsFleetInvokeRpc = Rpc.make(FOLD_WS_METHODS.fleetInvoke, {
  payload: FleetInvokeInput,
  success: Schema.Unknown,
  error: FleetRpcError,
});
const WsFleetEnvironmentsRpc = Rpc.make(FOLD_WS_METHODS.fleetEnvironments, {
  payload: Schema.Struct({}),
  success: FleetEnvironmentList,
  error: EnvironmentAuthorizationError,
});

const WsProviderRealtimeVoiceStartRpc = Rpc.make(FOLD_WS_METHODS.providerRealtimeVoiceStart, {
  payload: ProviderRealtimeVoiceStartInput,
  success: ProviderRealtimeVoiceStartResult,
  error: RealtimeVoiceRpcError,
});
const WsProviderRealtimeVoiceStopRpc = Rpc.make(FOLD_WS_METHODS.providerRealtimeVoiceStop, {
  payload: ProviderRealtimeVoiceStopInput,
  error: RealtimeVoiceRpcError,
});
const WsProviderRealtimeVoiceListRpc = Rpc.make(FOLD_WS_METHODS.providerRealtimeVoiceList, {
  payload: ProviderRealtimeVoiceStopInput,
  success: ProviderRealtimeVoiceListResult,
  error: RealtimeVoiceRpcError,
});
const WsProviderRealtimeVoiceContextRpc = Rpc.make(FOLD_WS_METHODS.providerRealtimeVoiceContext, {
  payload: ProviderRealtimeVoiceContextInput,
  error: RealtimeVoiceRpcError,
});
const WsProviderRealtimeVoiceEventsRpc = Rpc.make(FOLD_WS_METHODS.providerRealtimeVoiceEvents, {
  payload: ProviderRealtimeVoiceStopInput,
  success: ProviderRealtimeVoiceEvent,
  stream: true,
  error: RealtimeVoiceRpcError,
});

const FactoryRpcError = Schema.Union([FactoryError, EnvironmentAuthorizationError]);
const factorySubscribeBoardRpc = Rpc.make(FOLD_WS_METHODS.factorySubscribeBoard, {
  payload: Schema.Struct({}),
  success: FactoryBoard,
  error: FactoryRpcError,
  stream: true,
});
const factorySetEnabledRpc = Rpc.make(FOLD_WS_METHODS.factorySetEnabled, {
  payload: Schema.Struct({ enabled: Schema.Boolean }),
  success: FactoryStatus,
  error: FactoryRpcError,
});
const factoryEnsureCommanderRpc = Rpc.make(FOLD_WS_METHODS.factoryEnsureCommander, {
  payload: FactoryEnsureCommanderInput,
  success: FactoryAgent,
  error: FactoryRpcError,
});
const factoryAnswerCardRpc = Rpc.make(FOLD_WS_METHODS.factoryAnswerCard, {
  payload: FactoryAnswerInput,
  success: FactoryCard,
  error: FactoryRpcError,
});
const factoryWithdrawCardRpc = Rpc.make(FOLD_WS_METHODS.factoryWithdrawCard, {
  payload: Schema.Struct({ cardId: Schema.String }),
  success: FactoryCard,
  error: FactoryRpcError,
});
const factoryGetPayloadRpc = Rpc.make(FOLD_WS_METHODS.factoryGetPayload, {
  payload: Schema.Struct({ sha256: Schema.String }),
  success: FactoryPayload,
  error: FactoryRpcError,
});
const factorySetAgentLifecycleRpc = Rpc.make(FOLD_WS_METHODS.factorySetAgentLifecycle, {
  payload: FactoryLifecycleInput,
  success: FactoryAgent,
  error: FactoryRpcError,
});
const factoryUpsertTriggerRpc = Rpc.make(FOLD_WS_METHODS.factoryUpsertTrigger, {
  payload: FactoryTriggerInput,
  success: FactoryTrigger,
  error: FactoryRpcError,
});
const factoryRunTriggerRpc = Rpc.make(FOLD_WS_METHODS.factoryRunTrigger, {
  payload: Schema.Struct({ id: Schema.String }),
  success: FactoryTriggerRun,
  error: FactoryRpcError,
});
const factorySetTriggerShadowRpc = Rpc.make(FOLD_WS_METHODS.factorySetTriggerShadow, {
  payload: Schema.Struct({ id: Schema.String, shadow: Schema.Boolean }),
  success: FactoryTrigger,
  error: FactoryRpcError,
});
const factoryRetryWakeRpc = Rpc.make(FOLD_WS_METHODS.factoryRetryWake, {
  payload: FactoryWakeInput,
  success: Schema.Void,
  error: FactoryRpcError,
});
const factoryDeferWakeRpc = Rpc.make(FOLD_WS_METHODS.factoryDeferWake, {
  payload: FactoryWakeInput,
  success: Schema.Void,
  error: FactoryRpcError,
});
const factoryCancelLaneJobRpc = Rpc.make(FOLD_WS_METHODS.factoryCancelLaneJob, {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: FactoryRpcError,
});

export const FoldRpcGroup = RpcGroup.make(
  WsPitbossPeersRpc,
  WsPitbossPeerCommandRpc,
  WsPitbossSourcesRpc,
  WsPitbossSourceCommandRpc,
  WsPitbossReadRpc,
  WsPitbossSubscribeRpc,
  WsPitbossCommandRpc,
  factorySubscribeBoardRpc,
  factorySetEnabledRpc,
  factoryEnsureCommanderRpc,
  factoryAnswerCardRpc,
  factoryWithdrawCardRpc,
  factoryGetPayloadRpc,
  factorySetAgentLifecycleRpc,
  factoryUpsertTriggerRpc,
  factoryRunTriggerRpc,
  factorySetTriggerShadowRpc,
  factoryRetryWakeRpc,
  factoryDeferWakeRpc,
  factoryCancelLaneJobRpc,

  WsFleetConnectRpc,
  WsFleetRespondRpc,
  WsFleetExecuteRpc,
  WsFleetInvokeRpc,
  WsFleetEnvironmentsRpc,
  WsProviderRealtimeVoiceStartRpc,
  WsProviderRealtimeVoiceStopRpc,
  WsProviderRealtimeVoiceListRpc,
  WsProviderRealtimeVoiceContextRpc,
  WsProviderRealtimeVoiceEventsRpc,
);
