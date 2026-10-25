#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Standalone release tooling uses Node subprocesses and filesystem staging.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

const [directory, requestedTag, version] = process.argv.slice(2);
const tag = requestedTag || `fold-preview-v${version}`;
if (!directory || !tag || !version || !tag.startsWith("fold-preview-v")) {
  throw new Error("Usage: publish-fold-desktop.ts <directory> <fold-preview-vVERSION> <version>");
}
const repository = "whattheflop/T3codefold";
const channel = version.includes("-nightly.") ? "nightly" : "latest";
const assets = (await NodeFSP.readdir(directory))
  .filter(
    (file) =>
      file !== "builder-debug.yml" && /\.(?:yml|exe|dmg|zip|deb|AppImage|blockmap)$/.test(file),
  )
  .map((file) => NodePath.resolve(directory, file));
if (!assets.some((file) => file.endsWith(".yml")))
  throw new Error("Desktop update metadata is missing.");
function gh(args: string[]) {
  return NodeChildProcess.execFileSync("gh", [...args, "--repo", repository], {
    stdio: "pipe",
    encoding: "utf8",
  });
}
const releaseTags = process.argv.includes("--manual-only")
  ? [tag]
  : [tag, `fold-desktop-${channel}`];
for (const releaseTag of releaseTags) {
  try {
    gh(["release", "view", releaseTag]);
  } catch {
    try {
      gh([
        "release",
        "create",
        releaseTag,
        "--verify-tag",
        "--target",
        process.env.GITHUB_SHA ?? "main",
        "--title",
        `Fold desktop ${releaseTag === tag ? version : channel}`,
        "--notes",
        "Fold desktop installers and automatic update feed.",
        "--prerelease",
      ]);
    } catch {
      // Platform jobs can create the shared release concurrently.
      gh(["release", "view", releaseTag]);
    }
  }
  gh(["release", "upload", releaseTag, ...assets, ...(releaseTag === tag ? [] : ["--clobber"])]);
}
