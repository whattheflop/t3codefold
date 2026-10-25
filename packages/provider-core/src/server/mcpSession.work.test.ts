import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { providerSessionEnvironment, workCliEnvironment } from "./mcpSession.ts";

describe("work CLI environment", () => {
  it("gives the session's thread its work credential, without the device shim", () => {
    const session = {
      threadId: ThreadId.make("work-environment-test"),
      environmentId: EnvironmentId.make("fixture-env"),
      providerSessionId: "fixture-session",
      providerInstanceId: ProviderInstanceId.make("codex"),
      endpoint: "http://localhost:9000/mcp",
      authorizationHeader: "Bearer fixture-work",
      browserToolsAvailable: false,
      capabilities: new Set(["device", "orchestration"]),
      agentDeviceEnvironment: {
        PATH: "/device/bin",
        AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
      },
    };
    expect(
      providerSessionEnvironment({ PATH: "/usr/bin", PROVIDER_KEY: "fixture" }, session),
    ).toEqual({
      PATH: "/usr/bin",
      PROVIDER_KEY: "fixture",
      T3_WORK_ENDPOINT: "http://localhost:9000/mcp",
      T3_WORK_AUTHORIZATION: "Bearer fixture-work",
    });
    const unrelated = { PATH: "/usr/bin" };
    expect(providerSessionEnvironment(unrelated, undefined)).toBe(unrelated);
    expect(workCliEnvironment(undefined)).toEqual({});
  });
});
