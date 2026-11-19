export const laneSupervisorSource = String.raw`
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
const directory = path.dirname(process.argv[2]);
const {job, nonce} = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const recordPath = path.join(directory, "status.json");
const socketPath = process.platform === "win32" ? "\\\\.\\pipe\\t3-factory-" + nonce : path.join(os.tmpdir(), "t3-factory-" + nonce + ".sock");
let record = {nonce, phase:"running", status:null, rc:null};
function persist() {
  fs.writeFileSync(recordPath + ".tmp", JSON.stringify(record), {mode:0o600});
  fs.renameSync(recordPath + ".tmp", recordPath);
}
function head() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {cwd:job.cwd, encoding:"utf8"});
  return result.status === 0 ? result.stdout.trim() : null;
}
if (job.frozenHead && head() !== job.frozenHead) {
  record = {...record, phase:"terminal", status:"head_moved"}; persist(); process.exit(0);
}
persist();
const child = spawn(job.argv[0], job.argv.slice(1), {cwd:job.cwd, detached:process.platform !== "win32", stdio:["ignore","pipe","pipe"]});
let cancellation = null;
let killTimer;
function stop(reason) {
  if (cancellation || !child.pid) return;
  cancellation = reason;
  const kill = (signal) => { try { if(process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); } catch {} };
  kill("SIGTERM");
  killTimer = setTimeout(() => kill("SIGKILL"), 5000);
  killTimer.unref();
}
const server = net.createServer(connection => {
  connection.setEncoding("utf8");
  let text = "";
  connection.on("data", chunk => {
    text += chunk;
    if (text.length > 2048) { connection.destroy(); return; }
    if (!text.includes("\n")) return;
    const [given, operation] = text.trim().split(" ");
    if (given !== nonce) { connection.end("forbidden\n"); return; }
    if (operation === "cancel") stop("cancelled");
    connection.end(JSON.stringify(record) + "\n");
  });
});
server.on("error", () => stop("launch_failed"));
server.listen(socketPath);
let outputBytes = 0;
for (const [stream, filename] of [[child.stdout,"stdout.log"],[child.stderr,"stderr.log"]]) {
  stream.on("data", data => {
    const keep = data.subarray(0, Math.max(0, 8 * 1024 * 1024 - outputBytes));
    if (keep.length) fs.appendFileSync(path.join(directory, filename), keep, {mode:0o600});
    outputBytes += keep.length;
  });
}
const timer = setTimeout(() => stop("timeout"), job.timeoutMs);
child.on("error", () => { cancellation = "launch_failed"; });
child.on("close", rc => {
  clearTimeout(timer); if(killTimer) clearTimeout(killTimer);
  record = {...record, phase:"terminal", status:cancellation ?? (job.frozenHead && head() !== job.frozenHead ? "head_moved" : rc === 0 ? "ok" : "failed"), rc};
  persist(); server.close();
});
`;
