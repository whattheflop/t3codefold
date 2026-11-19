import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { EnvironmentId, ProjectId, FleetInvokeInput } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Command } from "effect/cli";
import { describe, expect } from "vite-plus/test";
import {
  FleetCliError,
  invokeFleetCommand,
  makeFleetCommand,
  readFleetPrompt,
  resolveFleetSelector,
  type FleetCliClient,
} from "./fleet.ts";

const encodeInvoke = Schema.encodeEffect(Schema.toCodecJson(FleetInvokeInput));

const local = EnvironmentId.make("laptop");
const remote = EnvironmentId.make("server");
const projectId = ProjectId.make("repo-id");
function fixture() {
  const calls: FleetInvokeInput[] = [];
  const client: FleetCliClient = {
    environments: () =>
      Effect.succeed({
        environments: [
          { environmentId: local, label: "Work" },
          { environmentId: remote, label: "Home" },
        ],
      }),
    invoke: (input) =>
      Effect.gen(function* () {
        yield* encodeInvoke(input);
        calls.push(input);
        return yield* Effect.succeed(
          input.operation === "t3_project_list"
            ? {
                projects: [{ id: projectId, title: "Repo", workspaceRoot: "/srv/repo" }],
                nextCursor: null,
              }
            : { accepted: true },
        );
      }),
  };
  const command = makeFleetCommand((_flags, run) => run(client).pipe(Effect.as(undefined)));
  const run = (args: string[]) =>
    Command.runWith(command, { version: "0.0.0" })(args).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer)),
    );
  return { calls, client, run };
}

describe("fleet CLI", () => {
  it.effect(
    "starts through t3_thread_launch on the connected environment and its project, preserving retry id and long text",
    () =>
      Effect.gen(function* () {
        const f = fixture();
        yield* f.run([
          "start",
          "--environment",
          "Home",
          "--project",
          "/srv/repo",
          "--prompt",
          "Continue this work\nwith these constraints",
          "--client-request-id",
          "stable-handoff",
          "--provider",
          "claude",
          "--model",
          "sonnet",
        ]);
        expect(f.calls).toEqual([
          {
            environmentId: remote,
            operation: "t3_project_list",
            input: { cursor: 0, limit: 100 },
          },
          {
            environmentId: remote,
            operation: "t3_thread_launch",
            input: {
              projectId,
              title: "New thread",
              message: "Continue this work\nwith these constraints",
              clientRequestId: "stable-handoff",
              modelSelection: { instanceId: "claude", model: "sonnet" },
            },
          },
        ]);
      }),
  );
  it.effect("defaults to the local host and lets thread operations omit project", () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.run([
        "send",
        "--thread",
        "thread-a",
        "--message",
        "continue",
        "--mode",
        "queue",
        "--client-request-id",
        "send-1",
      ]);
      expect(f.calls).toEqual([
        {
          environmentId: undefined,
          operation: "t3_thread_send",
          input: {
            threadId: "thread-a",
            message: "continue",
            mode: "queue",
            clientRequestId: "send-1",
          },
        },
      ]);
    }),
  );
  it.effect("retains read pagination and wait run selection", () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.run([
        "read",
        "--environment",
        "server",
        "--thread",
        "thread-a",
        "--view",
        "activity",
        "--after-position",
        "42",
        "--limit",
        "10",
      ]);
      yield* f.run(["wait", "--thread", "thread-a", "--run", "run-a", "--timeout-ms", "30000"]);
      expect(f.calls[0]?.input).toEqual({
        threadId: "thread-a",
        view: "activity",
        afterPosition: 42,
        limit: 10,
      });
      expect(f.calls[1]?.input).toEqual({ threadId: "thread-a", runId: "run-a", timeoutMs: 30000 });
    }),
  );
  it.effect("never invokes an unavailable environment", () =>
    Effect.gen(function* () {
      const f = fixture();
      const result = yield* Effect.result(
        invokeFleetCommand(f.client, {
          environment: "offline",
          operation: "t3_thread_list",
          input: {},
        }),
      );
      expect(result._tag).toBe("Failure");
      expect(f.calls).toEqual([]);
    }),
  );
  it("rejects ambiguous labels while exact ids still win", () => {
    const items = [
      { id: "one", name: "Home" },
      { id: "two", name: "Home" },
    ];
    expect(() =>
      resolveFleetSelector(
        items,
        "Home",
        "environment",
        (x) => x.id,
        (x) => [x.name],
      ),
    ).toThrow("Ambiguous environment");
    expect(
      resolveFleetSelector(
        items,
        "two",
        "environment",
        (x) => x.id,
        (x) => [x.name],
      ),
    ).toEqual(items[1]);
  });
  it.effect("requires one nonempty prompt source", () =>
    Effect.gen(function* () {
      for (const flags of [
        {
          prompt: Option.none<string>(),
          message: Option.none<string>(),
          file: Option.none<string>(),
        },
        { prompt: Option.some("a"), message: Option.some("b"), file: Option.none<string>() },
        { prompt: Option.some("  "), message: Option.none<string>(), file: Option.none<string>() },
      ]) {
        const result = yield* Effect.result(readFleetPrompt(flags));
        expect(result._tag).toBe("Failure");
      }
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))),
  );
  it.effect("propagates target operation errors instead of claiming success", () =>
    Effect.gen(function* () {
      const f = fixture();
      const client = {
        ...f.client,
        invoke: () => Effect.fail(new FleetCliError({ message: "Target disconnected" })),
      };
      const result = yield* Effect.result(
        invokeFleetCommand(client, {
          environment: "Home",
          operation: "t3_thread_read",
          input: { threadId: "thread-a" },
        }),
      );
      expect(result._tag === "Failure" && result.failure.message).toBe("Target disconnected");
    }),
  );
  it.effect("loads an intact multiline handoff from a file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const text = "# Handoff\n\nBranch: task-a\nPlease continue.\n";
      yield* fs.writeFileString(`${dir}/handoff.md`, text);
      const f = fixture();
      yield* f.run(["start", "--project", "Repo", "--file", `${dir}/handoff.md`]);
      expect(f.calls[1]?.input).toMatchObject({ projectId, message: text });
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );
  it.effect(
    "fails clearly before opening credentials when no server has published runtime state",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const result = yield* Effect.result(
          Command.runWith(makeFleetCommand(), { version: "0.0.0" })([
            "environments",
            "--base-dir",
            dir,
          ]),
        );
        expect(result._tag === "Failure" && result.failure.message).toContain(
          "No running T3 server",
        );
      }).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer)),
      ),
  );
  it.effect("does not select arbitrarily between duplicate project titles", () =>
    Effect.gen(function* () {
      const f = fixture();
      const client: FleetCliClient = {
        ...f.client,
        invoke: (input) => {
          f.calls.push(input);
          return Effect.succeed({
            projects: [
              { id: projectId, title: "Repo", workspaceRoot: "/one" },
              { id: ProjectId.make("second"), title: "Repo", workspaceRoot: "/two" },
            ],
            nextCursor: null,
          });
        },
      };
      const result = yield* Effect.result(
        invokeFleetCommand(client, {
          environment: "Home",
          project: "Repo",
          operation: "t3_thread_launch",
          input: { title: "New thread", message: "continue" },
        }),
      );
      expect(result._tag === "Failure" && result.failure.message).toContain("Ambiguous project");
      expect(f.calls).toHaveLength(1);
    }),
  );
  it.effect("resolves a project from any page of the project list", () =>
    Effect.gen(function* () {
      const f = fixture();
      const later = ProjectId.make("later");
      const client: FleetCliClient = {
        ...f.client,
        invoke: (input) => {
          f.calls.push(input);
          if (input.operation !== "t3_project_list") return Effect.succeed({ accepted: true });
          const first = (input.input as { cursor: number }).cursor === 0;
          return Effect.succeed(
            first
              ? {
                  projects: [{ id: projectId, title: "Repo", workspaceRoot: "/one" }],
                  nextCursor: 1,
                }
              : {
                  projects: [{ id: later, title: "Later", workspaceRoot: "/two" }],
                  nextCursor: null,
                },
          );
        },
      };
      yield* invokeFleetCommand(client, {
        project: "Later",
        operation: "t3_thread_list",
        input: {},
      });
      expect(f.calls.map((call) => call.input)).toEqual([
        { cursor: 0, limit: 100 },
        { cursor: 1, limit: 100 },
        { projectId: later },
      ]);
    }),
  );
  it.effect("requires --provider and --model together", () =>
    Effect.gen(function* () {
      const f = fixture();
      const result = yield* Effect.result(
        f.run(["start", "--project", "Repo", "--prompt", "go", "--model", "sonnet"]),
      );
      expect(result._tag).toBe("Failure");
      expect(f.calls).toEqual([]);
    }),
  );
});
