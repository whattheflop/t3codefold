// @effect-diagnostics nodeBuiltinImport:off - Core uses Unix sockets and SSH stdio rather than HTTP.
import * as NodeNet from "node:net";
import * as NodeChildProcess from "node:child_process";

// Relays raw bytes both ways over one Core socket connection: JSON lines, or frames once attached.
const remoteSocketScript = `import os,socket,sys,threading
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.connect(sys.argv[1])
def up():
 while True:
  d=os.read(0,65536)
  if not d: break
  s.sendall(d)
 s.shutdown(socket.SHUT_WR)
threading.Thread(target=up,daemon=True).start()
while True:
 d=s.recv(65536)
 if not d: break
 sys.stdout.buffer.write(d)
 sys.stdout.buffer.flush()
`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function herdrSshArgs(host: string, socketPath: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(host))
    throw new Error("Choose a valid SSH host alias.");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "--",
    host,
    `python3 -u -c ${quote(remoteSocketScript)} ${quote(socketPath)}`,
  ];
}

export interface CoreTarget {
  readonly socketPath: string;
  readonly sshHost?: string | undefined;
}

/** A byte pipe to a Core socket, directly or through SSH; `onLost` fires on any failure or end. */
export function openCorePipe(target: CoreTarget, onLost: (error: Error) => void) {
  const child = target.sshHost
    ? NodeChildProcess.spawn("ssh", herdrSshArgs(target.sshHost, target.socketPath), {
        stdio: ["pipe", "pipe", "ignore"],
      })
    : null;
  const socket = child ? null : NodeNet.connect(target.socketPath);
  const output = child?.stdout ?? socket!;
  const writer = child?.stdin ?? socket!;
  output.on("error", () => onLost(new Error("Core socket failed.")));
  output.on("end", () => onLost(new Error("Core closed the connection.")));
  writer.on("error", () => onLost(new Error("Core request could not be written.")));
  child?.on("error", () => onLost(new Error("SSH could not start.")));
  child?.on("close", () => onLost(new Error("SSH disconnected.")));
  return {
    output,
    writer,
    dispose: () => {
      socket?.destroy();
      child?.kill();
    },
  };
}
