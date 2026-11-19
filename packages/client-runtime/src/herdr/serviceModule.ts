import * as Schema from "effect/Schema";
import { ExecResult, type CoreModule } from "./protocol.ts";
import type { HerdrClient } from "./client.ts";
const decodeExec = Schema.decodeUnknownSync(ExecResult);
const requestScript = `import json,sys,urllib.request,urllib.parse,pathlib
p=json.loads(sys.stdin.read())
u=urllib.parse.urlsplit(p['baseUrl'])
if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost','::1') or u.username or u.password or u.query or u.fragment: raise ValueError('Only a loopback service is allowed')
if not p['path'].startswith('/') or '..' in p['path'].split('/') or '://' in p['path']: raise ValueError('Invalid service path')
h={'Content-Type':'application/json','X-Factory-Client':'panel'}
if p.get('tokenPath'): h['Authorization']='Bearer '+pathlib.Path(p['tokenPath']).expanduser().read_text().strip()
b=None if p['method']=='GET' else json.dumps(p.get('body',{})).encode()
r=urllib.request.Request(p['baseUrl'].rstrip('/')+p['path'],data=b,headers=h,method=p['method'])
o=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with o.open(r,timeout=10) as r:
 data=r.read(1048577)
 if len(data)>1048576: raise ValueError('Service response too large')
 sys.stdout.write(data.decode())
`;
function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export async function moduleRequest(
  client: HerdrClient,
  module: CoreModule,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body: Record<string, unknown> = {},
) {
  const url = new URL(module.baseUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Only explicitly configured loopback factory services are supported.");
  const result = decodeExec(
    await client.request(
      "machine.exec",
      {
        argv: ["python3", "-c", requestScript],
        input: base64(
          JSON.stringify({
            baseUrl: module.baseUrl,
            tokenPath: module.tokenPath,
            method,
            path,
            body,
          }),
        ),
        timeout: 15,
      },
      method !== "GET",
    ),
  );
  if (result.code !== 0 || result.timed_out || result.truncated)
    throw new Error("Factory service request failed. Verify its state before repeating a write.");
  const raw = Uint8Array.from(atob(result.stdout), (char) => char.charCodeAt(0));
  const envelope: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !("ok" in envelope) ||
    envelope.ok !== true ||
    !("data" in envelope)
  )
    throw new Error("Factory service returned an invalid response.");
  return envelope.data;
}
