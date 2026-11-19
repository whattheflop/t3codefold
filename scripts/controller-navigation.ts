#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off globalConsole:off - host-side native acceptance runner and report generation.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { WebSocket } from "@effect/platform-node/NodeWS";
import {
  controllerFacts,
  controllerFailures,
  controllerJourneys,
  controllerStateContract,
  type ControllerCapture,
  type ControllerExpectation,
  type ControllerJourney,
} from "./mobile-behavior/controller-contract.ts";
import {
  buildControllerGraph,
  type GraphCase,
  type GraphState,
} from "./mobile-behavior/controller-graph.ts";
import { controllerRoutes } from "./mobile-behavior/controller-inventory.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const inputNames: Record<string, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  l1: "LB",
  r1: "RB",
  l2: "LT",
  r2: "RT",
  start: "START",
  select: "VIEW",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
};
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function graphState(value: ControllerCapture): GraphState {
  const facts = controllerFacts(value);
  const state = value.controller;
  const region = state.scene.regions.find((entry) => entry.id === state.position?.regionId);
  const controls = new Map(
    state.scene.targets.map((target) => [
      target.id,
      `${target.kind}:${hash(target.id).slice(0, 12)}`,
    ]),
  );
  return {
    page: facts.page,
    layout: facts.layout === "split" ? "split" : "compact",
    scope:
      facts.scope === "overlay" ? `overlay:${hash(state.scopeId ?? "").slice(0, 8)}` : facts.scope,
    region: region ? `${region.kind}:${hash(region.id).slice(0, 8)}` : null,
    pane: facts.pane,
    target: state.position?.targetId ? (controls.get(state.position.targetId) ?? null) : null,
    mode: facts.mode,
    scroll: region
      ? `${region.canScrollUp ? "up" : ""}/${region.canScrollDown ? "down" : ""}`
      : "none",
    surface: region?.surfaceId ? hash(region.surfaceId).slice(0, 12) : null,
    controls: [...controls.values()],
  };
}

interface InspectorReply {
  id?: number;
  method?: string;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
  params?: { args?: { value?: unknown }[] };
}

async function inspector(metro: string) {
  const targets = (await fetch(`${metro}/json/list`).then((response) => response.json())) as {
    appId: string;
    webSocketDebuggerUrl: string;
  }[];
  const target = targets.find((entry) => entry.appId === "com.t3tools.t3code.dev");
  if (!target) throw new Error("No Android dev client is connected to this Metro.");
  const socket = new WebSocket(target.webSocketDebuggerUrl, { origin: new URL(metro).origin });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let id = 0;
  const calls = new Map<number, (reply: InspectorReply) => void>();
  const consoleCalls = new Map<string, (value: { value?: unknown; error?: string }) => void>();
  socket.on("message", (data) => {
    const reply = JSON.parse(data.toString()) as InspectorReply;
    if (reply.id) {
      calls.get(reply.id)?.(reply);
      calls.delete(reply.id);
    }
    if (reply.method !== "Runtime.consoleAPICalled") return;
    const value = reply.params?.args?.[0]?.value;
    if (typeof value !== "string") return;
    for (const [marker, complete] of consoleCalls)
      if (value.startsWith(marker)) {
        complete(JSON.parse(value.slice(marker.length)));
        consoleCalls.delete(marker);
        break;
      }
  });
  const send = (method: string, params: object = {}) =>
    new Promise<InspectorReply>((resolve) => {
      const key = ++id;
      calls.set(key, resolve);
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  void send("Runtime.enable");
  async function evaluate<T>(expression: string, async = false): Promise<T> {
    const marker = `CONTROLLER_AUDIT:${NodeCrypto.randomUUID()}:`;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Native probe/inspector acknowledgment timed out.")),
          12000,
        );
        if (async)
          consoleCalls.set(marker, (reply) => {
            if (reply.error) reject(new Error(reply.error));
            else resolve(reply.value as T);
          });
        const request = async
          ? `Promise.resolve(${expression}).then(value=>console.log(${JSON.stringify(marker)}+JSON.stringify({value})),error=>console.log(${JSON.stringify(marker)}+JSON.stringify({error:String(error)})))`
          : expression;
        void send("Runtime.evaluate", { expression: request, returnByValue: true }).then(
          (reply) => {
            if (reply.result?.exceptionDetails) reject(new Error("Inspector evaluation failed."));
            else if (!async) resolve(reply.result?.result?.value as T);
          },
          reject,
        );
      });
    } finally {
      clearTimeout(timer!);
      consoleCalls.delete(marker);
    }
  }
  return { evaluate, close: () => socket.close() };
}

function htmlReport(report: ReturnType<typeof buildControllerGraph>, source: object) {
  const expected = controllerStateContract
    .map((edge) => `${edge.from} -- ${edge.input} [<=${edge.limit} press] --> ${edge.to}`)
    .join("\n");
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:var(--font-sans);color:var(--foreground)}p{line-height:1.5}.stats{display:flex;gap:8px;flex-wrap:wrap}.stat{padding:14px;background:var(--card);border-radius:var(--radius);flex:1;min-width:110px}.stat b{display:block;font-size:24px}pre{font:12px/1.6 var(--font-mono);overflow:auto;background:var(--code-background);padding:16px;border-radius:var(--radius)}select{font:inherit;color:var(--foreground);background:var(--secondary);border:1px solid var(--border);padding:8px;border-radius:8px;max-width:100%;margin:8px 0}details{margin:12px 0}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:8px;text-align:left;border-bottom:1px solid var(--border)}.passed{color:var(--success)}.failed{color:var(--destructive)}.blocked{color:var(--warning)}svg{width:100%;height:420px}.node{fill:var(--card);stroke:var(--border)}text{fill:var(--foreground);font:11px var(--font-sans)}.unknown{color:var(--muted-foreground)}button{font:inherit}</style></head><body><p><b>Verification is incomplete.</b> Observed native-probe transitions are software evidence. Page visits, model tests, voice UI and physical GameSir acceptance are different claims.</p><div class="stats"><div class="stat"><b>${report.coverage.routeLayouts.visited}/${report.coverage.routeLayouts.expected}</b>route/layout visits</div><div class="stat"><b>${report.cases.filter((c) => c.status === "passed").length}/${report.cases.length}</b>journeys passed</div><div class="stat"><b>${report.coverage.primaryButtons.exercised}/${report.coverage.primaryButtons.expected}</b>primary buttons asserted</div><div class="stat"><b>${report.back.confirmedFailedExits}</b>failed Back assertions</div></div><details open><summary>First-principles transition contract</summary><pre>${escape(expected)}</pre><p>Global invariants: one input owner; restore the invoking scope; no activation on recovery; scrolling stays local; layout changes preserve the destination. Voice-ui means recording controls appeared, not verified audio transcription.</p></details><p>Inspect an observed page graph. Unvisited pages stay unknown.</p><select id="page" onchange="draw()"></select><select id="layout" onchange="draw()"><option>compact</option><option>split</option></select><div id="graph"></div><details open><summary>Journey outcomes and button budgets</summary><table><thead><tr><th>Journey</th><th>Outcome</th><th>Presses / budget</th><th>Failures</th></tr></thead><tbody>${report.cases.map((c) => `<tr><td>${escape(c.id)}</td><td class="${c.status}">${c.status}</td><td>${c.presses} / ${c.maxPresses}</td><td>${escape(c.errors.join("; "))}${c.failedExpectations ? ` ${c.failedExpectations} unmet expectations` : ""}</td></tr>`).join("")}</tbody></table></details><details><summary>${report.coverage.routeLayouts.untested.length} untested route/layouts</summary><pre>${escape(report.coverage.routeLayouts.untested.map((r) => `${r.page} / ${r.layout}`).join("\n"))}</pre></details><details><summary>Evidence limits and source</summary><pre>${escape(JSON.stringify(source, null, 2))}</pre><p>Discovered controls are only the mounted controls seen in this run; discovery/selection is not activation. Missing Back edges are unknown, not proven traps. Generic UI modes, OS permission screens and physical notifications still need fixtures. Input timing includes the inspector/harness.</p></details><script>const report=${data};const pages=[...new Set([...report.nodes.map(n=>n.state.page),...report.coverage.routeLayouts.entries.map(r=>r.page)])];document.getElementById('page').innerHTML=pages.map(p=>'<option>'+p+'</option>').join('');function draw(){const page=document.getElementById('page').value,layout=document.getElementById('layout').value;const ns=report.nodes.filter(n=>n.state.page===page&&n.state.layout===layout);if(!ns.length){document.getElementById('graph').innerHTML='<p class="unknown">UNTESTED: no native graph evidence for this page/layout.</p>';return;}const shown=ns.slice(0,24);const positions=new Map(shown.map((n,i)=>[n.id,{x:10+(i%3)*230,y:20+Math.floor(i/3)*100}]));const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');let lines='';for(const e of report.edges){const a=positions.get(e.from),b=positions.get(e.to);if(!a||!b)continue;lines+='<path d="M '+(a.x+100)+' '+(a.y+55)+' Q '+(b.x+90)+' '+(a.y+70)+' '+(b.x+100)+' '+b.y+'" fill="none" stroke="'+(e.pass?'var(--chart-1)':'var(--destructive)')+'" opacity=".55" marker-end="url(#arrow)"/><text x="'+(b.x+10)+'" y="'+(b.y-3)+'">'+esc(e.input)+'</text>';}for(const n of shown){const p=positions.get(n.id);lines+='<rect class="node" x="'+p.x+'" y="'+p.y+'" width="210" height="58" rx="8"/><text x="'+(p.x+10)+'" y="'+(p.y+18)+'">'+esc(n.state.scope+' / '+n.state.mode)+'</text><text x="'+(p.x+10)+'" y="'+(p.y+36)+'">'+esc((n.state.pane||'none')+' / '+(n.state.region||'none').split(':')[0])+'</text><text x="'+(p.x+10)+'" y="'+(p.y+50)+'">'+esc(n.state.target?n.state.target.split(':')[0]:'region selected')+'</text>';}document.getElementById('graph').innerHTML='<svg viewBox="0 0 710 '+(Math.ceil(shown.length/3)*100+40)+'"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="var(--chart-1)"/></marker></defs>'+lines+'</svg>'+(ns.length>24?'<p>First 24 states shown; full graph is in JSON/DOT.</p>':'');}draw();</script></body></html>`;
}

export async function controllerAudit(args: string[]) {
  const mode = args.shift() ?? "inventory";
  const option = (name: string, fallback = "") => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : (args[i + 1] ?? fallback);
  };
  if (mode === "--help") {
    console.log(
      "node scripts/controller-navigation.ts inventory|run --out /tmp/audit [--metro http://127.0.0.1:8081 --agent-device <device_open command> --thread-path /threads/env/id --append --partial --cases <journeys.json>]",
    );
    return;
  }
  const output = NodePath.resolve(option("--out", "/tmp/t3-controller-audit"));
  await NodeFSP.mkdir(output, { recursive: true });
  const routes = controllerRoutes(
    await NodeFSP.readFile(NodePath.join(root, "apps/mobile/src/Stack.tsx"), "utf8"),
  );
  const commit = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tracked = NodeChildProcess.execFileSync(
    "git",
    [
      "diff",
      "HEAD",
      "--",
      "apps/mobile",
      "scripts/controller-navigation.ts",
      "scripts/mobile-behavior",
    ],
    { cwd: root, encoding: "utf8" },
  );
  const untrackedPaths = NodeChildProcess.execFileSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "apps/mobile",
      "scripts/controller-navigation.ts",
      "scripts/mobile-behavior",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const untracked = await Promise.all(
    untrackedPaths.map(async (path) => [
      path,
      await NodeFSP.readFile(NodePath.join(root, path), "utf8"),
    ]),
  );
  const source = {
    commit,
    worktreeDiff: hash(tracked + JSON.stringify(untracked)),
    setup: "Route opening, reset and enable are excluded from task button budgets",
    input: "native-probe",
    hardware: "UNVERIFIED",
    fixtureScope: "isolated development state required",
    controls: "Opaque identifiers; no draft text or thread labels recorded",
  };
  let cases: GraphCase[] = [];
  if (args.includes("--append")) {
    const previous = JSON.parse(
      await NodeFSP.readFile(NodePath.join(output, "run.json"), "utf8"),
    ) as { source: typeof source; cases: GraphCase[] };
    if (previous.source.commit !== commit || previous.source.worktreeDiff !== source.worktreeDiff)
      throw new Error(
        "Source changed: use a new report directory rather than merging different builds.",
      );
    cases = previous.cases;
  }
  if (mode === "run") {
    const command = option("--agent-device");
    if (!command) throw new Error("Use the exact agent-device command returned by device_open.");
    const bridge = await inspector(option("--metro", "http://127.0.0.1:8081"));
    const observe = async () =>
      JSON.parse(
        await bridge.evaluate<string>("__t3Behavior.controllerObservation()"),
      ) as ControllerCapture;
    const input = async (action: string) =>
      JSON.parse(
        await bridge.evaluate<string>(
          `__t3Behavior.controllerInput(${JSON.stringify(action)}).then(value=>JSON.stringify({consumed:JSON.parse(value).consumed}))`,
          true,
        ),
      ) as { consumed: boolean };
    const wait = async (before: ControllerCapture, expect: ControllerExpectation) =>
      JSON.parse(
        await bridge.evaluate<string>(
          `__t3Behavior.controllerWaitFor(value=>{const controllerFacts=${controllerFacts.toString()};const controllerFailures=${controllerFailures.toString()};return controllerFailures(value,${JSON.stringify(before)},${JSON.stringify(expect)}).length===0;})`,
          true,
        ),
      ) as ControllerCapture;
    try {
      const journeys = option("--cases")
        ? (JSON.parse(await NodeFSP.readFile(option("--cases"), "utf8")) as ControllerJourney[])
        : controllerJourneys(option("--thread-path") || undefined);
      for (const journey of journeys) {
        const steps: GraphCase["steps"][number][] = [];
        let caseId = `${controllerFacts(await observe()).layout}:${journey.id}`;
        let error: string | undefined;
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const current = await observe();
            if (controllerFacts(current).scope === "workspace") break;
            await input("b");
          }
          NodeChildProcess.execFileSync(
            command,
            ["open", "com.t3tools.t3code.dev", `t3code-dev://${journey.path}`],
            { stdio: "ignore" },
          );
          const prepared = await wait(await observe(), {
            page: journey.page,
            path: journey.path,
            scope: "workspace",
          });
          const layout = controllerFacts(prepared).layout;
          caseId = `${layout}:${journey.id}`;
          await input("reset");
          await input("start");
          await wait(prepared, {
            page: journey.page,
            path: journey.path,
            scope: "workspace",
            ready: true,
          });
          const origins: ControllerCapture[] = [];
          for (const entry of journey.steps) {
            const before = await observe();
            origins.push(before);
            const comparison =
              entry.expect.restoreFromStep === undefined
                ? before
                : origins[entry.expect.restoreFromStep];
            if (!comparison) throw new Error("Invalid restoration anchor.");
            const started = NodeProcess.hrtime.bigint();
            let after = before,
              pass = true;
            let failure: string | undefined;
            try {
              await input(entry.input);
              after = await wait(comparison, { page: journey.page, ...entry.expect });
            } catch {
              after = await observe();
              pass = false;
              failure =
                controllerFailures(after, comparison, { page: journey.page, ...entry.expect }).join(
                  "; ",
                ) || "Native input or its expected UI outcome did not complete.";
            }
            steps.push({
              input: inputNames[entry.input] ?? entry.input.toUpperCase(),
              from: graphState(before),
              to: graphState(after),
              pass,
              durationMs: Number(NodeProcess.hrtime.bigint() - started) / 1e6,
              ...(failure ? { error: failure } : {}),
            });
            if (!pass) break;
          }
        } catch (cause) {
          error = `Fixture/page readiness or native probe unavailable: ${cause instanceof Error ? cause.message : "unknown error"}`;
        }
        cases = cases.filter((entry) => entry.id !== caseId);
        cases.push({
          id: caseId,
          maxPresses: journey.maxPresses,
          steps,
          ...(error ? { error } : {}),
        });
        console.log(
          `${caseId}: ${error ? "BLOCKED" : steps.every((step) => step.pass) ? "PASS" : "FAIL"} (${steps.length}/${journey.maxPresses} presses)`,
        );
      }
    } finally {
      bridge.close();
    }
  } else if (mode !== "inventory") throw new Error("Use inventory or run.");
  const report = buildControllerGraph(routes, cases);
  await NodeFSP.writeFile(
    NodePath.join(output, "run.json"),
    JSON.stringify({ source, routes, cases, report }, null, 2),
  );
  await NodeFSP.writeFile(
    NodePath.join(output, "graph.dot"),
    `digraph Navigation {\n${report.nodes.map((n) => `${n.id} [label=${JSON.stringify(`${n.state.page}/${n.state.layout} ${n.state.scope} ${n.state.mode}`)}];`).join("\n")}\n${report.edges.map((e) => `${e.from} -> ${e.to} [label=${JSON.stringify(e.input)},color=${e.pass ? "blue" : "red"}];`).join("\n")}\n}`,
  );
  await NodeFSP.writeFile(
    NodePath.join(output, "contract.dot"),
    `digraph Contract {\n${controllerStateContract.map((e) => `${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)} [label=${JSON.stringify(e.input)}];`).join("\n")}\n}`,
  );
  await NodeFSP.writeFile(NodePath.join(output, "index.html"), htmlReport(report, source));
  console.log(
    `${report.coverage.routeLayouts.visited}/${report.coverage.routeLayouts.expected} route-layouts observed; ${report.cases.filter((c) => c.status === "failed").length} failed, ${report.cases.filter((c) => c.status === "blocked").length} blocked. Report: ${output}`,
  );
  const failed = report.cases.some((c) => c.status !== "passed");
  const incomplete =
    report.coverage.routeLayouts.untested.length > 0 ||
    report.coverage.primaryButtons.untested.length > 0;
  return failed ? 1 : incomplete && !args.includes("--partial") ? 2 : 0;
}

if (import.meta.main) {
  const exitCode = await controllerAudit(NodeProcess.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Controller audit failed.");
    return 1;
  });
  NodeProcess.exit(exitCode ?? 0);
}
