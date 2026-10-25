const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { finalize } = require("../../scripts/finalize-fold-release.cjs");

function fixture(t, { missingDeb = false, mismatchedCommit = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fold-release-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const apk = path.join(directory, "Fold-Android.apk");
  fs.writeFileSync(apk, "verified APK fixture");
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "release" && args[1] === "view") {
      return JSON.stringify({
        targetCommitish: mismatchedCommit && args[2].startsWith("fold-server") ? "other" : "commit",
        assets: [{ name: "Fold.AppImage" }, ...(!missingDeb ? [{ name: "Fold.deb" }] : [])],
      });
    }
    if (args[0] === "api" && args[1].includes("?")) {
      return JSON.stringify([
        [
          { id: 1, tag_name: "fold-preview-v0.4.4" },
          { id: 2, tag_name: "fold-server-v0.4.4" },
          { id: 3, tag_name: "fold-desktop-latest" },
          { id: 4, tag_name: "mobile-ota" },
          { id: 5, tag_name: "fold-android-v1.4.2" },
          { id: 6, tag_name: "fold-preview-v0.4.3" },
          { id: 7, tag_name: "evidence", draft: true },
        ],
        [{ id: 8, tag_name: "pr-99-ui-evidence" }],
      ]);
    }
    if (args[1] === "upload") {
      assert.match(fs.readFileSync(args[4], "utf8"), /^[a-f0-9]{64}  Fold-Android.apk\n$/);
      t.after(() => fs.rmSync(path.dirname(args[4]), { recursive: true, force: true }));
    }
    if (args[1] === "edit") {
      const notes = fs.readFileSync(args[args.indexOf("--notes-file") + 1], "utf8");
      assert.match(notes, /Linux.*Fold.AppImage.*Fold.deb/);
      assert.match(notes, /Android.*Fold-Android.apk/);
      assert.ok(args.includes("--latest"));
    }
    return "";
  };
  return { apk, calls, gh };
}

test("publishes both platforms before archiving, preserves current server and feeds, includes all pages", (t) => {
  const { apk, calls, gh } = fixture(t);
  finalize("0.4.4", apk, { gh });
  const patches = calls.filter((args) => args.includes("PATCH"));
  assert.deepEqual(
    patches.map((args) => args[3]),
    [
      "repos/whattheflop/T3codefold/releases/5",
      "repos/whattheflop/T3codefold/releases/6",
      "repos/whattheflop/T3codefold/releases/8",
    ],
  );
  assert.ok(
    calls.findIndex((args) => args[1] === "edit") <
      calls.findIndex((args) => args.includes("PATCH")),
  );
});

test("dry run performs no GitHub mutations", (t) => {
  const { apk, calls, gh } = fixture(t);
  finalize("0.4.4", apk, { gh, dryRun: true });
  assert.equal(calls.length, 3);
});

for (const options of [{ missingDeb: true }, { mismatchedCommit: true }]) {
  test(`refuses incomplete or mismatched release: ${JSON.stringify(options)}`, (t) => {
    const { apk, calls, gh } = fixture(t, options);
    assert.throws(() => finalize("0.4.4", apk, { gh }));
    assert.ok(calls.every((args) => args[1] === "view"));
  });
}

test("refuses to archive a newer public release", (t) => {
  const { apk, calls, gh } = fixture(t);
  const withNewerRelease = (args) => {
    const result = gh(args);
    return args[0] === "api"
      ? JSON.stringify([[{ tag_name: "fold-preview-v0.5.0", draft: false }]])
      : result;
  };
  assert.throws(() => finalize("0.4.4", apk, { gh: withNewerRelease }), /newer public release/);
  assert.equal(calls.length, 3);
});

test("an upload failure leaves all public releases visible", (t) => {
  const { apk, calls, gh } = fixture(t);
  const failingUpload = (args) => {
    const result = gh(args);
    if (args[1] === "upload") throw new Error("upload failed");
    return result;
  };
  assert.throws(() => finalize("0.4.4", apk, { gh: failingUpload }), /upload failed/);
  assert.ok(!calls.some((args) => args.includes("PATCH") || args[1] === "edit"));
});

test("permanent cleanup deletes only former public releases after publishing both platforms", (t) => {
  const { apk, calls, gh } = fixture(t);
  finalize("0.4.4", apk, { gh, deleteOldReleases: true });
  const deletions = calls.filter((args) => args.includes("DELETE"));
  assert.deepEqual(
    deletions.map((args) => args[3]),
    [
      "repos/whattheflop/T3codefold/releases/5",
      "repos/whattheflop/T3codefold/releases/6",
      "repos/whattheflop/T3codefold/releases/8",
    ],
  );
  assert.ok(!calls.some((args) => args.includes("PATCH")));
  assert.ok(
    calls.findIndex((args) => args[1] === "edit") <
      calls.findIndex((args) => args.includes("DELETE")),
  );
});
