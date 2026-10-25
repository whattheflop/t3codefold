import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";

describe("Fold RPC authorization scopes", () => {
  it("requires permission to operate on a thread for realtime voice", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.providerRealtimeVoiceStart)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.providerRealtimeVoiceStop)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("requires access-write for pitboss peer and source credentials", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.pitbossRead)).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.pitbossCommand)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.pitbossPeerCommand)).toBe(AuthAccessWriteScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.pitbossSourceCommand)).toBe(AuthAccessWriteScope);
  });
});
