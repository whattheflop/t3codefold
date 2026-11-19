// @effect-diagnostics nodeBuiltinImport:off - Standalone GitHub release tooling.
// Create tags before long builds, while GITHUB_TOKEN can still tag the source
// commit. Publishing later uses --verify-tag and never tags a newer commit.
import * as NodeChildProcess from "node:child_process";

const [versionTag, channelTag] = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA;
if (!repository || !commit || !versionTag || !/^fold-[A-Za-z0-9.+-]+$/.test(versionTag)) {
  throw new Error("Expected GITHUB_REPOSITORY, GITHUB_SHA, and a Fold version tag.");
}
if (channelTag && !/^fold-(?:server|desktop)-(?:latest|nightly)$/.test(channelTag)) {
  throw new Error("Invalid rolling release tag.");
}
for (const tag of [versionTag, ...(channelTag ? [channelTag] : [])]) {
  const result = NodeChildProcess.spawnSync(
    "gh",
    ["api", `repos/${repository}/git/ref/tags/${tag}`],
    {
      encoding: "utf8",
    },
  );
  if (result.status === 0) {
    if (tag === versionTag) {
      const taggedCommit = NodeChildProcess.execFileSync(
        "gh",
        ["api", `repos/${repository}/commits/${tag}`, "--jq", ".sha"],
        { encoding: "utf8" },
      ).trim();
      if (taggedCommit !== commit) throw new Error(`${tag} already belongs to another commit.`);
    }
    continue;
  }
  if (!result.stderr.includes("HTTP 404"))
    throw new Error(result.stderr || "Cannot read release tag.");
  NodeChildProcess.execFileSync(
    "gh",
    [
      "api",
      `repos/${repository}/git/refs`,
      "--method",
      "POST",
      "-f",
      `ref=refs/tags/${tag}`,
      "-f",
      `sha=${commit}`,
    ],
    { stdio: "inherit" },
  );
}
