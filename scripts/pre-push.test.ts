import { assert, describe, it } from "@effect/vitest";

import { newLintErrors, parseAddedLines, planPrePush, type Workspace } from "./pre-push.ts";

const workspaces: ReadonlyArray<Workspace> = [
  { name: "@t3tools/contracts", directory: "packages/contracts", workspaceDependencies: [] },
  {
    name: "@t3tools/shared",
    directory: "packages/shared",
    workspaceDependencies: ["@t3tools/contracts"],
  },
  { name: "@t3tools/web", directory: "apps/web", workspaceDependencies: ["@t3tools/shared"] },
  {
    name: "t3",
    directory: "apps/server",
    workspaceDependencies: ["@t3tools/contracts", "@t3tools/shared"],
  },
  { name: "@t3tools/mobile", directory: "apps/mobile", workspaceDependencies: [] },
  {
    name: "t3-markdown-text",
    directory: "apps/mobile/modules/t3-markdown-text",
    workspaceDependencies: [],
  },
];

describe("planPrePush", () => {
  it("checks the changed workspace and every workspace that depends on it", () => {
    const plan = planPrePush({ changedFiles: ["packages/shared/src/git.ts"], workspaces });
    assert.deepStrictEqual(plan.affected, ["@t3tools/shared", "@t3tools/web", "t3"]);
    assert.deepStrictEqual(plan.typecheck, ["@t3tools/shared"]);
    assert.deepStrictEqual(plan.tests, ["@t3tools/shared", "@t3tools/web"]);
    assert.deepStrictEqual(plan.lintFiles, ["packages/shared/src/git.ts"]);
  });

  it("requires native controller tests for either side of the Android controller bridge", () => {
    for (const file of [
      "apps/mobile/modules/t3-native-controls/android/src/main/java/expo/modules/t3nativecontrols/T3ControllerRouter.kt",
      "apps/mobile/modules/t3-native-controls/android/src/test/java/expo/modules/t3nativecontrols/T3ControllerFocusTest.kt",
      "apps/mobile/src/features/controller/ControllerConsole.tsx",
      "apps/mobile/src/native/T3KeyboardCommands.tsx",
    ]) {
      assert.isTrue(planPrePush({ changedFiles: [file], workspaces }).androidController, file);
    }
    for (const file of [
      "apps/mobile/src/lib/layout.ts",
      "apps/web/src/controller/domController.ts",
      "docs/internals/controller-navigation.md",
    ]) {
      assert.isFalse(planPrePush({ changedFiles: [file], workspaces }).androidController, file);
    }
  });

  it("assigns a nested package's files to that package", () => {
    const plan = planPrePush({
      changedFiles: ["apps/mobile/modules/t3-markdown-text/src/index.ts"],
      workspaces,
    });
    assert.deepStrictEqual(plan.affected, ["t3-markdown-text"]);
  });

  it("checks every workspace when a shared root file changes", () => {
    const plan = planPrePush({ changedFiles: ["pnpm-lock.yaml"], workspaces });
    assert.strictEqual(plan.affected.length, workspaces.length);
    assert.deepStrictEqual(plan.lintFiles, []);
  });

  it("skips documentation and files outside any workspace", () => {
    const plan = planPrePush({
      changedFiles: ["docs/user/install.md", "apps/web/README.md", ".github/workflows/ci.yml"],
      workspaces,
    });
    assert.deepStrictEqual(plan.affected, []);
    assert.deepStrictEqual(plan.lintFiles, []);
  });
});

describe("lint on changed lines", () => {
  const diff = [
    "diff --git a/apps/web/a.tsx b/apps/web/a.tsx",
    "--- a/apps/web/a.tsx",
    "+++ b/apps/web/a.tsx",
    "@@ -10,0 +11,2 @@",
    "+one",
    "+two",
    "@@ -40 +42 @@",
    "-old",
    "+new",
    "diff --git a/apps/web/gone.tsx b/apps/web/gone.tsx",
    "--- a/apps/web/gone.tsx",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
  ].join("\n");

  it("collects the lines each file gains", () => {
    assert.deepStrictEqual([...(parseAddedLines(diff).get("apps/web/a.tsx") ?? [])], [11, 12, 42]);
    assert.isFalse(parseAddedLines(diff).has("apps/web/gone.tsx"));
  });

  it("blocks only errors on added lines", () => {
    const at = (line: number, severity = "error") => ({
      message: "m",
      code: "c",
      severity,
      filename: "apps/web/a.tsx",
      labels: [{ span: { line } }],
    });
    assert.deepStrictEqual(
      newLintErrors([at(5), at(12), at(42, "warning")], parseAddedLines(diff)).map(
        (error) => error.labels[0]!.span.line,
      ),
      [12],
    );
  });
});
