import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ProcessRunner from "../processRunner.ts";
import { ensureDeviceHub } from "./DeviceToolchain.ts";

// Downloads the pinned npm package into a disposable T3 home. Run when changing the pin/patch:
// T3_TEST_DEVICE_HUB_INSTALL=1 vp test run apps/server/src/device/deviceHubPackage.test.ts
it.effect.skipIf(process.env.T3_TEST_DEVICE_HUB_INSTALL !== "1")(
  "fresh npm install preserves power on video/control reconnect and still sends explicit POWER",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const runner = yield* ProcessRunner.ProcessRunner;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hub-package-" });
      const hub = yield* ensureDeviceHub(base);
      const vendor = path.join(
        hub.installDir,
        "node_modules/expo-device-hub/vendor/serve-emu/dist",
      );
      const result = yield* runner.run({
        command: process.execPath,
        args: ["--input-type=module", "-e", exerciseScrcpy, vendor],
      });
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe("video, control, reconnect and explicit power passed");
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  120_000,
);

// Use the package's real transport and input encoder, substituting only ADB and sockets.
const exerciseScrcpy = String.raw`
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(process.argv[1] + '/');
const { startScrcpy, startScrcpyControl } = await import(new URL('scrcpy.js', base));
const { compileGesture } = await import(new URL('input.js', base));

for (const video of [true, false]) {
  // Reconnecting must apply the same safe default, even after an explicit power action.
  for (let connection = 0; connection < 2; connection++) {
    const spawned = [];
    const adbCalls = [];
    const written = [];
    let connects = 0;
    const control = new Duplex({
      read() {},
      write(chunk, encoding, callback) { written.push(Buffer.from(chunk)); callback(); },
    });
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => { proc.emit('exit', 0, 'SIGTERM'); return true; };
    const session = await (video ? startScrcpy : startScrcpyControl)({ serial: 'test-device' }, {
      ensureServer: async () => '/test/scrcpy.jar',
      serverFingerprint: async () => 'abcdef',
      randomScid: () => '00000001',
      runAdb: async (serial, args) => {
        adbCalls.push(args);
        return { status: 0, stdout: args[0] === 'forward' ? '27123' : '@scrcpy_00000001', stderr: '' };
      },
      spawnAdb: (serial, args) => { spawned.push(args); return proc; },
      connect: async () => {
        if (video && connects++ === 0) {
          const socket = new PassThrough();
          const preamble = Buffer.alloc(81);
          preamble.write('test-device', 1);
          preamble.write('h264', 65);
          preamble.writeUInt32BE(0x80000000, 69);
          preamble.writeUInt32BE(1920, 73);
          preamble.writeUInt32BE(1080, 77);
          socket.end(preamble);
          return socket;
        }
        return control;
      },
    });
    try {
      assert.equal(spawned.length, 1);
      assert.deepEqual(spawned[0].filter(arg => arg.startsWith('power_on=')), ['power_on=false']);
      assert.ok(spawned[0].includes('video=' + video));
      assert.ok(spawned[0].includes('control=true'));
      assert.equal(written.length, 0, 'connecting must not send a control message');
      assert.ok(!adbCalls.flat().includes('input'), 'connecting must not inject an ADB key');
      // Explicit power requests still encode POWER down/up on the connected control socket.
      const { steps } = compileGesture({ type: 'power' }, { width: 1920, height: 1080 });
      for (const step of steps) session.controlSocket.write(step.packet);
      assert.equal(written.length, 2);
      assert.deepEqual(written.map(packet => [packet[0], packet[1], packet.readInt32BE(2)]), [
        [0, 0, 26], [0, 1, 26],
      ]);
    } finally {
      await session.close();
    }
  }
}
console.log('video, control, reconnect and explicit power passed');
`;
