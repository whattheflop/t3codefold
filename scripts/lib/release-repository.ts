// @effect-diagnostics nodeBuiltinImport:off - Bundler configuration resolves Git metadata before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

export function resolveReleaseRepository({
  repoRoot = NodeURL.fileURLToPath(new URL("../..", import.meta.url)),
  env = process.env,
}: {
  readonly repoRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
} = {}): string {
  const configured =
    env.T3CODE_RELEASE_REPOSITORY?.trim() ||
    env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    env.GITHUB_REPOSITORY?.trim();
  const remote =
    configured ||
    NodeChildProcess.execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const repository = remote
    .replace(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)/i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) ||
    repository.split("/")[1] === ".."
  ) {
    throw new Error(
      "Release assets require a GitHub repository. Set T3CODE_RELEASE_REPOSITORY to owner/repository.",
    );
  }
  return repository;
}
