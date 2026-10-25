// @effect-diagnostics-next-line nodeBuiltinImport:off -- Artifact digests are computed synchronously over in-memory bytes.
import * as NodeCrypto from "node:crypto";
import { EnvironmentId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import * as Paths from "effect/Path";
import type { PitbossVerification, PitbossVerificationReceipt } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProcessRunner } from "../processRunner.ts";
import { ServerConfig } from "../config.ts";
import { createAttachmentId, parseAttachmentFileExtension } from "../attachmentStore.ts";
import { interruptedReceipt } from "./Verification.ts";

export class VerificationRunner extends Context.Service<
  VerificationRunner,
  {
    run: (input: {
      root: string;
      threadId: string;
      verification: PitbossVerification;
    }) => Effect.Effect<PitbossVerificationReceipt>;
  }
>()("t3/pitboss/VerificationRunner") {}

/** Isolate code and artifact candidates; observations run on the explicitly approved host target. */
export const layer = Layer.effect(
  VerificationRunner,
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const Fs = yield* FileSystem.FileSystem;
    const Path = yield* Paths.Path;
    const processRunner = yield* ProcessRunner;
    const config = yield* ServerConfig;
    return VerificationRunner.of({
      run: Effect.fn("VerificationRunner.run")(
        function* (input) {
          const { recipe, candidate } = input.verification;
          const mode = recipe.mode ?? "commit";
          const started = yield* DateTime.now;
          const startedAt = DateTime.formatIso(started);
          const environmentText = yield* Fs.readFileString(config.environmentIdPath).pipe(
            Effect.orElseSucceed(() => ""),
          );
          const environmentId = environmentText.trim()
            ? EnvironmentId.make(environmentText.trim())
            : undefined;
          if (recipe.environmentId && recipe.environmentId !== environmentId)
            return interruptedReceipt(
              "Blocked: this profile requires another environment. Run it at the approved task home; no host commands were executed.",
            );
          let subjectDigest: string | undefined;
          const checks: Array<PitbossVerificationReceipt["checks"][number]> = [];
          const artifacts: Array<PitbossVerificationReceipt["artifacts"][number]> = [];
          const temporary = yield* Fs.makeTempDirectory({ prefix: "t3-verification-" });
          const checkout =
            mode === "observation"
              ? yield* Fs.realPath(input.root)
              : Path.join(temporary, "checkout");
          const sourceRoot = yield* Fs.realPath(input.root);
          const pathSeparator = platform === "win32" ? ";" : ":";
          const commitEnvironment =
            mode === "commit"
              ? {
                  NODE_ENV: "test",
                  PATH: [
                    Path.join(checkout, "node_modules", ".bin"),
                    Path.join(sourceRoot, "node_modules", ".bin"),
                    process.env.PATH,
                  ]
                    .filter(Boolean)
                    .join(pathSeparator),
                }
              : {};
          const digest = (bytes: Uint8Array) =>
            NodeCrypto.createHash("sha256").update(bytes).digest("hex");
          const inputFile = Effect.fn("VerificationRunner.input")(function* (
            root: string,
            name: string,
          ) {
            const real = yield* Fs.realPath(Path.resolve(root, name));
            const relative = Path.relative(root, real);
            if (!relative || relative.startsWith("..") || Path.isAbsolute(relative))
              throw new Error("Input must stay inside the approved workspace");
            const stat = yield* Fs.stat(real);
            if (stat.type !== "File" || stat.size > BigInt(100 * 1024 * 1024))
              throw new Error("Input must be a file no larger than 100 MiB");
            return yield* Fs.readFile(real);
          });
          let verdict: PitbossVerificationReceipt["verdict"] = "inconclusive";
          let summary = "Verification could not start.";
          const git = (args: string[], cwd = input.root) =>
            processRunner.run({
              command: "git",
              args,
              cwd,
              timeout: "30 seconds",
              timeoutBehavior: "timedOutResult",
              maxOutputBytes: 4096,
              outputMode: "truncate",
            });
          const shell = Effect.fn("VerificationRunner.check")(function* (
            name: string,
            command: string,
          ) {
            const result = yield* processRunner.run({
              command: platform === "win32" ? "cmd.exe" : "/bin/sh",
              args: platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
              cwd: checkout,
              timeout: `${recipe.timeoutSeconds} seconds`,
              timeoutBehavior: "timedOutResult",
              maxOutputBytes: 4096,
              outputMode: "truncate",
              env: {
                ...process.env,
                ...commitEnvironment,
                T3_VERIFICATION_ID: input.verification.id,
                T3_VERIFICATION_CANDIDATE: candidate,
                T3_VERIFICATION_MODE: mode,
                T3_VERIFICATION_TARGET: recipe.target ?? "",
                T3_VERIFICATION_INPUT: recipe.inputPath ?? "",
                T3_VERIFICATION_EFFECTS: recipe.effects ?? "host-commands",
              },
            });
            checks.push({
              name,
              command,
              code: result.code,
              timedOut: result.timedOut,
              stdout: result.stdout.slice(0, 4096),
              stderr: result.stderr.slice(0, 4096),
            });
            return result;
          });
          const execute = Effect.gen(function* () {
            if (mode === "commit") {
              if (!/^commit:[0-9a-f]{40}$/.test(candidate)) return;
              const cloned = yield* git([
                "clone",
                "--quiet",
                "--shared",
                "--no-checkout",
                "--",
                input.root,
                checkout,
              ]);
              if (cloned.code !== 0) {
                summary = "Blocked: isolated checkout could not be created.";
                return;
              }
              const checked = yield* git(
                ["checkout", "--quiet", "--detach", candidate.slice(7)],
                checkout,
              );
              if (checked.code !== 0) {
                summary = "Blocked: candidate commit is unavailable in the project repository.";
                return;
              }
            } else if (mode === "artifact") {
              if (!recipe.inputPath) throw new Error("Artifact profile has no input file");
              const bytes = yield* inputFile(sourceRoot, recipe.inputPath);
              subjectDigest = digest(bytes);
              if (candidate !== `sha256:${subjectDigest}`)
                throw new Error("Input changed: submit its current SHA-256 before verification");
              yield* Fs.makeDirectory(Path.dirname(Path.join(checkout, recipe.inputPath)), {
                recursive: true,
              });
              yield* Fs.writeFile(Path.join(checkout, recipe.inputPath), bytes);
            } else {
              if (
                !recipe.environmentId ||
                !recipe.target ||
                !recipe.maxAgeSeconds ||
                !recipe.effects ||
                candidate !== `observation:${recipe.target}`
              )
                throw new Error(
                  "Observation requires an approved environment, target, freshness and effect policy",
                );
              if (recipe.inputPath)
                subjectDigest = digest(yield* inputFile(sourceRoot, recipe.inputPath));
            }
            const doctor = yield* shell("Readiness", recipe.doctor);
            if (doctor.code !== 0 || doctor.timedOut) {
              const missingExecutable =
                doctor.code === 127 ||
                doctor.code === 9009 ||
                /(?:command not found|not recognized as an internal or external command)/i.test(
                  `${doctor.stdout}\n${doctor.stderr}`,
                );
              summary = doctor.timedOut
                ? "Blocked: readiness timed out before verification started."
                : missingExecutable
                  ? "Blocked: a readiness executable is unavailable on the verification PATH. The saved recipe was not weakened and verification did not run."
                  : "Blocked: the readiness command ran and failed. Repair the reported environment condition before retrying; verification did not run.";
              return;
            }
            const test = yield* shell("Verification", recipe.verify);
            verdict = test.timedOut ? "inconclusive" : test.code === 0 ? "pass" : "fail";
            summary = test.timedOut
              ? "Blocked: verification timed out."
              : test.code === 0
                ? "The approved recipe passed. Lead review and coverage assessment are still required."
                : "The candidate failed the approved verification recipe.";
            if (mode === "commit") {
              const head = yield* git(["rev-parse", "HEAD"], checkout);
              const diff = yield* git(["diff", "--quiet", "HEAD", "--"], checkout);
              if (head.stdout.trim() !== candidate.slice(7) || diff.code !== 0) {
                verdict = "inconclusive";
                summary =
                  "Verification changed the candidate's tracked files or commit; commit the changes and verify again.";
              }
            }
            if (recipe.inputPath && mode !== "commit") {
              const after = digest(yield* inputFile(sourceRoot, recipe.inputPath));
              const checked =
                mode === "artifact" ? digest(yield* inputFile(checkout, recipe.inputPath)) : after;
              if (after !== subjectDigest || checked !== subjectDigest) {
                verdict = "inconclusive";
                summary = "Input changed during verification; submit a fresh candidate.";
              }
            }
            for (const name of recipe.artifacts) {
              const source = Path.resolve(checkout, name);
              const relative = Path.relative(checkout, source);
              if (!relative || relative.startsWith("..") || Path.isAbsolute(relative))
                throw new Error("Artifact escapes checkout");
              const real = yield* Fs.realPath(source);
              const realRelative = Path.relative(checkout, real);
              if (realRelative.startsWith("..") || Path.isAbsolute(realRelative))
                throw new Error("Artifact symlink escapes checkout");
              const stat = yield* Fs.stat(real);
              if (stat.type !== "File" || stat.size > BigInt(100 * 1024 * 1024))
                throw new Error("Artifact must be a file no larger than 100 MiB");
              const attachmentId = createAttachmentId(input.threadId, Path.extname(name).slice(1));
              if (!attachmentId) throw new Error("Invalid attachment owner");
              yield* Fs.makeDirectory(config.attachmentsDir, { recursive: true });
              yield* Fs.copyFile(
                real,
                Path.join(
                  config.attachmentsDir,
                  `${attachmentId}.${parseAttachmentFileExtension(attachmentId) ?? "bin"}`,
                ),
              );
              artifacts.push({ name, attachmentId });
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                verdict = "inconclusive";
                summary = `Blocked: verification infrastructure or required artifact unavailable. ${String(cause).slice(0, 600)}`;
              }),
            ),
          );
          yield* execute.pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                if (
                  recipe.cleanup &&
                  (yield* Fs.exists(checkout).pipe(Effect.orElseSucceed(() => false)))
                ) {
                  yield* shell("Cleanup", recipe.cleanup).pipe(
                    Effect.tap((result) =>
                      Effect.sync(() => {
                        if (result.code !== 0 || result.timedOut) {
                          verdict = "inconclusive";
                          summary = "Blocked: cleanup failed; inspect the receipt before retrying.";
                        }
                      }),
                    ),
                    Effect.catchCause(() =>
                      Effect.sync(() => {
                        verdict = "inconclusive";
                        summary = "Blocked: cleanup could not run.";
                      }),
                    ),
                  );
                }
                if (subjectDigest && recipe.inputPath && mode !== "commit") {
                  yield* inputFile(sourceRoot, recipe.inputPath).pipe(
                    Effect.tap((bytes) =>
                      Effect.sync(() => {
                        if (digest(bytes) !== subjectDigest) {
                          verdict = "inconclusive";
                          summary =
                            "Input changed before verification finished; capture a new candidate.";
                        }
                      }),
                    ),
                    Effect.catchCause(() =>
                      Effect.sync(() => {
                        verdict = "inconclusive";
                        summary = "Input is unavailable after cleanup; capture a new candidate.";
                      }),
                    ),
                  );
                }
                yield* Fs.remove(temporary, { recursive: true, force: true }).pipe(
                  Effect.catchCause(Effect.logWarning),
                );
              }),
            ),
          );
          return {
            verdict,
            summary,
            checks,
            artifacts,
            ...(environmentId ? { environmentId } : {}),
            ...(subjectDigest ? { subjectDigest } : {}),
            ...(recipe.target ? { target: recipe.target } : {}),
            startedAt,
            ...(recipe.maxAgeSeconds
              ? {
                  expiresAt: DateTime.formatIso(
                    DateTime.add(started, { seconds: recipe.maxAgeSeconds }),
                  ),
                }
              : {}),
            finishedAt: DateTime.formatIso(yield* DateTime.now),
          };
        },
        Effect.catchCause((cause) =>
          Effect.succeed(
            interruptedReceipt(`Verification unavailable: ${String(cause).slice(0, 600)}`),
          ),
        ),
      ),
    });
  }),
);
