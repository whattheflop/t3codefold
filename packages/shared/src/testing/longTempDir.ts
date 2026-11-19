// Windows runner temp paths use 8.3 names; canonicalize to long names before equality checks.
// Built-ins come through the process, not static `node:` imports, so browser-environment
// tests can load this setup before Vitest creates jsdom.
const NodeProcess = process.getBuiltinModule("node:process");
if (NodeProcess.platform === "win32") {
  try {
    const NodeFS = process.getBuiltinModule("node:fs");
    const NodeOS = process.getBuiltinModule("node:os");
    const longForm = NodeFS.realpathSync.native(NodeOS.tmpdir());
    process.env.TEMP = longForm;
    process.env.TMP = longForm;
  } catch {}
}
