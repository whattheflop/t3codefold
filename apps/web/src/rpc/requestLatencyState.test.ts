import { WS_METHODS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { acknowledgeRpcRequest, trackRpcRequestSent } from "./requestLatencyState";

it("does not arm a slow-request warning for the long-lived fleet connection", () => {
  using timeout = vi.spyOn(globalThis, "setTimeout");
  trackRpcRequestSent("fold-fleet", WS_METHODS.fleetConnect);
  expect(timeout).not.toHaveBeenCalled();
  trackRpcRequestSent("fold-unary", WS_METHODS.serverGetConfig);
  expect(timeout).toHaveBeenCalledOnce();
  acknowledgeRpcRequest("fold-unary");
});
