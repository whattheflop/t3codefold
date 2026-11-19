// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const {
  finalize,
}: {
  finalize: (
    version: string,
    apk: string,
    options: { deleteOldReleases: boolean; gh: (args: string[]) => string },
  ) => void;
} = NodeModule.createRequire(import.meta.url)("./finalize-fold-release.cjs");

it("keeps native dependency downloads when retiring older app releases", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fold-finalize-test-"));
  const apk = NodePath.join(directory, "test.apk");
  const commands: string[][] = [];
  let staging: string | undefined;
  NodeFS.writeFileSync(apk, "apk fixture");
  try {
    finalize("0.4.13", apk, {
      deleteOldReleases: true,
      gh: (args: string[]) => {
        commands.push(args);
        if (args[0] === "release" && args[1] === "view") {
          return JSON.stringify({
            targetCommitish: "release-commit",
            assets: [{ name: "app.AppImage" }, { name: "app.deb" }],
          });
        }
        if (args[0] === "api" && args[1]?.includes("releases?")) {
          return JSON.stringify([
            [
              { id: 1, tag_name: "fold-native-dependencies", draft: false },
              { id: 2, tag_name: "fold-preview-v0.4.12", draft: false },
              { id: 3, tag_name: "fold-server-latest", draft: false },
            ],
          ]);
        }
        if (args[0] === "release" && args[1] === "upload") {
          staging = NodePath.dirname(args[4]!);
        }
        return "";
      },
    });
    expect(commands.filter((args) => args.includes("DELETE"))).toEqual([
      ["api", "--method", "DELETE", "repos/BreakTheBeta/T3codefold/releases/2"],
    ]);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
    if (staging) NodeFS.rmSync(staging, { recursive: true, force: true });
  }
});
