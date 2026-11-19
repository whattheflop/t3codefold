// @effect-diagnostics nodeBuiltinImport:off - Exercises the host CLI's evidence gate with disposable report files.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { controllerAudit } from "./controller-navigation.ts";

it("refuses certification when an inventory has no runtime evidence", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "controller-graph-"));
  try {
    expect(await controllerAudit(["inventory", "--out", directory])).toBe(2);
    const report = JSON.parse(await NodeFSP.readFile(NodePath.join(directory, "run.json"), "utf8"));
    expect(report.report.coverage.routeLayouts.expected).toBeGreaterThan(0);
    expect(report.report.coverage.routeLayouts.visited).toBe(0);
    expect(report.report.nodes).toEqual([]);
    expect(report.source.hardware).toBe("UNVERIFIED");
    expect(await controllerAudit(["inventory", "--out", directory, "--partial"])).toBe(0);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
