// Windows runner temp paths use 8.3 names; canonicalize before equality checks.
// Load built-ins through process so browser test setup works before jsdom exists.
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
