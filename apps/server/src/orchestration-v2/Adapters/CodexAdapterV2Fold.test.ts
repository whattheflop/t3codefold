import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CodexSettings,
  EnvironmentId,
  type ModelSelection,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../../config.ts";
import * as CodexAdapterV2 from "./CodexAdapterV2.ts";
import { codexPermissionApprovalPrompt } from "./CodexAdapterV2Fold.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const CODEX_TEST_MODEL_SELECTION = {
  instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
  model: "gpt-5.4",
} satisfies ModelSelection;
const CODEX_TEST_RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

describe("CodexAdapterV2 permission approvals", () => {
  it("prefers a nonblank reason, else names the requested paths", () => {
    const permissions = {
      fileSystem: { read: ["/workspace/notes.md"], write: ["/workspace/out"] },
    };
    assert.equal(
      codexPermissionApprovalPrompt({ reason: " Read notes. ", permissions }),
      "Read notes.",
    );
    assert.equal(
      codexPermissionApprovalPrompt({ reason: null, permissions }),
      "Access: /workspace/notes.md, /workspace/out",
    );
    assert.isUndefined(codexPermissionApprovalPrompt({ reason: " ", permissions: {} }));
  });
});

describe("CodexAdapterV2 process spawning", () => {
  it.effect("gives the app-server the thread's t3 work credential", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-work-env");
      const spawnedEnv: Array<Record<string, string | undefined> | undefined> = [];
      const spawner = ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) spawnedEnv.push(command.options.env);
        return Effect.fail(
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        );
      });
      const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
      yield* mcpSessions.set({
        environmentId: EnvironmentId.make("environment-work-env"),
        threadId,
        providerSessionId: "mcp-session-work-env",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1:43123/mcp",
        authorizationHeader: "Bearer work-token",
        browserToolsAvailable: false,
      });
      const adapter = yield* CodexAdapterV2.createCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        displayName: undefined,
        environment: [{ name: "CUSTOM", value: "1", sensitive: false }],
        enabled: true,
        config: DEFAULT_CODEX_SETTINGS,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            CodexAdapterV2.layerAppServerClientFactory,
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-codex-work-env-" }),
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(
          ProviderEventLoggers.ProviderEventLoggers,
          ProviderEventLoggers.NoOpProviderEventLoggers,
        ),
      );

      yield* adapter
        .openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-work-env"),
          modelSelection: CODEX_TEST_MODEL_SELECTION,
          runtimePolicy: CODEX_TEST_RUNTIME_POLICY,
        })
        .pipe(Effect.scoped, Effect.exit);

      assert.equal(spawnedEnv[0]?.CUSTOM, "1");
      assert.equal(spawnedEnv[0]?.T3_WORK_ENDPOINT, "http://127.0.0.1:43123/mcp");
      assert.equal(spawnedEnv[0]?.T3_WORK_AUTHORIZATION, "Bearer work-token");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
      Effect.provideService(HostProcess.Platform, "linux"),
    ),
  );
});
