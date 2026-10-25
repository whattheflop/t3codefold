import * as HostProcess from "@t3tools/shared/HostProcess";
import { isCommandAvailable, resolveCommandPath } from "@t3tools/shared/shell";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { NativeClientError, type NativePlatform } from "./mobile-native-client.ts";

// Fold's incremental Android native client build: one ABI, Gradle and adb
// directly, shared ccache across worktrees. mobile-native-client.ts calls in.

/**
 * The JDK Gradle should compile with.
 *
 * A module that declares no toolchain of its own compiles with whichever JVM
 * launched Gradle, and `java` is not required to be a JDK: Debian-style
 * alternatives will happily point it at a headless JRE while `javac` comes
 * from a different package. Gradle then fails deep inside a third-party
 * module with "does not provide the required capabilities: [JAVA_COMPILER]",
 * naming a JVM nobody chose and no file in this repo mentions.
 *
 * Pinning a toolchain version in Gradle instead would reject machines whose
 * only JDK is newer than the one we picked, so resolve whatever JDK is
 * actually installed and hand Gradle that.
 */
export const resolveJavaHome = Effect.fn("nativeClient.resolveJavaHome")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const compiler = (yield* HostProcess.Platform) === "win32" ? "javac.exe" : "javac";
  const compiles = (home: string) =>
    fs.exists(path.join(home, "bin", compiler)).pipe(Effect.orElseSucceed(() => false));

  const configured = environment.JAVA_HOME?.trim();
  if (configured && (yield* compiles(configured))) return configured;

  // `javac` on PATH is by definition a compiler, so its real location is a JDK
  // even when `java` beside it is not.
  const resolved = yield* resolveCommandPath(compiler).pipe(
    Effect.flatMap((found) => (found === null ? Effect.succeed(null) : fs.realPath(found))),
    Effect.orElseSucceed(() => null),
  );
  if (resolved) return path.dirname(path.dirname(resolved));

  return yield* new NativeClientError({
    message: configured
      ? `JAVA_HOME (${configured}) has no ${compiler}; point it at a JDK, not a JRE.`
      : `No ${compiler} found on PATH. Install a JDK, or set JAVA_HOME to one.`,
  });
});

const ANDROID_ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"] as const;
export type AndroidAbi = (typeof ANDROID_ABIS)[number];

export function parseAndroidAbi(value: string): AndroidAbi {
  const abi = value.trim();
  if (!ANDROID_ABIS.some((candidate) => candidate === abi)) {
    throw new NativeClientError({
      message: `Unsupported Android emulator ABI: ${abi || "empty"}.`,
    });
  }
  return abi as AndroidAbi;
}

/** Debug clients run on one emulator, so the other three ABIs are pure build time. */
export function androidGradleBuildArgs(abi: AndroidAbi): string[] {
  return ["app:assembleDebug", "--build-cache", `-PreactNativeArchitectures=${abi}`];
}

/** Expo fingerprinting decides when native inputs changed; --clean would discard every intermediate. */
export function incrementalPrebuildArgs(platform: NativePlatform): string[] {
  return ["exec", "expo", "prebuild", "--platform", platform, "--no-install"];
}

/**
 * Gradle's build cache covers JVM and packaging tasks, but externalNativeBuild is not cacheable,
 * and pnpm materializes each worktree's node_modules separately. ccache is what lets one host's
 * NDK objects serve every checkout, so its settings exist to make a compile hash identically
 * regardless of which worktree ran it.
 */
export function ccacheEnvironment(repoRoot: string): Record<string, string> {
  return {
    CMAKE_C_COMPILER_LAUNCHER: "ccache",
    CMAKE_CXX_COMPILER_LAUNCHER: "ccache",
    // Rewrites checkout-absolute paths to CWD-relative. The NDK sits outside the checkout and
    // stays absolute, which is what keeps toolchain changes a miss.
    CCACHE_BASEDIR: repoRoot,
    // The same dependency unpacked into two worktrees differs only in timestamps.
    CCACHE_SLOPPINESS: "include_file_ctime,include_file_mtime,time_macros,pch_defines",
    // Debug info records the build directory; hashing it would make every worktree a miss.
    CCACHE_NOHASHDIR: "1",
    CCACHE_COMPILERCHECK: "content",
  };
}

type RunCommand<E, R> = (
  program: string,
  args: string[],
  inherit?: boolean,
  cwd?: string,
  environmentOverrides?: Record<string, string>,
) => Effect.Effect<string, E, R>;

/** Builds the connected emulator's ABI with Gradle and installs it by adb serial. */
export const buildAndInstallAndroidClient = <E, R>(
  device: string,
  { mobile, repo }: { readonly mobile: string; readonly repo: string },
  command: RunCommand<E, R>,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const abi = parseAndroidAbi(
      yield* command("adb", ["-s", device, "shell", "getprop", "ro.product.cpu.abi"]),
    );
    const hasCcache = yield* isCommandAvailable("ccache");
    if (!hasCcache)
      yield* Console.error(
        "ccache is not installed, so this build cannot reuse NDK objects compiled in another worktree. Install ccache to share them.",
      );
    const gradle =
      (yield* HostProcess.Platform) === "win32"
        ? path.join(mobile, "android/gradlew.bat")
        : path.join(mobile, "android/gradlew");
    yield* command(gradle, androidGradleBuildArgs(abi), true, path.join(mobile, "android"), {
      ANDROID_SERIAL: device,
      JAVA_HOME: yield* resolveJavaHome(),
      ...(hasCcache ? ccacheEnvironment(repo) : {}),
    });
    yield* command(
      "adb",
      [
        "-s",
        device,
        "install",
        "-r",
        path.join(mobile, "android/app/build/outputs/apk/debug/app-debug.apk"),
      ],
      true,
    );
  }).pipe(Effect.withSpan("nativeClient.buildAndInstallAndroid"));
