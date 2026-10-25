import {
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type FoldRpcGroup,
  WS_METHODS,
} from "@t3tools/contracts";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type FoldRpcMethod = RpcGroup.Rpcs<typeof FoldRpcGroup>["_tag"];

/** Scopes for Fold's RPCs, spread into RpcAuthorization's `RPC_REQUIRED_SCOPES`. */
export const FOLD_RPC_REQUIRED_SCOPES = {
  [WS_METHODS.pitbossPeers]: AuthOrchestrationReadScope,
  [WS_METHODS.pitbossPeerCommand]: AuthAccessWriteScope,
  [WS_METHODS.pitbossSources]: AuthOrchestrationReadScope,
  [WS_METHODS.pitbossSourceCommand]: AuthAccessWriteScope,
  [WS_METHODS.pitbossRead]: AuthOrchestrationReadScope,
  [WS_METHODS.pitbossSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.pitbossCommand]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerRealtimeVoiceStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerRealtimeVoiceStop]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerRealtimeVoiceList]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerRealtimeVoiceContext]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerRealtimeVoiceEvents]: AuthOrchestrationOperateScope,
  [WS_METHODS.fleetConnect]: AuthOrchestrationOperateScope,
  [WS_METHODS.fleetRespond]: AuthOrchestrationOperateScope,
  [WS_METHODS.fleetExecute]: AuthOrchestrationOperateScope,
  [WS_METHODS.fleetInvoke]: AuthOrchestrationOperateScope,
  [WS_METHODS.fleetEnvironments]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<FoldRpcMethod, AuthEnvironmentScope>>;

/** `rpc.aggregate` labels for Fold's RPCs, spread into RpcInstrumentation's `RPC_AGGREGATES`. */
export const FOLD_RPC_AGGREGATES = {
  [WS_METHODS.pitbossPeers]: "pitboss",
  [WS_METHODS.pitbossPeerCommand]: "pitboss",
  [WS_METHODS.pitbossSources]: "pitboss",
  [WS_METHODS.pitbossSourceCommand]: "pitboss",
  [WS_METHODS.pitbossRead]: "pitboss",
  [WS_METHODS.pitbossSubscribe]: "pitboss",
  [WS_METHODS.pitbossCommand]: "pitboss",
  [WS_METHODS.fleetConnect]: "fleet",
  [WS_METHODS.fleetRespond]: "fleet",
  [WS_METHODS.fleetExecute]: "fleet",
  [WS_METHODS.fleetInvoke]: "fleet",
  [WS_METHODS.fleetEnvironments]: "fleet",
  [WS_METHODS.providerRealtimeVoiceStart]: "provider",
  [WS_METHODS.providerRealtimeVoiceStop]: "provider",
  [WS_METHODS.providerRealtimeVoiceList]: "provider",
  [WS_METHODS.providerRealtimeVoiceContext]: "provider",
  [WS_METHODS.providerRealtimeVoiceEvents]: "provider",
} as const satisfies Readonly<Record<FoldRpcMethod, string>>;
