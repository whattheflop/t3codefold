import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { assert, describe, it } from "@effect/vitest";

import {
  androidGradleBuildArgs,
  ccacheEnvironment,
  incrementalPrebuildArgs,
  parseAndroidAbi,
  resolveJavaHome,
} from "./fold-android-native-client.ts";
import {
  androidSdk,
  buildRunTitle,
  clientStatus,
  NativeClientError,
  remoteBuildState,
} from "./mobile-native-client.ts";

describe("mobile native client build planning", () => {
  it("keeps prebuild incremental for both platforms", () => {
    assert.deepEqual(incrementalPrebuildArgs("android"), [
      "exec",
      "expo",
      "prebuild",
      "--platform",
      "android",
      "--no-install",
    ]);
    assert.notInclude(incrementalPrebuildArgs("ios"), "--clean");
  });

  it("builds only the selected emulator ABI with Gradle's shared build cache", () => {
    assert.deepEqual(androidGradleBuildArgs(parseAndroidAbi("x86_64\n")), [
      "app:assembleDebug",
      "--build-cache",
      "-PreactNativeArchitectures=x86_64",
    ]);
  });

  it("rejects an ABI that the Android build does not support", () => {
    try {
      parseAndroidAbi("riscv64");
      assert.fail("Expected an unsupported ABI error.");
    } catch (error) {
      assert.instanceOf(error, NativeClientError);
      assert.equal(error.message, "Unsupported Android emulator ABI: riscv64.");
    }
  });

  it("anchors ccache to the checkout so two worktrees share one NDK object", () => {
    const one = ccacheEnvironment("/checkouts/one");
    const two = ccacheEnvironment("/checkouts/two");

    assert.equal(one.CCACHE_BASEDIR, "/checkouts/one");
    assert.equal(two.CCACHE_BASEDIR, "/checkouts/two");
    assert.equal(one.CMAKE_CXX_COMPILER_LAUNCHER, "ccache");
    // Only the checkout anchor may differ; anything else would hash the same source differently.
    const { CCACHE_BASEDIR: _one, ...oneRest } = one;
    const { CCACHE_BASEDIR: _two, ...twoRest } = two;
    assert.deepEqual(oneRest, twoRest);
    // pnpm gives each worktree its own copy of a dependency's headers, identical but for timestamps.
    assert.include(one.CCACHE_SLOPPINESS, "include_file_mtime");
    assert.equal(one.CCACHE_NOHASHDIR, "1");
  });

  it("reuses only the installed binary recorded for the current fingerprint", () => {
    assert.equal(
      clientStatus("native-a", "binary-a", { fingerprint: "native-a", binary: "binary-a" }),
      "compatible",
    );
    assert.equal(
      clientStatus("native-b", "binary-a", { fingerprint: "native-a", binary: "binary-a" }),
      "stale",
    );
    assert.equal(
      clientStatus("native-a", "binary-b", { fingerprint: "native-a", binary: "binary-a" }),
      "unknown",
    );
  });
});

/** A JDK has a compiler beside its runtime; a JRE has only the runtime. */
const makeJvm = Effect.fn(function* (root: string, name: string, withCompiler: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = path.join(root, name);
  yield* fs.makeDirectory(path.join(home, "bin"), { recursive: true });
  // PATH lookup only considers executables, so the mode bits matter here.
  for (const tool of withCompiler ? ["java", "javac"] : ["java"]) {
    const binary = path.join(home, "bin", tool);
    yield* fs.writeFileString(binary, "");
    yield* fs.chmod(binary, 0o755);
  }
  return home;
});

const resolve = (environment: Record<string, string>) =>
  resolveJavaHome().pipe(
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Environment, environment),
  );

it.layer(NodeServices.layer)("android jdk resolution", (it) => {
  it.effect("keeps a JAVA_HOME that can compile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "jdk-" })
        .pipe(Effect.flatMap(fs.realPath));
      const jdk = yield* makeJvm(root, "jdk-17", true);

      assert.equal(yield* resolve({ JAVA_HOME: jdk, PATH: "" }), jdk);
    }),
  );

  it.effect("falls back to the JDK owning javac when JAVA_HOME is a JRE", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // javac is located through realpath, and macOS temp directories sit behind /var -> /private/var.
      const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "jdk-" }));
      const jre = yield* makeJvm(root, "jre-25", false);
      const jdk = yield* makeJvm(root, "jdk-17", true);

      // The exact shape that broke the 1.2.0 build: `java` resolves to a
      // headless runtime while `javac` comes from a different install.
      const resolved = yield* resolve({
        JAVA_HOME: jre,
        PATH: [path.join(jre, "bin"), path.join(jdk, "bin")].join(":"),
      });

      assert.equal(resolved, jdk);
    }),
  );

  it.effect("names the offending JAVA_HOME when nothing can compile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "jdk-" })
        .pipe(Effect.flatMap(fs.realPath));
      const jre = yield* makeJvm(root, "jre-25", false);

      const error = yield* resolve({ JAVA_HOME: jre, PATH: "" }).pipe(Effect.flip);

      assert.equal(error._tag, "NativeClientError");
      assert.include(error.message, jre);
      assert.include(error.message, "not a JRE");
    }),
  );
});

it.layer(NodeServices.layer)("androidSdk", (it) => {
  it.effect("skips a configured SDK path that holds no SDK", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "android-sdk-home-" });
      const sdk = path.join(home, "sdk");
      yield* fs.makeDirectory(path.join(sdk, "platform-tools"), { recursive: true });

      const resolved = yield* androidSdk.pipe(
        Effect.provideService(HostProcess.Environment, {
          HOME: home,
          ANDROID_HOME: path.join(home, "stale"),
          ANDROID_SDK_ROOT: sdk,
        }),
      );

      assert.strictEqual(resolved, sdk);
    }),
  );
});

it("finds a Blacksmith build by its run title and reads its state", () => {
  const fingerprint = "a".repeat(40);
  const title = buildRunTitle("android", "x86_64", fingerprint);
  assert.strictEqual(title, `Dev client android x86_64 ${fingerprint}`);
  assert.strictEqual(buildRunTitle("ios", null, fingerprint), `Dev client ios ${fingerprint}`);
  const run = (
    createdAt: string,
    status: string,
    conclusion: string | null,
    displayTitle = title,
  ) => ({
    displayTitle,
    status,
    conclusion,
    createdAt,
  });
  const since = Date.parse("2026-11-09T12:00:00Z");
  assert.strictEqual(remoteBuildState([], title, since), "none");
  // Another client's run, and a run from before this wait, say nothing about this build.
  assert.strictEqual(
    remoteBuildState(
      [
        run(
          "2026-11-09T12:05:00Z",
          "in_progress",
          null,
          buildRunTitle("android", "arm64-v8a", fingerprint),
        ),
        run("2026-11-09T11:00:00Z", "completed", "failure"),
      ],
      title,
      since,
    ),
    "none",
  );
  assert.strictEqual(
    remoteBuildState([run("2026-11-09T12:01:00Z", "queued", null)], title, since),
    "running",
  );
  assert.strictEqual(
    remoteBuildState([run("2026-11-09T12:01:00Z", "completed", "success")], title, since),
    "succeeded",
  );
  // The newest run decides: a retry that is running outranks the failure before it.
  assert.strictEqual(
    remoteBuildState(
      [
        run("2026-11-09T12:01:00Z", "completed", "failure"),
        run("2026-11-09T12:09:00Z", "in_progress", null),
      ],
      title,
      since,
    ),
    "running",
  );
  assert.strictEqual(
    remoteBuildState([run("2026-11-09T12:01:00Z", "completed", "cancelled")], title, since),
    "failed",
  );
});
