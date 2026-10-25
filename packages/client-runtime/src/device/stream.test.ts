import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createDeviceStreamClient,
  AvccDemuxer,
  avcCodecString,
  parseSemuPacket,
  scanAccessUnit,
} from "./stream.ts";

const envelope = (tag: number, payload: number[]) => {
  const length = 1 + payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    tag,
    ...payload,
  ];
};

describe("AvccDemuxer", () => {
  it("reassembles envelopes split across reads", () => {
    const demuxer = new AvccDemuxer();
    const bytes = new Uint8Array([
      ...envelope(1, [1, 0x64, 0x00, 0x1f]),
      ...envelope(2, [9, 9, 9]),
      ...envelope(0x7f, [0]),
      ...envelope(3, [4]),
    ]);
    const first = demuxer.push(bytes.subarray(0, 7));
    const rest = demuxer.push(bytes.subarray(7));
    const chunks = [...first, ...rest];
    expect(chunks.map((chunk) => chunk.type)).toEqual(["description", "keyframe", "delta"]);
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 0x64, 0x00, 0x1f]);
    expect(Array.from(chunks[1]!.payload)).toEqual([9, 9, 9]);
  });

  it("derives the WebCodecs codec string from the avcC record", () => {
    expect(avcCodecString(new Uint8Array([1, 0x64, 0x00, 0x1f]))).toBe("avc1.64001f");
    expect(avcCodecString(new Uint8Array([1]))).toBe("avc1.42E01E");
  });
});

describe("native device stream transport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(platform: "ios" | "android") {
    vi.useFakeTimers();
    vi.stubGlobal("VideoDecoder", vi.fn());
    vi.stubGlobal("EncodedVideoChunk", vi.fn());
    let resolveOpened!: (socket: FakeSocket) => void;
    const waitForSocket = () =>
      new Promise<FakeSocket>((resolve) => {
        resolveOpened = resolve;
      });
    const opened = waitForSocket();
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      readonly url: string;
      constructor(url: string) {
        this.url = url;
        resolveOpened(this);
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const fetch = vi.fn(() => Promise.resolve(new Response("frame")));
    vi.stubGlobal("fetch", fetch);
    const events = {
      onStatus: vi.fn(),
      onScreen: vi.fn(),
      onUnauthorized: vi.fn(),
      onMjpegFallback: vi.fn(),
      onInputConnected: vi.fn(),
    };
    const client = createDeviceStreamClient(
      {
        platform,
        deviceId: "test device",
        preferMjpeg: platform === "ios",
        access: {
          httpBase: "https://environment.test/api/device-hub",
          wsBase: "wss://environment.test/api/device-hub",
          credentials: false,
          query: { wsTicket: "stream-ticket", hostId: "ssh-host" },
        },
      },
      { getContext: () => null } as unknown as HTMLCanvasElement,
      events,
    );
    return { client, opened, waitForSocket, events, fetch };
  }

  it("renews an expired Android ticket when the HTTP upgrade is rejected instead of retrying it forever", async () => {
    const { client, opened, events } = setup("android");
    client.start();
    const socket = await opened;
    socket.onclose?.({ code: 1006, reason: "" });
    expect(events.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    client.stop();
  });

  it.each(["ios", "android"] as const)(
    "keeps a restarted %s stream connected when the discarded socket closes late",
    async (platform) => {
      const { client, opened, waitForSocket, events } = setup(platform);
      client.start();
      const discarded = await opened;
      client.stop();
      const reopened = waitForSocket();
      client.start();
      const replacement = await reopened;
      replacement.onopen?.();
      if (platform === "ios") replacement.onmessage?.({ data: Uint8Array.of(0x83).buffer });
      replacement.send.mockClear();
      events.onInputConnected.mockClear();

      discarded.onclose?.({ code: 1006, reason: "" });

      expect(events.onUnauthorized).not.toHaveBeenCalled();
      expect(events.onInputConnected).not.toHaveBeenCalled();
      expect(replacement.close).not.toHaveBeenCalled();
      client.pressButton("home");
      expect(replacement.send).toHaveBeenCalledTimes(1);
      client.stop();
      expect(replacement.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["ios", "android"] as const)(
    "does not renew credentials or reconnect a stopped %s stream",
    async (platform) => {
      const { client, opened, events } = setup(platform);
      client.start();
      const socket = await opened;
      events.onInputConnected.mockClear();
      client.stop();
      socket.onclose?.({ code: 1006, reason: "" });
      expect(events.onUnauthorized).not.toHaveBeenCalled();
      expect(events.onInputConnected).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

function semuPacket(version: 1 | 2, isKey: boolean, timestamp: number, payload: ArrayBuffer) {
  const headerBytes = version === 1 ? 16 : 24;
  const buffer = new ArrayBuffer(headerBytes + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x53454d55);
  view.setUint8(4, version);
  view.setUint8(5, isKey ? 1 : 0);
  view.setBigUint64(8, BigInt(timestamp));
  if (version === 2) view.setBigUint64(16, 1_700_000_000_123_456n);
  new Uint8Array(buffer).set(new Uint8Array(payload), headerBytes);
  return buffer;
}

const videoSession = (width: number, height: number) =>
  JSON.stringify({ type: "video-session", size: { width, height } });

describe("serve-emu frames", () => {
  it.each([1, 2] as const)(
    "strips the SEMU v%i header and reads the keyframe flag and timestamp",
    (version) => {
      const packet = parseSemuPacket(
        semuPacket(version, true, 123456, Uint8Array.of(7, 8, 9).buffer),
      );
      expect(packet.isKey).toBe(true);
      expect(packet.timestamp).toBe(123456);
      expect(Array.from(packet.data)).toEqual([7, 8, 9]);
    },
  );

  it("treats a frame without the header as raw data", () => {
    const packet = parseSemuPacket(new Uint8Array([0, 0, 1, 0x65]).buffer);
    expect(packet.isKey).toBeNull();
    expect(packet.data.length).toBe(4);
  });

  it("finds the SPS and IDR NAL units in an Annex-B access unit", () => {
    const unit = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0, 0, 1, 0x65, 0xaa]);
    const scanned = scanAccessUnit(unit);
    expect(scanned.isKey).toBe(true);
    expect(scanned.sps && avcCodecString(scanned.sps)).toBe("avc1.64001f");
    expect(scanAccessUnit(new Uint8Array([0, 0, 1, 0x41, 0x00])).isKey).toBe(false);
  });
});

class MjpegImage extends EventTarget {
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";
  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
  }
}

function recoveryFixture(platform: "ios" | "android" = "ios", preferMjpeg = true) {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    binaryType = "";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  const decoders: Decoder[] = [];
  const decode = vi.fn<(chunk: EncodedVideoChunkInit) => void>();
  class Decoder {
    static isConfigSupported = vi.fn(async () => ({ supported: true }));
    state = "unconfigured";
    decodeQueueSize = 0;
    configure() {
      this.state = "configured";
    }
    reset = vi.fn(() => {
      this.state = "unconfigured";
      this.decodeQueueSize = 0;
    });
    close() {
      this.state = "closed";
    }
    decode = vi.fn((chunk: EncodedVideoChunkInit) => decode(chunk));
    readonly callbacks: { output: (frame: VideoFrame) => void; error: () => void };
    constructor(callbacks: { output: (frame: VideoFrame) => void; error: () => void }) {
      this.callbacks = callbacks;
      decoders.push(this);
    }
  }
  vi.stubGlobal("VideoDecoder", Decoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    vi.fn(function (init: EncodedVideoChunkInit) {
      return { ...init };
    }),
  );
  const videoBodies: ReadableStreamDefaultController<Uint8Array>[] = [];
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const signal = init.signal!;
    signals.push(signal);
    if (!url.includes("stream.avcc")) return Promise.resolve(new Response("prime"));
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(body) {
            videoBodies.push(body);
            signal.addEventListener("abort", () => body.error(new Error("aborted")), {
              once: true,
            });
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const events = {
    onStatus: vi.fn(),
    onScreen: vi.fn(),
    onUnauthorized: vi.fn(),
    onMjpegFallback: vi.fn(),
    onInputConnected: vi.fn(),
  };
  const drawImage = vi.fn();
  const image = new MjpegImage();
  const client = createDeviceStreamClient(
    {
      platform,
      preferMjpeg,
      deviceId: "test-device",
      access: {
        httpBase: "https://test/api/device-hub",
        wsBase: "wss://test/api/device-hub",
        credentials: true,
        query: {},
      },
    },
    { getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement,
    events,
  );
  client.setMjpegImage(image as unknown as HTMLImageElement);
  const imageReady = () => {
    image.naturalWidth = 400;
    image.naturalHeight = 800;
    image.dispatchEvent(new Event("load"));
  };
  const decodedFrame = (index = decoders.length - 1) => {
    const close = vi.fn();
    decoders[index]!.callbacks.output({
      displayWidth: 400,
      displayHeight: 800,
      close,
    } as unknown as VideoFrame);
    return close;
  };
  const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x1f, 0, 0, 1, 0x65]).buffer;
  return {
    client,
    events,
    image,
    imageReady,
    sockets,
    signals,
    fetch,
    videoBodies,
    decoders,
    Decoder,
    decode,
    drawImage,
    decodedFrame,
    sps,
  };
}

describe("shared device stream readiness and recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("repairs the hub's fallback configuration without disabling hardware decoding", async () => {
    const { client, videoBodies, Decoder } = recoveryFixture("ios", false);
    try {
      client.start();
      await vi.advanceTimersByTimeAsync(0);
      videoBodies[0]!.enqueue(
        Uint8Array.from(
          envelope(
            1,
            [
              1, 100, 0, 51, 255, 225, 0, 12, 39, 100, 0, 51, 172, 86, 128, 76, 1, 73, 230, 164, 1,
              0, 4, 40, 238, 60, 176,
            ],
          ),
        ),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(Decoder.isConfigSupported).toHaveBeenCalledExactlyOnceWith({
        codec: "avc1.640033",
        description: Uint8Array.from([
          1, 100, 0, 51, 255, 225, 0, 17, 39, 100, 0, 51, 172, 86, 128, 76, 1, 73, 230, 168, 6, 208,
          68, 35, 80, 1, 0, 4, 40, 238, 60, 176,
        ]),
        optimizeForLatency: true,
      });
    } finally {
      client.stop();
    }
  });

  it("does not repaint a delayed JPEG seed over newer decoded video", async () => {
    const { client, videoBodies, drawImage, decodedFrame } = recoveryFixture("ios", false);
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal(
      "createImageBitmap",
      () =>
        new Promise((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    videoBodies[0]!.enqueue(
      new Uint8Array([
        ...envelope(4, [1]),
        ...envelope(1, [1, 0x64, 0, 0x1f]),
        ...envelope(2, [2]),
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    decodedFrame();
    const close = vi.fn();
    resolveBitmap({ width: 400, height: 800, close } as unknown as ImageBitmap);
    await vi.advanceTimersByTimeAsync(0);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    client.stop();
  });

  it("renders the first Android keyframe and dependent deltas after the codec probe", async () => {
    const { client, sockets, sps, Decoder, decode, events, decodedFrame, drawImage } =
      recoveryFixture("android");
    const support = Promise.withResolvers<{ supported: boolean }>();
    Decoder.isConfigSupported.mockReturnValueOnce(support.promise);
    decode.mockImplementation(() => decodedFrame());
    const delta = Uint8Array.of(0, 0, 0, 1, 0x41, 0x01);
    const nextDelta = Uint8Array.of(0, 0, 0, 1, 0x41, 0x02);
    try {
      client.start();
      sockets[0]!.onmessage?.({ data: semuPacket(2, true, 123456, sps) });
      sockets[0]!.onmessage?.({ data: semuPacket(2, false, 140123, delta.buffer) });
      expect(decode).not.toHaveBeenCalled();
      expect(sockets[0]!.send).not.toHaveBeenCalled();
      support.resolve({ supported: true });
      await vi.advanceTimersByTimeAsync(0);
      sockets[0]!.onmessage?.({ data: semuPacket(2, false, 156790, nextDelta.buffer) });
      expect(decode.mock.calls).toEqual([
        [{ type: "key", timestamp: 123456, data: new Uint8Array(sps) }],
        [{ type: "delta", timestamp: 140123, data: delta }],
        [{ type: "delta", timestamp: 156790, data: nextDelta }],
      ]);
      expect(drawImage).toHaveBeenCalledTimes(3);
      expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
      expect(sockets[0]!.send).not.toHaveBeenCalled();
    } finally {
      client.stop();
    }
  });

  it("keeps the Android decoder across same-size restarts and replaces it on resize", async () => {
    const { client, sockets, sps, decoders, decode, events, decodedFrame, drawImage } =
      recoveryFixture("android");
    decode.mockImplementation(() => decodedFrame());
    try {
      client.start();
      sockets[0]!.onmessage?.({ data: videoSession(400, 800) });
      sockets[0]!.onmessage?.({ data: sps });
      await vi.advanceTimersByTimeAsync(0);
      sockets[0]!.send.mockClear();
      drawImage.mockClear();

      // Older hubs also announce same-size restarts before sending fresh SPS/PPS and an IDR.
      for (let restart = 0; restart < 3; restart++) {
        sockets[0]!.onmessage?.({
          data: videoSession(400, 800),
        });
        sockets[0]!.onmessage?.({ data: sps });
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(drawImage).toHaveBeenCalledTimes(3);
      expect(decoders).toHaveLength(1);
      sockets[0]!.onmessage?.({ data: videoSession(800, 400) });
      expect(decoders[0]!.state).toBe("closed");
      drawImage.mockClear();
      decodedFrame(0);
      expect(drawImage).not.toHaveBeenCalled();
      sockets[0]!.onmessage?.({ data: sps });
      await vi.advanceTimersByTimeAsync(0);
      expect(decoders).toHaveLength(2);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
      expect(sockets[0]!.send).not.toHaveBeenCalled();
    } finally {
      client.stop();
    }
  });

  it("replaces pending Android frames with a newer keyframe across a same-size restart", async () => {
    const { client, sockets, sps, Decoder, decode, events, decodedFrame, drawImage } =
      recoveryFixture("android");
    const support = Promise.withResolvers<{ supported: boolean }>();
    Decoder.isConfigSupported.mockReturnValueOnce(support.promise);
    decode.mockImplementation(() => decodedFrame());
    try {
      client.start();
      sockets[0]!.onmessage?.({ data: videoSession(400, 800) });
      sockets[0]!.onmessage?.({ data: semuPacket(1, true, 123456, sps) });
      const delta = new Uint8Array([0, 0, 0, 1, 0x41]).buffer;
      sockets[0]!.onmessage?.({ data: semuPacket(1, false, 140123, delta) });
      sockets[0]!.onmessage?.({ data: videoSession(400, 800) });
      const replacement = Uint8Array.of(...new Uint8Array(sps), 0xaa);
      sockets[0]!.onmessage?.({ data: semuPacket(1, true, 0, replacement.buffer) });
      sockets[0]!.onmessage?.({ data: semuPacket(1, false, 16667, delta) });
      expect(sockets[0]!.send).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
      expect(Decoder.isConfigSupported).toHaveBeenCalledOnce();

      support.resolve({ supported: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(decode.mock.calls).toEqual([
        [{ type: "key", timestamp: 0, data: replacement }],
        [{ type: "delta", timestamp: 16667, data: new Uint8Array(delta) }],
      ]);
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
      expect(sockets[0]!.send).not.toHaveBeenCalled();
    } finally {
      client.stop();
    }
  });

  it("discards an Android keyframe when its video session changes during codec setup", async () => {
    const { client, sockets, sps, Decoder, decode, decodedFrame, drawImage } =
      recoveryFixture("android");
    const support = Promise.withResolvers<{ supported: boolean }>();
    Decoder.isConfigSupported.mockReturnValueOnce(support.promise);
    decode.mockImplementation(() => decodedFrame());
    try {
      client.start();
      sockets[0]!.onmessage?.({ data: videoSession(400, 800) });
      sockets[0]!.onmessage?.({ data: sps });
      sockets[0]!.onmessage?.({
        data: videoSession(800, 400),
      });
      sockets[0]!.onmessage?.({ data: sps });
      await vi.advanceTimersByTimeAsync(0);
      expect(drawImage).toHaveBeenCalledOnce();

      support.resolve({ supported: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(decode).toHaveBeenCalledOnce();
      expect(sockets[0]!.send).not.toHaveBeenCalled();
    } finally {
      client.stop();
    }
  });

  it.each(["packets", "bytes"] as const)(
    "queues one recovery after pending Android %s overflow during the hub reset cooldown",
    async (limit) => {
      const { client, sockets, sps, Decoder, decoders, decode, decodedFrame } =
        recoveryFixture("android");
      const support = Promise.withResolvers<{ supported: boolean }>();
      Decoder.isConfigSupported.mockReturnValueOnce(support.promise);
      decode.mockImplementation(() => decodedFrame());
      const delta = Uint8Array.of(0, 0, 0, 1, 0x41);
      try {
        client.start();
        const socket = sockets[0]!;
        socket.onmessage?.({ data: videoSession(400, 800) });
        socket.onmessage?.({ data: semuPacket(1, true, 0, sps) });
        if (limit === "packets") {
          for (let index = 1; index <= 10; index++) {
            socket.onmessage?.({ data: semuPacket(1, false, index * 16667, delta.buffer) });
          }
        } else {
          const largeDelta = new Uint8Array(8 * 1024 * 1024);
          largeDelta.set(delta);
          socket.onmessage?.({ data: semuPacket(1, false, 16667, largeDelta.buffer) });
        }
        support.resolve({ supported: true });
        await vi.advanceTimersByTimeAsync(499);
        expect(decode).not.toHaveBeenCalled();
        expect(socket.send).not.toHaveBeenCalled();
        socket.send.mockImplementation((message: string) => {
          expect(JSON.parse(message)).toEqual({ type: "reset-video", ack: false });
          // The pinned hub queues this request until its 1500 ms reset cooldown expires.
          // @effect-diagnostics-next-line globalTimers:off - The mock hub uses the transport's fake clock.
          setTimeout(() => {
            socket.onmessage?.({ data: videoSession(400, 800) });
            socket.onmessage?.({ data: semuPacket(1, true, 0, sps) });
            socket.onmessage?.({ data: semuPacket(1, false, 16667, delta.buffer) });
          }, 500);
        });
        await vi.advanceTimersByTimeAsync(501);
        expect(socket.send).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(499);
        expect(decode).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(decode.mock.calls).toEqual([
          [{ type: "key", timestamp: 0, data: new Uint8Array(sps) }],
          [{ type: "delta", timestamp: 16667, data: delta }],
        ]);
        expect(vi.getTimerCount()).toBe(0);

        decoders.at(-1)!.callbacks.error();
        client.stop();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(socket.send).toHaveBeenCalledOnce();
      } finally {
        client.stop();
      }
    },
  );

  it("discards decoder support results and output from a previous Android socket", async () => {
    const { client, sockets, sps, events, Decoder, decoders, decodedFrame, drawImage } =
      recoveryFixture("android");
    let resolveSupport!: (support: { supported: boolean }) => void;
    Decoder.isConfigSupported.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSupport = resolve;
        }),
    );
    client.start();
    sockets[0]!.onmessage?.({ data: sps });
    client.stop();
    client.start();
    resolveSupport({ supported: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(decoders).toHaveLength(0);
    sockets[1]!.onmessage?.({ data: sps });
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    client.start();
    events.onStatus.mockClear();
    expect(decodedFrame()).toHaveBeenCalledOnce();
    expect(drawImage).not.toHaveBeenCalled();
    expect(events.onStatus).not.toHaveBeenCalled();
    client.stop();
  });

  it("ignores an old AVCC response rejected after a new attempt is connected", async () => {
    const { client, fetch, events } = recoveryFixture("ios", false);
    let resolveResponse!: (response: Response) => void;
    fetch.mockImplementationOnce(() => Promise.resolve(new Response("prime")));
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    events.onStatus.mockClear();
    resolveResponse(new Response(null, { status: 401 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onUnauthorized).not.toHaveBeenCalled();
    expect(events.onStatus).not.toHaveBeenCalled();
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
