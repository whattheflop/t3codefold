import * as Schema from "effect/Schema";
import type { HerdrClient } from "./client.ts";
import { ExecResult } from "./protocol.ts";
import type { TranscriptProvider } from "./transcript.ts";

const decodeExec = Schema.decodeUnknownSync(ExecResult);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;

// Provider session ids are unique, so a glob over each provider's default store finds the file
// without reproducing Claude's cwd-slug rules. Newest match wins if a session was copied.
const resolveScript = `import json,os,sys,glob,pathlib
q=json.loads(sys.stdin.read())
home=pathlib.Path.home()
claude=pathlib.Path(os.environ.get('CLAUDE_CONFIG_DIR') or home/'.claude')/'projects'
codex=pathlib.Path(os.environ.get('CODEX_HOME') or home/'.codex')/'sessions'
out={}
for s in q:
 i=s['id']
 pat=str(claude/'*'/(i+'.jsonl')) if s['provider']=='claude' else str(codex/'*'/'*'/'*'/('rollout-*-'+i+'.jsonl'))
 m=sorted(glob.glob(pat),key=os.path.getmtime)
 if m: out[i]=m[-1]
sys.stdout.write(json.dumps(out))
`;

export interface TranscriptQuery {
  readonly id: string;
  readonly provider: TranscriptProvider;
}

export function transcriptProvider(name: string | null | undefined): TranscriptProvider | null {
  const base = name?.split("/").pop()?.toLowerCase();
  return base === "claude" || base === "codex" ? base : null;
}

export function isSessionId(value: string | null | undefined): value is string {
  return !!value && SESSION_ID.test(value);
}

export async function resolveTranscripts(
  client: HerdrClient,
  queries: readonly TranscriptQuery[],
): Promise<ReadonlyMap<string, string>> {
  const valid = queries.filter((query) => isSessionId(query.id));
  if (valid.length === 0 || !client.supports("machine.exec")) return new Map();
  const input = new TextEncoder().encode(JSON.stringify(valid));
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  const result = decodeExec(
    await client.request("machine.exec", {
      argv: ["python3", "-c", resolveScript],
      input: btoa(binary),
      timeout: 10,
    }),
  );
  if (result.code !== 0 || result.timed_out || result.truncated) return new Map();
  const raw = Uint8Array.from(atob(result.stdout), (char) => char.charCodeAt(0));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
  const found = new Map<string, string>();
  if (parsed && typeof parsed === "object")
    for (const [id, path] of Object.entries(parsed))
      if (typeof path === "string" && path.startsWith("/") && path.endsWith(".jsonl"))
        found.set(id, path);
  return found;
}
