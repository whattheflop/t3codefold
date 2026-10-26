// @effect-diagnostics nodeBuiltinImport:off - Exercises Git remote discovery in isolated repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { resolveReleaseRepository } from "./release-repository.ts";

it("uses the checkout's origin for HTTPS and SSH remotes", () => {
  const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-release-origin-"));
  using _cleanup = {
    [Symbol.dispose]: () => NodeFS.rmSync(repoRoot, { recursive: true, force: true }),
  };
  NodeChildProcess.execFileSync("git", ["init", "--quiet", repoRoot]);
  for (const remote of [
    "https://github.com/example/my-fork.git",
    "git@github.com:example/my-fork.git",
    "ssh://git@github.com/example/my-fork.git",
  ]) {
    NodeChildProcess.execFileSync("git", ["-C", repoRoot, "config", "remote.origin.url", remote]);
    expect(resolveReleaseRepository({ repoRoot, env: {} })).toBe("example/my-fork");
  }
});

it("supports explicit and CI repositories without a Git checkout", () => {
  expect(resolveReleaseRepository({ env: { GITHUB_REPOSITORY: "example/ci-fork" } })).toBe(
    "example/ci-fork",
  );
  expect(
    resolveReleaseRepository({
      env: {
        T3CODE_RELEASE_REPOSITORY: "https://github.com/example/release-fork.git",
        GITHUB_REPOSITORY: "example/ci-fork",
      },
    }),
  ).toBe("example/release-fork");
});

it("rejects unsupported hosts and invalid repository overrides", () => {
  for (const repository of [
    "https://git.cafe/example/fork",
    "example/fork/releases",
    "../fork",
    "example/repo;echo",
  ]) {
    expect(() =>
      resolveReleaseRepository({ env: { T3CODE_RELEASE_REPOSITORY: repository } }),
    ).toThrow();
  }
});
