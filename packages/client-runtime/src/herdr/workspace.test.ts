import { describe, expect, it } from "vite-plus/test";
import { HerdrWorkspace } from "./workspace.ts";
import { CoreDeliveryUnknown, type CoreTransport } from "./client.ts";
import { readHerdrDestinations, validateHerdrTarget } from "./destinations.ts";
import { appendTranscript } from "./transcript.ts";

const destination = {
  id: "one",
  label: "One",
  socketPath: "/run/user/1000/herdr-core/factory.sock",
  coreId: "core-one",
  readOnly: false,
  pins: [],
};
const methods = [
  "terminal.list",
  "terminal.get",
  "terminal.send",
  "terminal.interrupt",
  "doc.get",
  "file.read",
  "machine.exec",
];
function fixture(override?: CoreTransport) {
  const requests: string[] = [];
  const workspace = new HerdrWorkspace();
  const request: CoreTransport = async (method, params) => {
    requests.push(method);
    const result = await override?.(method, params);
    if (result !== undefined) return result;
    if (method === "hello")
      return { generation: 1, core: { id: "core-one", name: "Core" }, methods, features: [] };
    if (method === "terminal.list")
      return {
        terminals: [
          {
            address: "t7",
            name: "coding",
            cwd: "/work",
            state: "live",
            labels: {},
            foreground: { name: "codex", cwd: "/work" },
            status: { state: "idle", app: "codex" },
          },
        ],
      };
    if (method === "doc.get") return { value: null, version: 0 };
    if (method === "terminal.send") return { turn: 4, started: true };
    return {};
  };
  return {
    workspace,
    requests,
    connect: (readOnly = false) => workspace.connect({ ...destination, readOnly }, request),
  };
}

describe("unmodified native Core", () => {
  it("adopts plain Core using only existing methods and refuses control for read-only connections", async () => {
    const f = fixture();
    try {
      expect(await f.connect(true)).toBe("core-one");
      const agent = f.workspace.getSnapshot().agents[0]!;
      expect(agent.id).toBe("t7");
      expect(agent.role).toBeNull();
      await f.workspace.select(agent);
      expect(f.workspace.getSnapshot().history).toBe("unavailable");
      expect(f.workspace.canSend()).toBe(false);
      await expect(f.workspace.send("hello", "command")).rejects.toThrow("unavailable");
      expect(f.requests).toEqual(["hello", "doc.get", "terminal.list"]);
    } finally {
      f.workspace.close();
    }
  });
  it("keeps unknown prompt delivery unresolved instead of retrying", async () => {
    const f = fixture(async (method) => {
      if (method === "terminal.send") throw new Error("connection lost");
      return undefined;
    });
    try {
      await f.connect();
      await f.workspace.select(f.workspace.getSnapshot().agents[0]!);
      await expect(f.workspace.send("hello", "command")).rejects.toBeInstanceOf(
        CoreDeliveryUnknown,
      );
      expect(f.workspace.getSnapshot().receipt).toEqual({ commandId: "command", state: "unknown" });
      expect(f.workspace.canSend()).toBe(false);
      await expect(f.workspace.reconcile()).rejects.toThrow("no durable send receipts");
      expect(f.requests.filter((method) => method === "terminal.send")).toHaveLength(1);
      f.workspace.acknowledgeUnknownDelivery();
      expect(f.workspace.canSend()).toBe(true);
      expect(f.requests.filter((method) => method === "terminal.send")).toHaveLength(1);
    } finally {
      f.workspace.close();
    }
  });
  it("rejects a different authority before querying documents or fleet", async () => {
    const f = fixture(async (method) =>
      method === "hello"
        ? { generation: 1, core: { id: "other", name: "Other" }, methods, features: [] }
        : undefined,
    );
    try {
      expect(await f.connect()).toBeNull();
      expect(f.requests).toEqual(["hello"]);
    } finally {
      f.workspace.close();
    }
  });
  it("loads explicitly bound structured history through file.read without terminal scraping", async () => {
    const row = JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello" }],
      },
    });
    const f = fixture(async (method, params) => {
      if (method !== "file.read") return undefined;
      if (Number(params.offset) > 1) throw new Error("Core rejects offsets beyond EOF");
      return { first: 1, last: 1, lines: 1, text: `${row}\n` };
    });
    try {
      await f.connect();
      await f.workspace.select(f.workspace.getSnapshot().agents[0]!);
      await f.workspace.bindTranscript("/sessions/one.jsonl", "codex");
      expect(f.workspace.getSnapshot().items[0]?.parts[0]?.text).toBe("Hello");
      expect(f.requests).not.toContain("terminal.read");
      await expect(f.workspace.syncHistory()).resolves.toBeUndefined();
      expect(f.workspace.getSnapshot().items).toHaveLength(1);
    } finally {
      f.workspace.close();
    }
  });
  it("discovers herd-labelled provider transcripts in one exec and links parents by name", async () => {
    const execs: unknown[] = [];
    const row = JSON.stringify({ message: { role: "assistant", content: "Ready" } });
    const terminal = (address: string, name: string, session: string, parent?: string) => ({
      address,
      name: null,
      cwd: "/work",
      state: "live",
      labels: {
        "herd.name": name,
        "herd.session": session,
        ...(parent ? { "herd.token.parent": parent } : {}),
      },
      foreground: { name: "claude", cwd: "/work" },
    });
    const f = fixture(async (method, params) => {
      if (method === "terminal.list")
        return {
          terminals: [
            terminal("t1", "commander", "aaaaaaaa-0001"),
            terminal("t2", "worker", "bbbbbbbb-0002", "commander"),
            terminal("t3", "bad", "../../etc"),
          ],
        };
      if (method === "machine.exec") {
        execs.push(JSON.parse(atob(String(params.input))));
        return {
          stdout: btoa(
            JSON.stringify({ "aaaaaaaa-0001": "/h/.claude/projects/w/aaaaaaaa-0001.jsonl" }),
          ),
          code: 0,
          timed_out: false,
          truncated: false,
        };
      }
      if (method === "file.read") return { first: 1, last: 1, lines: 1, text: `${row}\n` };
      return undefined;
    });
    try {
      await f.connect(true);
      const [commander, worker] = f.workspace.getSnapshot().agents;
      expect(execs).toEqual([
        [
          { id: "aaaaaaaa-0001", provider: "claude" },
          { id: "bbbbbbbb-0002", provider: "claude" },
        ],
      ]);
      expect(worker).toMatchObject({ label: "worker", parentId: "t1", conversationId: null });
      expect(commander?.conversationId).toBe("t1");
      await f.workspace.select(commander!);
      expect(f.workspace.getSnapshot().items[0]?.parts[0]?.text).toBe("Ready");
      await f.workspace.refresh();
      expect(execs).toHaveLength(1);
    } finally {
      f.workspace.close();
    }
  });
  it("supports custom modules and metadata without hard-coding Tom’s names", async () => {
    const f = fixture(async (method) =>
      method === "doc.get"
        ? {
            version: 1,
            value: {
              modules: [
                {
                  id: "other.tasks",
                  label: "Tasks",
                  schemaVersion: 1,
                  baseUrl: "http://127.0.0.1:9876",
                  resources: [
                    {
                      kind: "ticket",
                      label: "Tickets",
                      fields: ["title"],
                      path: "/tickets",
                      resultKey: "tickets",
                    },
                  ],
                  actions: [],
                },
                { id: "future", schemaVersion: 9 },
              ],
            },
          }
        : undefined,
    );
    try {
      await f.connect();
      expect(f.workspace.getSnapshot().modules.map((module) => module.id)).toEqual(["other.tasks"]);
      expect(f.workspace.getSnapshot().unsupportedModules).toBe(1);
    } finally {
      f.workspace.close();
    }
  });
});

describe("provider transcript normalization", () => {
  it("attributes relayed peer messages even after Claude's lead-in sentence", () => {
    const [item] = appendTranscript([], "session", "claude", [
      {
        line: 1,
        value: {
          message: {
            role: "user",
            content:
              'Another Claude session sent a message:\n<cross-session-message from="factory:decision">go</cross-session-message>',
          },
        },
      },
    ]);
    expect(item?.source).toBe("peer agent");
  });
  it("correlates Claude tool results and keeps multi-block message order", () => {
    const result = appendTranscript([], "session", "claude", [
      {
        line: 1,
        value: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Checking" },
              { type: "tool_use", id: "call", name: "Read", input: { path: "a.ts" } },
            ],
          },
        },
      },
      {
        line: 2,
        value: {
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call", content: "file body" }],
          },
        },
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.parts[0]?.text).toBe("Checking");
    expect(result[1]?.parts[0]).toMatchObject({
      callId: "call",
      state: "done",
      output: "file body",
    });
  });
  it("uses Codex response records once and links function outputs by call ID", () => {
    const result = appendTranscript([], "session", "codex", [
      {
        line: 1,
        value: { type: "event_msg", payload: { type: "agent_message", message: "Checking" } },
      },
      {
        line: 2,
        value: {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Checking" }],
          },
        },
      },
      {
        line: 3,
        value: {
          type: "response_item",
          payload: { type: "function_call", call_id: "call", name: "exec", arguments: "{}" },
        },
      },
      {
        line: 4,
        value: {
          type: "response_item",
          payload: { type: "function_call_output", call_id: "call", output: "ok" },
        },
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1]?.parts[0]).toMatchObject({ callId: "call", output: "ok", state: "done" });
  });
});

it("restores only valid native destinations and rejects SSH option injection", () => {
  expect(
    readHerdrDestinations(JSON.stringify([destination])).map((entry) => entry.socketPath),
  ).toEqual([destination.socketPath]);
  expect(() => validateHerdrTarget("relative.sock")).toThrow();
  expect(() => validateHerdrTarget("/socket", "-oProxyCommand=bad")).toThrow();
});
