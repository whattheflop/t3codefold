// @effect-diagnostics nodeBuiltinImport:off - The fixture is a real isolated Core-compatible socket.
import * as NodeNet from "node:net";
import * as NodeFSP from "node:fs/promises";
import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { DesktopHerdrAttachEvent } from "@t3tools/contracts";
import { DesktopHerdr, layer, herdrSshArgs } from "./DesktopHerdr.ts";
import { encodeFrame, FRAME } from "./HerdrAttach.ts";

const list = (socketPath: string) =>
  Effect.gen(function* () {
    const core = yield* DesktopHerdr;
    return yield* core.request({
      socketPath,
      expectedCoreId: "test",
      method: "terminal.list",
      params: { all: true },
    });
  });

/** A Core-compatible socket that replies in split chunks and can drop a connection. */
const withCore = <A, E>(
  body: (fixture: {
    readonly socketPath: string;
    readonly requests: Array<{ id: number; method: string }>;
    readonly connections: () => number;
    readonly dropConnections: () => Effect.Effect<void>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() => NodeFSP.mkdtemp("/tmp/t3-hc-"));
    const socketPath = `${dir}/core.sock`;
    const sockets = new Set<NodeNet.Socket>();
    const requests: Array<{ id: number; method: string }> = [];
    let connections = 0;
    const server = NodeNet.createServer((socket) => {
      connections++;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let input = "";
      socket.on("data", (bytes) => {
        input += bytes.toString();
        for (let end = input.indexOf("\n"); end >= 0; end = input.indexOf("\n")) {
          const request = JSON.parse(input.slice(0, end)) as { id: number; method: string };
          input = input.slice(end + 1);
          requests.push({ id: request.id, method: request.method });
          const response = JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result:
              request.method === "hello"
                ? { generation: 1, core: { id: "test" } }
                : { terminals: [] },
          });
          socket.write(response.slice(0, 8));
          socket.write(`${response.slice(8)}\n`);
        }
      });
    });
    try {
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, resolve);
          }),
      );
      return yield* body({
        socketPath,
        requests,
        connections: () => connections,
        dropConnections: () =>
          Effect.promise(() =>
            Promise.all(
              [...sockets].map(
                (socket) =>
                  new Promise<void>((resolve) => {
                    socket.once("close", () => resolve());
                    socket.destroy();
                  }),
              ),
            ).then(() => undefined),
          ),
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      yield* Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())));
      yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
    }
  });

describe("desktop native Core transport", () => {
  it.live("reuses one verified connection for split replies without launching Core", () =>
    withCore(({ socketPath, requests, connections }) =>
      Effect.gen(function* () {
        expect(yield* list(socketPath)).toEqual({ terminals: [] });
        expect(yield* list(socketPath)).toEqual({ terminals: [] });
        expect(connections()).toBe(1);
        expect(requests.map((request) => request.method)).toEqual([
          "hello",
          "terminal.list",
          "terminal.list",
        ]);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.live("reconnects, re-verifies Core and answers the read after the connection drops", () =>
    withCore(({ socketPath, requests, connections, dropConnections }) =>
      Effect.gen(function* () {
        expect(yield* list(socketPath)).toEqual({ terminals: [] });
        yield* dropConnections();
        expect(yield* list(socketPath)).toEqual({ terminals: [] });
        expect(connections()).toBe(2);
        expect(requests.map((request) => request.method)).toEqual([
          "hello",
          "terminal.list",
          "hello",
          "terminal.list",
        ]);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.live("attaches like hc attach: frames before the reply, credit, input and Core's close", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => NodeFSP.mkdtemp("/tmp/t3-ha-"));
      const socketPath = `${dir}/core.sock`;
      const received: Array<{ kind: number; payload: Buffer }> = [];
      const ready = Promise.withResolvers<NodeNet.Socket>();
      const typed = Promise.withResolvers<void>();
      let attachParams: Record<string, unknown> = {};
      const sockets = new Set<NodeNet.Socket>();
      const server = NodeNet.createServer((socket) => {
        sockets.add(socket);
        let input = Buffer.alloc(0);
        let framed = false;
        socket.on("data", (bytes) => {
          input = Buffer.concat([input, bytes]);
          if (!framed) {
            const end = input.indexOf(0x0a);
            if (end < 0) return;
            input = input.subarray(end + 1);
            framed = true;
            socket.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: 0, result: { generation: 1, core: { id: "test" } } })}\n`,
            );
          }
          while (input.length >= 9 && input.length >= 9 + input.readUInt32LE(5)) {
            const kind = input[4]!;
            const payload = input.subarray(9, 9 + input.readUInt32LE(5));
            input = input.subarray(9 + payload.length);
            received.push({ kind, payload });
            if (received.length === 5) typed.resolve();
            if (kind === FRAME.data && input.length === 0 && received.length === 1) {
              attachParams = JSON.parse(payload.toString()).params;
              // The first paint can beat the reply that names its channel; both arrive split.
              const paint = encodeFrame(5, FRAME.data, Buffer.from("\u001b[1mhi\u001b[0m"));
              const reply = encodeFrame(
                0,
                FRAME.data,
                Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { channel: 5 } })),
              );
              const both = Buffer.concat([paint, reply]);
              socket.write(both.subarray(0, 4));
              socket.write(both.subarray(4));
              ready.resolve(socket);
            }
          }
        });
      });
      try {
        yield* Effect.promise(
          () => new Promise<void>((resolve) => server.listen(socketPath, resolve)),
        );
        const events: DesktopHerdrAttachEvent[] = [];
        const closed = Promise.withResolvers<void>();
        const core = yield* DesktopHerdr;
        yield* core.attachOpen(
          {
            streamId: "s1",
            expectedCoreId: "test",
            socketPath,
            terminal: "t3",
            observe: false,
            cols: 100,
            rows: 30,
            display: { bg: "#0e1218" },
          },
          1,
          (event) => {
            events.push(event);
            if (event.type === "close") closed.resolve();
          },
        );
        expect(attachParams).toMatchObject({ terminal: "t3", observe: false, cols: 100, rows: 30 });
        core.attachInput({ streamId: "s1", type: "data", data: "q" });
        core.attachInput({ streamId: "s1", type: "data", data: "\xff", encoding: "binary" });
        core.attachInput({ streamId: "s1", type: "resize", cols: 80, rows: 24 });
        const socket = yield* Effect.promise(() => ready.promise);
        yield* Effect.promise(() => typed.promise);
        expect(received.slice(1).map(({ kind, payload }) => [kind, [...payload]])).toEqual([
          [FRAME.credit, [10, 0, 0, 0]],
          [FRAME.data, [...Buffer.from("q")]],
          [FRAME.data, [255]],
          [FRAME.resize, [80, 0, 24, 0]],
        ]);
        socket.write(
          encodeFrame(5, FRAME.close, Buffer.from(JSON.stringify({ reason: "exited" }))),
        );
        yield* Effect.promise(() => closed.promise);
        expect(
          events.map((event) =>
            event.type === "data" ? Buffer.from(event.data).toString() : event,
          ),
        ).toEqual(["\u001b[1mhi\u001b[0m", { streamId: "s1", type: "close", reason: "exited" }]);
      } finally {
        for (const socket of sockets) socket.destroy();
        yield* Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())));
        yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(layer)),
  );
  it("keeps SSH hosts out of options and quotes the remote socket as data", () => {
    expect(() => herdrSshArgs("-oProxyCommand=bad", "/socket")).toThrow();
    const args = herdrSshArgs("factory-host", "/path/it's a socket");
    expect(args.slice(-3, -1)).toEqual(["--", "factory-host"]);
    expect(
      args.slice(0, -3).every((arg) => arg === "-T" || arg === "-o" || arg.includes("=")),
    ).toBe(true);
    expect(args.at(-1)).toContain("'\\''");
    expect(args.at(-1)).not.toContain("hc connect");
  });
});
