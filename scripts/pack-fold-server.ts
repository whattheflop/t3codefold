#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Standalone release tooling uses Node subprocesses and filesystem staging.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as Schema from "effect/Schema";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";
import pkg from "../apps/server/package.json" with { type: "json" };
import { foldServerPackageSpec } from "../packages/shared/src/foldRelease.ts";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const server = NodePath.join(root, "apps/server");
foldServerPackageSpec(pkg.version);
const output = NodePath.resolve(process.argv[2] ?? NodePath.join(root, "release-assets"));
await NodeFSP.mkdir(output, { recursive: true });
// Service launch/preflight now live in bin.mjs as hidden subcommands. The
// npm bundle still needs the file-backed history worker and served client.
for (const file of ["bin.mjs", "claude-history-worker.mjs", "client/index.html"]) {
  await NodeFSP.access(NodePath.join(server, "dist", file));
}
const staging = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fold-server-package-"));
try {
  const workspace = Schema.decodeSync(
    fromYaml(Schema.Struct({ catalog: Schema.Record(Schema.String, Schema.String) })),
  )(await NodeFSP.readFile(NodePath.join(root, "pnpm-workspace.yaml"), "utf8"));
  const dependencies = resolveCatalogDependencies(
    selectCliRuntimeExternalDependencies(pkg.dependencies),
    workspace.catalog,
    "apps/server",
  );
  for (const spec of Object.values(dependencies)) {
    if (spec.startsWith("catalog:") || spec.startsWith("workspace:")) {
      throw new Error("Resolve native dependency versions before packaging Fold.");
    }
  }
  await NodeFSP.cp(NodePath.join(server, "dist"), NodePath.join(staging, "dist"), {
    recursive: true,
  });
  // The npm install cannot apply workspace patches. Ship fff's patched JS,
  // but resolve its native dependencies on the destination machine.
  const fffRoot = await NodeFSP.realpath(NodePath.join(server, "node_modules/@ff-labs/fff-node"));
  const fffManifest = JSON.parse(
    await NodeFSP.readFile(NodePath.join(fffRoot, "package.json"), "utf8"),
  );
  await NodeFSP.cp(fffRoot, NodePath.join(staging, "node_modules/@ff-labs/fff-node"), {
    recursive: true,
    filter: (source) =>
      !NodePath.relative(fffRoot, source).split(NodePath.sep).includes("node_modules"),
  });
  await NodeFSP.writeFile(
    NodePath.join(staging, "package.json"),
    JSON.stringify(
      {
        name: "t3",
        version: pkg.version,
        type: "module",
        license: pkg.license,
        repository: pkg.repository,
        engines: pkg.engines,
        bin: pkg.bin,
        files: ["dist"],
        dependencies: { ...dependencies, ...fffManifest.dependencies },
        optionalDependencies: fffManifest.optionalDependencies,
        bundledDependencies: ["@ff-labs/fff-node"],
      },
      null,
      2,
    ) + "\n",
  );
  NodeChildProcess.execFileSync("npm", ["pack", "--pack-destination", output], {
    cwd: staging,
    stdio: "inherit",
  });
} finally {
  await NodeFSP.rm(staging, { recursive: true, force: true });
}
