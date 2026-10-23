import * as PlatformError from "effect/PlatformError";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import {
  deviceToolVersions,
  DEVICE_HUB_VERSION,
  DEVICE_HUB_PACKAGE_VERSION,
  ensureDeviceHub,
  isDeviceHubInstalled,
} from "./DeviceToolchain.ts";
import { deviceHubScrcpyPatch } from "./deviceHubPatch.ts";

// The relevant upstream argument boundary, independent of the patch's replacement text.
const scrcpySource =
  'const args = [\n            "control=true",\n            `send_dummy_byte=${video}`,\n];';
const installed = {
  code: ChildProcessSpawner.ExitCode(0),
  stdout: "",
  stderr: "",
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
};

const fakeHubInstall = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  source: string,
  requested: string[],
) =>
  ProcessRunner.ProcessRunner.of({
    run: ({ args }) =>
      Effect.gen(function* () {
        requested.push(args.at(-1)!);
        const root = path.join(args[args.indexOf("--prefix") + 1]!, "node_modules/expo-device-hub");
        yield* fs.makeDirectory(path.join(root, "dist/server"), { recursive: true });
        yield* fs.writeFileString(path.join(root, "dist/server/cli.mjs"), "");
        const file = path.join(root, deviceHubScrcpyPatch.file);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, source);
        return installed;
      }).pipe(Effect.orDie),
  });

it.effect(
  "fresh and reinstalled hubs preserve power without reusing or modifying the old install",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped();
      const old = path.join(base, "tools/expo-device-hub", DEVICE_HUB_PACKAGE_VERSION);
      yield* fs.makeDirectory(path.join(old, "node_modules/expo-device-hub/dist/server"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(old, "node_modules/expo-device-hub/dist/server/cli.mjs"),
        "old hub",
      );
      yield* fs.writeFileString(path.join(old, ".install-complete"), DEVICE_HUB_PACKAGE_VERSION);
      expect(yield* isDeviceHubInstalled(base)).toBe(false);
      const requested: string[] = [];
      const ensure = ensureDeviceHub(base).pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          fakeHubInstall(fs, path, scrcpySource, requested),
        ),
      );
      const first = yield* ensure;
      expect(first.installDir).not.toBe(old);
      expect(yield* isDeviceHubInstalled(base)).toBe(true);
      expect(yield* ensure).toEqual(first);
      expect(requested).toEqual([`expo-device-hub@${DEVICE_HUB_PACKAGE_VERSION}`]);
      yield* fs.remove(first.installDir, { recursive: true });
      const second = yield* ensure;
      expect(requested).toHaveLength(2);
      const source = yield* fs.readFileString(
        path.join(second.installDir, "node_modules/expo-device-hub", deviceHubScrcpyPatch.file),
      );
      expect(source).toContain('"power_on=false"');
      expect(source).toContain('"control=true"');
      expect(
        yield* fs.readFileString(
          path.join(old, "node_modules/expo-device-hub/dist/server/cli.mjs"),
        ),
      ).toBe("old hub");
      expect((yield* deviceToolVersions(base))?.hub.installedVersions).toEqual([
        DEVICE_HUB_PACKAGE_VERSION,
        DEVICE_HUB_VERSION,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each(["unexpected upstream source", scrcpySource + scrcpySource])(
  "does not publish a hub when the power-state patch cannot match exactly once: %s",
  (source) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped();
      const error = yield* ensureDeviceHub(base).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, fakeHubInstall(fs, path, source, [])),
        Effect.flip,
      );
      expect(error.step).toBe("matching the scrcpy power-state patch");
      expect(yield* isDeviceHubInstalled(base)).toBe(false);
      expect(yield* fs.readDirectory(path.join(base, "tools/expo-device-hub"))).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("failed installation cleans staging and exposes only a safe failure message", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-device-install-" });
    const result = {
      code: ChildProcessSpawner.ExitCode(1),
      stdout: "",
      stderr: "registry rejected https://private:credential@example.test/package",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    };
    const error = yield* ensureDeviceHub(baseDir).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: () => Effect.succeed(result),
      }),
      Effect.flip,
    );
    expect(error.message).toBe(
      "Installing expo-device-hub failed while running npm install (exit code 1).",
    );
    expect(error.cause).toBe(result);
    expect(yield* isDeviceHubInstalled(baseDir)).toBe(false);
    expect(yield* fs.readDirectory(path.join(baseDir, "tools", "expo-device-hub"))).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("inventory reports only completed versions without installing the required version", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fs.makeTempDirectoryScoped();
    for (const [version, sentinel] of [
      ["0.9.0", "0.9.0"],
      [DEVICE_HUB_VERSION, "wrong"],
      [".staging-123", ".staging-123"],
    ]) {
      const dir = path.join(base, "tools", "expo-device-hub", version!);
      yield* fs.makeDirectory(path.join(dir, "node_modules/expo-device-hub/dist/server"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(dir, "node_modules/expo-device-hub/dist/server/cli.mjs"),
        "",
      );
      yield* fs.writeFileString(path.join(dir, ".install-complete"), sentinel!);
    }
    const tools = yield* deviceToolVersions(base);
    expect(tools?.hub).toEqual({
      requiredVersion: DEVICE_HUB_VERSION,
      installedVersions: ["0.9.0"],
      runningVersion: null,
    });
    expect(tools?.agent.installedVersions).toEqual([]);
    expect(yield* isDeviceHubInstalled(base)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("unreadable inventory stays unknown instead of reporting no installs", () =>
  Effect.gen(function* () {
    const tools = yield* deviceToolVersions("/unreadable");
    expect(tools).toBeUndefined();
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        readDirectory: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "readDirectory",
              description: "denied",
            }),
          ),
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);
