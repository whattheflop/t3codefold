// @effect-diagnostics-next-line nodeBuiltinImport:off -- The test hashes fixture bytes the way the runner does.
import * as NodeCrypto from "node:crypto";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import * as Paths from "effect/Path";
import { EnvironmentId, ProjectId, type PitbossVerification } from "@t3tools/contracts";
import { ServerConfig, layerTest } from "../config.ts";
import { ProcessRunner, layer as processes } from "../processRunner.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { VerificationRunner, layer } from "./VerificationRunner.ts";

it.live(
  "runs a real committed app, catches integration and readiness failures, preserves evidence and isolates changes",
  () =>
    Effect.gen(function* () {
      const Fs = yield* FileSystem.FileSystem;
      const Path = yield* Paths.Path;
      const runner = yield* VerificationRunner;
      const processRunner = yield* ProcessRunner;
      const platform = yield* HostProcess.Platform;
      const config = yield* ServerConfig;
      const root = yield* Fs.makeTempDirectoryScoped({ prefix: "verification-fixture-" });
      const git = (args: string[]) => processRunner.run({ command: "git", args, cwd: root });
      yield* git(["init", "--quiet"]);
      yield* Fs.writeFileString(Path.join(root, "app.cjs"), "exports.add = (a,b) => a+b;");
      yield* Fs.writeFileString(
        Path.join(root, "verify.cjs"),
        'const assert=require("node:assert/strict"); assert.equal(require("./app.cjs").add(2,3),5); require("node:fs").writeFileSync("proof.txt","2+3=5");',
      );
      const bin = Path.join(root, "node_modules", ".bin");
      yield* Fs.makeDirectory(bin, { recursive: true });
      const fixtureTool = Path.join(
        bin,
        platform === "win32" ? "fixture-verification-tool.cmd" : "fixture-verification-tool",
      );
      const candidateTool =
        platform === "win32"
          ? '@if not "%NODE_ENV%"=="test" exit /b 9\r\n'
          : '#!/bin/sh\n[ "$NODE_ENV" = test ]\n';
      yield* Fs.writeFileString(fixtureTool, candidateTool);
      if (platform !== "win32") yield* Fs.chmod(fixtureTool, 0o755);
      yield* git(["add", "."]);
      // The server test setup disables core.filemode; pin the candidate's executable bit.
      if (platform !== "win32") {
        yield* git(["update-index", "--chmod=+x", "--", Path.relative(root, fixtureTool)]);
      }
      yield* git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "Fixture",
      ]);
      const sha = (yield* git(["rev-parse", "HEAD"])).stdout.trim();
      const verification: PitbossVerification = {
        id: "run",
        state: "running",
        candidate: `commit:${sha}`,
        attemptId: "attempt",
        criteriaVersion: 1,
        requestedAt: DateTime.formatIso(yield* DateTime.now),
        recipe: {
          projectId: ProjectId.make("project"),
          version: 1,
          name: "Combined app",
          doctor: "node --version",
          verify: "node verify.cjs",
          cleanup: "",
          timeoutSeconds: 10,
          artifacts: ["proof.txt"],
        },
      };
      const run = (patch: Partial<PitbossVerification["recipe"]> = {}) =>
        runner.run({
          root,
          threadId: "worker-fixture",
          verification: { ...verification, recipe: { ...verification.recipe, ...patch } },
        });
      const passed = yield* run();
      expect(passed.verdict).toBe("pass");
      expect(passed.checks.map((check) => check.code)).toEqual([0, 0]);
      expect(
        yield* Fs.readFileString(
          resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: passed.artifacts[0]!.attachmentId,
          })!,
        ),
      ).toBe("2+3=5");
      expect((yield* git(["status", "--porcelain"])).stdout).toBe("");
      yield* Fs.writeFileString(
        fixtureTool,
        platform === "win32" ? "@exit /b 19\r\n" : "#!/bin/sh\nexit 19\n",
      );
      if (platform !== "win32") yield* Fs.chmod(fixtureTool, 0o755);
      const explicitTestRuntime = yield* run({
        doctor: "fixture-verification-tool",
        artifacts: [],
      });
      expect(explicitTestRuntime.verdict).toBe("pass");
      yield* Fs.writeFileString(Path.join(root, "app.cjs"), "exports.add = (a,b) => a-b;");
      yield* git(["add", "."]);
      yield* git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "Break integration contract",
      ]);
      const brokenSha = (yield* git(["rev-parse", "HEAD"])).stdout.trim();
      const broken = yield* runner.run({
        root,
        threadId: "worker-fixture",
        verification: {
          ...verification,
          candidate: `commit:${brokenSha}`,
          recipe: { ...verification.recipe, artifacts: [] },
        },
      });
      expect(broken.verdict).toBe("fail");
      const missing = yield* run({ doctor: "node missing-dependency.cjs" });
      expect(missing.verdict).toBe("inconclusive");
      expect(missing.checks).toHaveLength(1);
      const missingExecutable = yield* run({ doctor: "missing-verification-executable" });
      expect(missingExecutable.verdict).toBe("inconclusive");
      expect(missingExecutable.summary).toContain("executable is unavailable");
      expect(missingExecutable.checks).toHaveLength(1);
      const failedReadiness = yield* run({ doctor: 'node -e "process.exit(7)"' });
      expect(failedReadiness.verdict).toBe("inconclusive");
      expect(failedReadiness.summary).toContain("readiness command ran and failed");
      const dirty = yield* run({
        verify: "node -e \"require('node:fs').writeFileSync('app.cjs','changed')\"",
        artifacts: [],
      });
      expect(dirty.verdict).toBe("inconclusive");
      const timeout = yield* run({
        verify: 'node -e "for (;;) {}"',
        timeoutSeconds: 1,
        artifacts: [],
      });
      expect(timeout.verdict).toBe("inconclusive");
      expect(timeout.checks.at(-1)?.timedOut).toBe(true);
      const noArtifact = yield* run({ artifacts: ["missing.png"] });
      expect(noArtifact.verdict).toBe("inconclusive");
    }).pipe(
      Effect.provide(
        layer.pipe(
          Layer.provideMerge(processes),
          Layer.provideMerge(layerTest(process.cwd(), { prefix: "verification-config-" })),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);

it.live(
  "checks non-Git research and audio artifacts, blocks changed inputs and missing capabilities, and captures host observations",
  () =>
    Effect.gen(function* () {
      const Fs = yield* FileSystem.FileSystem;
      const Path = yield* Paths.Path;
      const config = yield* ServerConfig;
      const runner = yield* VerificationRunner;
      const platform = yield* HostProcess.Platform;
      const root = yield* Fs.makeTempDirectoryScoped({ prefix: "verification-nongit-" });
      const environmentId = EnvironmentId.make("test-environment");
      yield* Fs.makeDirectory(Path.dirname(config.environmentIdPath), { recursive: true });
      yield* Fs.writeFileString(config.environmentIdPath, environmentId);
      const packet =
        '{"question":"Does the fixture support the claim?","conclusion":"no","sources":[{"url":"https://example.test/fixture","observedAt":"2026-09-13","supports":false}],"unknowns":["External validity"]}';
      yield* Fs.writeFileString(Path.join(root, "research.json"), packet);
      const hash = (bytes: string | Uint8Array) =>
        NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      const recipe: PitbossVerification["recipe"] = {
        projectId: ProjectId.make("project"),
        profileId: "research",
        version: 1,
        name: "Research packet",
        mode: "artifact",
        environmentId,
        inputPath: "research.json",
        doctor: "node --version",
        verify: `node -e "const p=require('./research.json'); if(p.conclusion!=='no'||!p.sources[0].url||!p.unknowns.length) process.exit(1)"`,
        cleanup: "",
        timeoutSeconds: 5,
        artifacts: ["research.json"],
      };
      const run = (
        patch: Partial<PitbossVerification["recipe"]> = {},
        candidate = `sha256:${hash(packet)}`,
      ) =>
        runner.run({
          root,
          threadId: "non-git-worker",
          verification: {
            id: "nongit",
            state: "running",
            attemptId: "attempt",
            criteriaVersion: 1,
            candidate,
            recipe: { ...recipe, ...patch },
            requestedAt: DateTime.formatIso(yieldNow),
          },
        });
      const yieldNow = yield* DateTime.now;
      const sourceBin = Path.join(root, "node_modules", ".bin");
      yield* Fs.makeDirectory(sourceBin, { recursive: true });
      const sourceOnlyTool = Path.join(
        sourceBin,
        platform === "win32" ? "source-only-artifact-tool.cmd" : "source-only-artifact-tool",
      );
      yield* Fs.writeFileString(
        sourceOnlyTool,
        platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
      );
      if (platform !== "win32") yield* Fs.chmod(sourceOnlyTool, 0o755);
      const isolatedArtifactPath = yield* run({
        doctor: "source-only-artifact-tool",
        artifacts: [],
      });
      expect(isolatedArtifactPath.verdict).toBe("inconclusive");
      expect(isolatedArtifactPath.summary).toContain("executable is unavailable");
      const research = yield* run();
      expect(research.verdict).toBe("pass");
      expect(research.subjectDigest).toBe(hash(packet));
      expect(research.artifacts).toHaveLength(1);
      expect(yield* Fs.exists(Path.join(root, ".git"))).toBe(false);
      const wrongHost = yield* run({ environmentId: EnvironmentId.make("offline-other-host") });
      expect(wrongHost.verdict).toBe("inconclusive");
      expect(wrongHost.checks).toHaveLength(0);
      const unavailable = yield* run({ doctor: "node missing-listening-tool.cjs" });
      expect(unavailable.verdict).toBe("inconclusive");
      expect(unavailable.checks).toHaveLength(1);
      const changedCopy = yield* run({
        verify: `node -e "require('node:fs').writeFileSync('research.json','changed')"`,
      });
      expect(changedCopy.verdict).toBe("inconclusive");
      expect(yield* Fs.readFileString(Path.join(root, "research.json"))).toBe(packet);
      yield* Fs.writeFileString(Path.join(root, "research.json"), "new research");
      const stale = yield* run();
      expect(stale.verdict).toBe("inconclusive");
      expect(stale.checks).toHaveLength(0);
      // A binary audio-sized input exercises the same content identity path without claiming listening quality.
      const audio = new Uint8Array(3 * 1024 * 1024);
      audio.set(new TextEncoder().encode("RIFF"));
      yield* Fs.writeFile(Path.join(root, "render.wav"), audio);
      const audioResult = yield* run(
        {
          profileId: "audio",
          inputPath: "render.wav",
          verify: `node -e "if(require('node:fs').readFileSync('render.wav').subarray(0,4).toString()!=='RIFF')process.exit(1)"`,
          artifacts: ["render.wav"],
        },
        `sha256:${hash(audio)}`,
      );
      expect(audioResult.verdict).toBe("pass");
      expect(audioResult.artifacts).toHaveLength(1);
      const retainedAudio = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: audioResult.artifacts[0]!.attachmentId,
      })!;
      expect((yield* Fs.stat(retainedAudio)).size).toBe(BigInt(audio.length));
      yield* Fs.writeFileString(Path.join(root, "service.json"), '{"state":"healthy"}');
      const observe = {
        profileId: "health",
        mode: "observation" as const,
        target: "fixture-service",
        inputPath: "service.json",
        maxAgeSeconds: 60,
        effects: "observe" as const,
        verify: `node -e "if(require('./service.json').state!=='healthy')process.exit(1)"`,
        artifacts: ["service.json"],
      };
      const healthy = yield* run(observe, "observation:fixture-service");
      expect(healthy.verdict).toBe("pass");
      expect(healthy.target).toBe("fixture-service");
      expect(healthy.environmentId).toBe(environmentId);
      expect(Date.parse(healthy.expiresAt!) - Date.parse(healthy.startedAt!)).toBe(60000);
      yield* Fs.writeFileString(Path.join(root, "service.json"), '{"state":"unhealthy"}');
      expect((yield* run(observe, "observation:fixture-service")).verdict).toBe("fail");
      expect(yield* Fs.exists(Path.join(root, "service.json"))).toBe(true);
    }).pipe(
      Effect.provide(
        layer.pipe(
          Layer.provideMerge(processes),
          Layer.provideMerge(layerTest(process.cwd(), { prefix: "verification-nongit-config-" })),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
