// @effect-diagnostics globalTimers:off - The open deadline times a raw socket handshake outside an Effect runtime.
import type {
  DesktopHerdrAttachEvent,
  DesktopHerdrAttachInput,
  DesktopHerdrAttachOpen,
} from "@t3tools/contracts";

import { openCorePipe } from "./CorePipe.ts";

// Core's framed mode: `[channel u32 LE][kind u8][len u32 LE][payload]`, channel 0 is JSON-RPC.
const HEADER = 9;
const MAX_PAYLOAD = 16 << 20;
const OPEN_TIMEOUT_MS = 20_000;
export const FRAME = { data: 0, credit: 1, close: 2, resize: 3, focus: 4 } as const;

export function encodeFrame(channel: number, kind: number, payload: Uint8Array) {
  const frame = Buffer.alloc(HEADER + payload.length);
  frame.writeUInt32LE(channel, 0);
  frame[4] = kind;
  frame.writeUInt32LE(payload.length, 5);
  frame.set(payload, HEADER);
  return frame;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const coreError = (message: Record<string, unknown> | null) => {
  const error = object(message?.error);
  return typeof error?.message === "string" ? error.message : null;
};

/**
 * One viewer on a Core terminal, like `hc attach`: its own framed connection, raw bytes both ways.
 * Output is credited as soon as it is handed to the renderer, which keeps Core's window open.
 */
export class HerdrAttachStream {
  readonly opened: Promise<void>;
  private phase: "hello" | "attaching" | "open" | "closed" = "hello";
  private channel = 0;
  private buffered: Buffer = Buffer.alloc(0);
  private early: Array<readonly [number, number, Buffer]> = [];
  private settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readonly pipe: ReturnType<typeof openCorePipe>;
  private readonly deadline: ReturnType<typeof setTimeout>;

  private readonly request: DesktopHerdrAttachOpen;
  private readonly emit: (event: DesktopHerdrAttachEvent) => void;
  private readonly onClosed: () => void;

  constructor(
    request: DesktopHerdrAttachOpen,
    emit: (event: DesktopHerdrAttachEvent) => void,
    onClosed: () => void,
  ) {
    this.request = request;
    this.emit = emit;
    this.onClosed = onClosed;
    this.opened = new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    this.deadline = setTimeout(
      () => this.close("Core did not open the terminal in time."),
      OPEN_TIMEOUT_MS,
    );
    this.pipe = openCorePipe(request, (error) => this.close(error.message));
    this.pipe.output.on("data", (chunk: Buffer) => this.receive(chunk));
    this.pipe.writer.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "hello", params: { generation: 1, framed: true } })}\n`,
    );
  }

  input(input: DesktopHerdrAttachInput) {
    if (this.phase !== "open") return;
    switch (input.type) {
      case "data":
        this.send(
          FRAME.data,
          Buffer.from(input.data, input.encoding === "binary" ? "latin1" : "utf8"),
        );
        return;
      case "resize": {
        const size = Buffer.alloc(4);
        size.writeUInt16LE(Math.max(1, Math.min(input.cols, 0xffff)), 0);
        size.writeUInt16LE(Math.max(1, Math.min(input.rows, 0xffff)), 2);
        this.send(FRAME.resize, size);
        return;
      }
      case "focus":
        this.send(FRAME.focus, Buffer.from([input.focused ? 1 : 0]));
        return;
      case "close":
        this.send(FRAME.close, Buffer.alloc(0));
        this.close("detached");
    }
  }

  close(reason: string) {
    if (this.phase === "closed") return;
    const opening = this.phase !== "open";
    this.phase = "closed";
    clearTimeout(this.deadline);
    this.pipe.dispose();
    if (opening) this.settle?.reject(new Error(reason));
    else this.emit({ streamId: this.request.streamId, type: "close", reason });
    this.settle = null;
    this.onClosed();
  }

  private send(kind: number, payload: Uint8Array) {
    this.pipe.writer.write(encodeFrame(this.channel, kind, payload));
  }

  private receive(chunk: Buffer) {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk;
    if (this.phase === "hello") {
      const end = this.buffered.indexOf(0x0a);
      if (end < 0) {
        if (this.buffered.length > 1 << 20) this.close("Core returned invalid data.");
        return;
      }
      const line = this.buffered.subarray(0, end).toString("utf8");
      this.buffered = this.buffered.subarray(end + 1);
      let hello: Record<string, unknown> | null = null;
      try {
        hello = object(JSON.parse(line));
      } catch {}
      const id = object(object(hello?.result)?.core)?.id;
      if (id !== this.request.expectedCoreId) {
        this.close(coreError(hello) ?? "Core identity changed. Reconnect the factory.");
        return;
      }
      this.phase = "attaching";
      const { terminal, observe, cols, rows, display } = this.request;
      const params = {
        terminal,
        observe,
        resize_notifications: observe,
        cols,
        rows,
        display,
      };
      const call = { jsonrpc: "2.0", id: 1, method: "terminal.attach", params };
      this.pipe.writer.write(encodeFrame(0, FRAME.data, Buffer.from(JSON.stringify(call))));
    }
    while (this.phase !== "closed" && this.buffered.length >= HEADER) {
      const length = this.buffered.readUInt32LE(5);
      if (length > MAX_PAYLOAD) {
        this.close("Core sent a frame that is too large.");
        return;
      }
      if (this.buffered.length < HEADER + length) return;
      const channel = this.buffered.readUInt32LE(0);
      const kind = this.buffered[4]!;
      const payload = Buffer.from(this.buffered.subarray(HEADER, HEADER + length));
      this.buffered = this.buffered.subarray(HEADER + length);
      this.frame(channel, kind, payload);
    }
  }

  private frame(channel: number, kind: number, payload: Buffer) {
    if (this.phase === "attaching") {
      if (channel !== 0 || kind !== FRAME.data) {
        // Stream frames can arrive before the reply that names their channel.
        this.early.push([channel, kind, payload]);
        return;
      }
      let reply: Record<string, unknown> | null = null;
      try {
        reply = object(JSON.parse(payload.toString("utf8")));
      } catch {}
      if (reply?.id !== 1) return;
      const opened = object(reply.result)?.channel;
      if (typeof opened !== "number") {
        this.close(coreError(reply) ?? "Core could not open the terminal.");
        return;
      }
      this.channel = opened;
      this.phase = "open";
      clearTimeout(this.deadline);
      this.settle?.resolve();
      this.settle = null;
      const early = this.early;
      this.early = [];
      for (const [earlyChannel, earlyKind, earlyPayload] of early)
        this.frame(earlyChannel, earlyKind, earlyPayload);
      return;
    }
    if (this.phase !== "open" || channel !== this.channel) return;
    const { streamId } = this.request;
    if (kind === FRAME.data) {
      this.emit({ streamId, type: "data", data: new Uint8Array(payload) });
      const credit = Buffer.alloc(4);
      credit.writeUInt32LE(payload.length, 0);
      this.send(FRAME.credit, credit);
    } else if (kind === FRAME.resize && payload.length >= 4) {
      this.emit({
        streamId,
        type: "resize",
        cols: payload.readUInt16LE(0),
        rows: payload.readUInt16LE(2),
      });
    } else if (kind === FRAME.close) {
      let reason = "ended";
      try {
        const ending = object(JSON.parse(payload.toString("utf8")));
        if (typeof ending?.reason === "string") reason = ending.reason;
      } catch {}
      this.close(reason);
    }
  }
}
