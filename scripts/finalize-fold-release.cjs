#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const repository = "whattheflop/T3codefold";
const feeds = new Set([
  "fold-server-latest",
  "fold-server-nightly",
  "fold-desktop-latest",
  "fold-desktop-nightly",
  "mobile-ota",
  "android-nightly",
]);

/** Complete one Linux/Android release, retaining the URLs installed clients use. */
function finalize(version, apk, { dryRun = false, deleteOldReleases = false, gh = runGh } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !apk?.endsWith(".apk")) {
    throw new Error(
      "Usage: finalize-fold-release.cjs <stable-version> <verified-apk-path> [--dry-run] [--delete-old-releases]",
    );
  }
  const apkPath = path.resolve(apk);
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(apkPath)).digest("hex");
  const tag = `fold-preview-v${version}`;
  const release = JSON.parse(gh(["release", "view", tag, "--json", "assets,targetCommitish"]));
  const server = JSON.parse(
    gh(["release", "view", `fold-server-v${version}`, "--json", "targetCommitish"]),
  );
  if (release.targetCommitish !== server.targetCommitish) {
    throw new Error("Desktop and server releases must belong to the same commit.");
  }
  const linux = release.assets.find((asset) => asset.name.endsWith(".AppImage"));
  const deb = release.assets.find((asset) => asset.name.endsWith(".deb"));
  if (!linux || !deb)
    throw new Error("Both Linux AppImage and Debian package must be published first.");
  const pages = JSON.parse(
    gh(["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"]),
  );
  const releases = pages.flat();
  const parts = version.split(".").map(Number);
  const newer = releases.some((item) => {
    if (item.draft) return false;
    const match = /^fold-(?:preview|server)-v(\d+)\.(\d+)\.(\d+)$/.exec(item.tag_name);
    if (!match) return false;
    const other = match.slice(1).map(Number);
    for (let i = 0; i < 3; i++) {
      if (other[i] !== parts[i]) return other[i] > parts[i];
    }
    return false;
  });
  if (newer) throw new Error("Refusing to replace a newer public release with an older version.");
  const archive = releases.filter(
    (item) =>
      !item.draft &&
      item.tag_name !== tag &&
      item.tag_name !== `fold-server-v${version}` &&
      !feeds.has(item.tag_name),
  );
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  const apkName = path.basename(apkPath);
  if (!/^[A-Za-z0-9._-]+\.apk$/.test(apkName))
    throw new Error(
      "Use an APK filename containing letters, numbers, dots, underscores or hyphens.",
    );
  const notes = [
    `Download T3 Code Fold ${version}:`,
    "",
    `- **Linux:** [AppImage](${base}/${linux.name}) · [Debian / Ubuntu](${base}/${deb.name})`,
    `- **Android:** [APK](${base}/${apkName})`,
    "",
    "Install the APK over your existing Fold app; keep the same signing certificate.",
    "The APK includes its JavaScript bundle and does not need Metro.",
    "",
    "Android checksum: `SHA256SUMS-android.txt`. Server packages are published separately for CLI updates.",
  ].join("\n");
  if (dryRun) {
    console.log(notes);
    console.log(
      `\n${deleteOldReleases ? "Delete" : "Archive as drafts"} ${archive.length} old releases: ${archive.map((item) => item.tag_name).join(", ")}`,
    );
    return;
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "fold-release-"));
  fs.writeFileSync(path.join(staging, "release-backup.json"), JSON.stringify(releases, null, 2));
  const checksumPath = path.join(staging, "SHA256SUMS-android.txt");
  fs.writeFileSync(checksumPath, `${checksum}  ${apkName}\n`);
  const notesPath = path.join(staging, "notes.md");
  fs.writeFileSync(notesPath, notes);
  gh(["release", "upload", tag, apkPath, checksumPath, "--clobber"]);
  gh([
    "release",
    "edit",
    tag,
    "--title",
    `T3 Code Fold ${version} — Linux & Android`,
    "--notes-file",
    notesPath,
    "--draft=false",
    "--prerelease=false",
    "--latest",
  ]);
  for (const item of archive) {
    gh(
      deleteOldReleases
        ? ["api", "--method", "DELETE", `repos/${repository}/releases/${item.id}`]
        : [
            "api",
            "--method",
            "PATCH",
            `repos/${repository}/releases/${item.id}`,
            "-F",
            "draft=true",
          ],
    );
  }
  console.log(
    `Published ${tag}; ${deleteOldReleases ? "deleted" : "archived"} ${archive.length} releases. Metadata backup: ${staging}/release-backup.json`,
  );
}

function runGh(args) {
  // `gh api` infers POST when fields are present, so callers set PATCH explicitly.
  return execFileSync("gh", args[0] === "api" ? args : [...args, "--repo", repository], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

module.exports = { finalize };
if (require.main === module) {
  const [version, apk] = process.argv.slice(2);
  finalize(version, apk, {
    dryRun: process.argv.includes("--dry-run"),
    deleteOldReleases: process.argv.includes("--delete-old-releases"),
  });
}
